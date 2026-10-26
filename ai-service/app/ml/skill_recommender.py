"""Skill recommender: "given the skills you have, which are you most likely missing?"

Trained by careerpilot_skills/train_skill_recommender.py on skill sets
extracted from real job descriptions and resumes. This module is both the
training-time model and the serving-time model, so what is evaluated is
exactly what is served.

Three model kinds share one representation — a skill-to-skill similarity
matrix — and one scoring rule (sum the similarities to the skills you own):

  popularity  every skill scored by how common it is (the baseline)
  itemknn     sim(i, j) = cooccur(i, j) / (sqrt(count_i * count_j) + shrinkage)
              Cosine similarity between skills' occurrence vectors. Shrinkage
              pulls similarities built on few co-occurrences towards zero, so
              a pair seen together twice does not outrank a well-supported one.
              An optional popularity penalty demotes skills that co-occur a
              little with everything.
  ppmi_svd    PPMI(i, j) = max(0, log(P(i, j) / (P(i) P(j)))), factorised by a
              truncated SVD into `dim`-dimensional skill embeddings; similarity
              is the cosine between embeddings.

The model is a plain JSON artefact (a ~80 x 80 matrix): no pickle, so loading
it cannot execute code, and it can be read and audited by eye.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from app.core.logging import get_logger
from app.nlp.skills_taxonomy import canonicalise

log = get_logger(__name__)

MODEL_VERSION = "careerpilot-skillrec-v1"
ARTIFACT_NAME = "skill_recommender.json"
DISCLAIMER = (
    "Suggestions come from a model of which skills appear together in real job descriptions and resumes. "
    "They indicate what is commonly expected alongside your skills, not a guarantee of any hiring outcome."
)

# How many ADJACENT skills (beyond what the target role requires) a roadmap adds,
# by readiness band. A student at risk should consolidate the required skills
# before widening; a ready student has room to stretch. This is a stated design
# rule, not a learned or validated quantity.
ADJACENT_PER_BAND = {"AT_RISK": 0, "NEEDS_IMPROVEMENT": 1, "PLACEMENT_READY": 2, "HIGHLY_READY": 3}


class SkillRecommender:
    def __init__(self, vocab: list[str], sim: np.ndarray, popularity: np.ndarray, demand: np.ndarray,
                 kind: str, hyperparameters: dict[str, Any], metrics: dict[str, Any] | None = None) -> None:
        self.vocab = list(vocab)
        self.index = {s: i for i, s in enumerate(self.vocab)}
        self.sim = np.asarray(sim, dtype=np.float64)
        self.popularity = np.asarray(popularity, dtype=np.float64)
        self.demand = np.asarray(demand, dtype=np.float64)
        self.kind = kind
        self.hyperparameters = hyperparameters
        self.metrics = metrics or {}

    # ------------------------------------------------------------ training
    @classmethod
    def fit(cls, baskets: Iterable[frozenset[str]], vocab: list[str], kind: str = "itemknn",
            jd_baskets: Iterable[frozenset[str]] | None = None, shrinkage: float = 5.0,
            dim: int = 16, popularity_penalty: float = 0.0) -> "SkillRecommender":
        index = {s: i for i, s in enumerate(vocab)}
        v = len(vocab)

        def matrix(sets: Iterable[frozenset[str]]) -> np.ndarray:
            rows = [[index[s] for s in b if s in index] for b in sets]
            x = np.zeros((len(rows), v))
            for r, cols in enumerate(rows):
                x[r, cols] = 1.0
            return x

        x = matrix(baskets)
        n = max(1, len(x))
        cooccur = x.T @ x
        count = np.diag(cooccur).copy()
        popularity = count / n
        jd = matrix(jd_baskets or [])
        demand = jd.mean(axis=0) if len(jd) else np.zeros(v)

        if kind == "popularity":
            sim = np.zeros((v, v))
            hp: dict[str, Any] = {}
        elif kind == "itemknn":
            sim = cooccur / (np.sqrt(np.outer(count, count)) + shrinkage + 1e-12)
            # Divide each candidate's column by popularity**penalty. At 0 this is
            # plain cosine; above 0 it demotes "hub" skills that co-occur a little
            # with everything (Java, SQL) in favour of specific neighbours (React
            # for JavaScript). The value is chosen on validation data, not by taste.
            if popularity_penalty:
                sim = sim / np.power(np.maximum(popularity, 1e-9), popularity_penalty)[None, :]
            hp = {"shrinkage": shrinkage, "popularity_penalty": popularity_penalty}
        elif kind == "ppmi_svd":
            p_ij = cooccur / n
            with np.errstate(divide="ignore", invalid="ignore"):
                pmi = np.log(p_ij / np.outer(popularity, popularity))
            ppmi = np.where(np.isfinite(pmi) & (pmi > 0), pmi, 0.0)
            np.fill_diagonal(ppmi, 0.0)
            u, s, _ = np.linalg.svd(ppmi)
            d = min(dim, v)
            emb = u[:, :d] * np.sqrt(s[:d])
            norms = np.linalg.norm(emb, axis=1, keepdims=True)
            emb = emb / np.where(norms == 0, 1.0, norms)
            sim = emb @ emb.T
            hp = {"dim": d}
        else:
            raise ValueError(f"unknown model kind: {kind}")
        np.fill_diagonal(sim, 0.0)
        return cls(vocab, sim, popularity, demand, kind, hp)

    # ------------------------------------------------------------- scoring
    def score(self, owned: list[str]) -> np.ndarray:
        """Score every skill given owned skills (names in the vocabulary).
        Popularity breaks ties, and is the whole answer when nothing is owned."""
        idx = [self.index[s] for s in owned if s in self.index]
        if not idx or self.kind == "popularity":
            return self.popularity.copy()
        return self.sim[idx].sum(axis=0) + 1e-6 * self.popularity

    @staticmethod
    def _canonical(skills: Iterable[str]) -> list[str]:
        out = []
        for raw in skills:
            if not isinstance(raw, str) or not raw.strip():
                continue
            found = canonicalise(raw)
            name = found.name if found else raw.strip()
            if name not in out:
                out.append(name)
        return out

    def recommend(self, owned: Iterable[str], target: Iterable[str] = (), k: int = 5) -> dict[str, Any]:
        """Two ranked lists of skills the student does not have.

        targetSkillOrder  skills the target role requires, in suggested
                          learning order (closest to current skills first)
        recommendations   adjacent skills, scored by fit with what the student
                          knows and what the role asks for (equal weight)
        Each entry names the skills that drove it.
        """
        have = self._canonical(owned)
        want = self._canonical(target)
        have_in = [s for s in have if s in self.index]
        want_in = [s for s in want if s in self.index]

        def unit(scores: np.ndarray) -> np.ndarray:
            top = scores.max()
            return scores / top if top > 0 else scores

        if have_in and want_in:
            scores, basis = 0.5 * unit(self.score(have_in)) + 0.5 * unit(self.score(want_in)), "skills+target"
        elif have_in or want_in:
            scores, basis = unit(self.score(have_in or want_in)), ("skills" if have_in else "target")
        else:
            scores, basis = unit(self.popularity.copy()), "popularity"   # nothing recognised: say so

        scores = scores.copy()
        missing_target = [s for s in want if s not in have]
        for s in [*have, *missing_target]:
            if s in self.index:
                scores[self.index[s]] = -np.inf

        def entry(i: int, score: float | None, drivers: list[str]) -> dict[str, Any]:
            related = sorted(drivers, key=lambda s: -self.sim[self.index[s], i])
            return {
                "skill": self.vocab[i],
                "score": None if score is None else round(float(score), 4),
                "relatedTo": [s for s in related if self.sim[self.index[s], i] > 0][:3],
                "jobDemand": round(float(self.demand[i]), 4),   # share of job descriptions asking for it
            }

        # 1. Skills the target role requires and the student lacks, ordered by
        #    closeness to what the student already knows: the easiest step first.
        closeness = self.score(have_in) if have_in else self.popularity
        top = closeness.max() or 1.0
        known_missing = sorted((s for s in missing_target if s in self.index), key=lambda s: -closeness[self.index[s]])
        target_order = [entry(self.index[s], closeness[self.index[s]] / top, have_in) for s in known_missing]
        target_order += [{"skill": s, "score": None, "relatedTo": [], "jobDemand": None}
                         for s in missing_target if s not in self.index]      # outside the model: kept, unranked

        # 2. Adjacent skills: not required by the role, but commonly found
        #    alongside the student's skills and the role's.
        drivers = have_in + [s for s in want_in if s not in have_in]
        adjacent = [entry(int(i), scores[i], drivers) for i in np.argsort(-scores)[: max(0, k)]
                    if np.isfinite(scores[i]) and scores[i] > 0]
        return {
            "targetSkillOrder": target_order, "recommendations": adjacent, "basis": basis,
            "recognisedSkills": have_in, "unrecognisedSkills": [s for s in have if s not in self.index],
            "modelVersion": MODEL_VERSION, "modelKind": self.kind, "disclaimer": DISCLAIMER,
        }

    # ------------------------------------------------------------ artefact
    def save(self, path: Path, metrics: dict[str, Any] | None = None) -> None:
        payload = {
            "modelVersion": MODEL_VERSION, "kind": self.kind, "hyperparameters": self.hyperparameters,
            "vocab": self.vocab, "sim": np.round(self.sim, 6).tolist(),
            "popularity": np.round(self.popularity, 6).tolist(), "demand": np.round(self.demand, 6).tolist(),
            "metrics": metrics or self.metrics,
        }
        Path(path).write_text(json.dumps(payload), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "SkillRecommender":
        p = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(p["vocab"], np.array(p["sim"]), np.array(p["popularity"]), np.array(p["demand"]),
                   p["kind"], p.get("hyperparameters", {}), p.get("metrics", {}))


# ----------------------------------------------------------------- loading
_model: SkillRecommender | None = None
_checked = False


def get_skill_recommender() -> SkillRecommender | None:
    """The trained model, or None if it has not been trained. Never raises:
    a roadmap without skill suggestions is still a roadmap."""
    global _model, _checked
    if _checked:
        return _model
    _checked = True
    path = Path(__file__).resolve().parents[2] / "artifacts" / ARTIFACT_NAME
    try:
        _model = SkillRecommender.load(path)
        log.info("Skill recommender loaded", extra={"kind": _model.kind, "skills": len(_model.vocab)})
    except FileNotFoundError:
        log.warning("Skill recommender not trained; run careerpilot_skills/train_skill_recommender.py")
    except Exception as exc:
        log.warning("Skill recommender could not be loaded", extra={"reason": str(exc)})
    return _model


def reset_skill_recommender() -> None:
    global _model, _checked
    _model, _checked = None, False
