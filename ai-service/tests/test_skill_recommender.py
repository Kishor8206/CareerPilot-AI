"""Skill recommender.

Pinned here:
  * the model learns co-occurrence (and is not just popularity);
  * it never recommends a skill the student already has, and never hides
    that it did not recognise their skills.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.ml.skill_recommender import SkillRecommender, get_skill_recommender

# A toy world with obvious structure: two clusters, and SQL in both.
WEB = frozenset({"HTML", "CSS", "JavaScript", "SQL"})
OPS = frozenset({"Docker", "Kubernetes", "Linux", "SQL"})
BASKETS = [WEB] * 10 + [OPS] * 10 + [frozenset({"HTML", "CSS", "SQL"})] * 3
VOCAB = sorted({s for b in BASKETS for s in b})


@pytest.fixture
def toy() -> SkillRecommender:
    return SkillRecommender.fit(BASKETS, VOCAB, kind="itemknn", jd_baskets=[OPS] * 4, shrinkage=0)


def names(result, key="recommendations"):
    return [r["skill"] for r in result[key]]


def test_learns_co_occurrence_not_just_popularity(toy):
    # SQL is the most popular skill overall, yet for a Docker user Kubernetes
    # and Linux are the specific neighbours.
    top = names(toy.recommend(["Docker", "SQL"], k=2))
    assert set(top) == {"Kubernetes", "Linux"}
    assert "HTML" not in names(toy.recommend(["Docker"], k=3))


def test_never_recommends_a_skill_the_student_has(toy):
    owned = ["HTML", "CSS"]
    assert not set(names(toy.recommend(owned, k=10))) & set(owned)


def test_aliases_are_canonicalised(toy):
    assert toy.recommend(["html5", "css3"], k=3)["recognisedSkills"] == ["HTML", "CSS"]


def test_unrecognised_skills_are_reported_and_basis_is_honest(toy):
    result = toy.recommend(["Underwater Basket Weaving"], k=3)
    assert result["basis"] == "popularity"                     # says it fell back
    assert result["unrecognisedSkills"] == ["Underwater Basket Weaving"]
    assert names(result)[0] == "SQL"                           # the most common skill


def test_target_skills_come_first_ordered_by_closeness(toy):
    result = toy.recommend(["HTML", "CSS"], target=["Kubernetes", "JavaScript", "Rust"], k=5)
    order = names(result, "targetSkillOrder")
    assert order[:2] == ["JavaScript", "Kubernetes"]            # JavaScript is closer to HTML/CSS
    assert order[-1] == "Rust" and result["targetSkillOrder"][-1]["score"] is None   # unknown: kept, unranked
    assert not set(order) & set(names(result))                  # not repeated as "adjacent"


def test_save_and_load_round_trip(toy, tmp_path):
    toy.save(tmp_path / "m.json", metrics={"x": 1})
    again = SkillRecommender.load(tmp_path / "m.json")
    assert again.vocab == toy.vocab and again.metrics == {"x": 1}
    assert np.allclose(again.score(["Docker"]), toy.score(["Docker"]), atol=1e-5)


def test_popularity_penalty_demotes_hub_skills():
    plain = SkillRecommender.fit(BASKETS, VOCAB, kind="itemknn", shrinkage=0)
    penalised = SkillRecommender.fit(BASKETS, VOCAB, kind="itemknn", shrinkage=0, popularity_penalty=1.0)
    sql = plain.index["SQL"]
    assert penalised.score(["HTML"])[sql] / penalised.score(["HTML"]).max() \
        < plain.score(["HTML"])[sql] / plain.score(["HTML"]).max()


# ------------------------------------------------------- the trained artefact
trained = pytest.mark.skipif(get_skill_recommender() is None,
                             reason="run careerpilot_skills/train_skill_recommender.py")


@trained
def test_trained_model_beat_the_popularity_baseline_with_confidence():
    metrics = get_skill_recommender().metrics
    low, _ = metrics["gainOverPopularity"]["ci95"]
    assert low > 0, "the lower confidence bound of the gain must be above zero"
    assert metrics["data"]["provenance"] == "REAL"


@trained
def test_trained_model_knows_real_pairs():
    model = get_skill_recommender()
    assert "Kubernetes" in names(model.recommend(["Docker"], k=5))
