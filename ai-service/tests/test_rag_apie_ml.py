"""Tests for the RAG pipeline (§10), APIE (§6) and the ML pipeline (§7)."""
from __future__ import annotations

import pytest


class TestChunking:
    def test_splits_long_text_on_sentence_boundaries(self):
        from app.rag.chunking import chunk_text

        text = " ".join(f"This is sentence number {i} in a long document about placements." for i in range(120))
        chunks = chunk_text(text, chunk_size=400, overlap=80)
        assert len(chunks) > 3
        # Boundary-aligned chunking must not slice mid-word.
        for chunk in chunks:
            assert not chunk.text.startswith(" ")
            assert len(chunk.text) <= 700

    def test_returns_a_single_chunk_for_short_text(self):
        from app.rag.chunking import chunk_text

        chunks = chunk_text("A short but complete paragraph about interview preparation and readiness.")
        assert len(chunks) == 1

    def test_returns_nothing_for_empty_text(self):
        from app.rag.chunking import chunk_text

        assert chunk_text("") == []

    def test_chunks_overlap_so_cross_boundary_facts_stay_retrievable(self):
        from app.rag.chunking import chunk_text

        sentences = [f"Fact {i} concerns the recruitment process in detail and matters." for i in range(40)]
        chunks = chunk_text(" ".join(sentences), chunk_size=300, overlap=120)
        assert len(chunks) >= 2
        first_words = set(chunks[0].text.split())
        second_words = set(chunks[1].text.split())
        assert first_words & second_words, "Adjacent chunks should share overlap text"


class TestEmbeddings:
    def test_produces_normalised_vectors(self):
        import numpy as np

        from app.services.embeddings import embed_text

        vector = embed_text("Python developer with React experience")
        assert vector.shape[0] > 0
        assert np.isclose(float(np.linalg.norm(vector)), 1.0, atol=1e-5)

    def test_is_deterministic(self):
        import numpy as np

        from app.services.embeddings import embed_text

        a = embed_text("machine learning engineer")
        b = embed_text("machine learning engineer")
        assert np.allclose(a, b)

    def test_related_text_scores_higher_than_unrelated_text(self):
        from app.services.embeddings import cosine_similarity, embed_text

        query = embed_text("React frontend developer JavaScript components")
        related = embed_text("Frontend engineer building React components in JavaScript")
        unrelated = embed_text("Financial accounting audit taxation compliance ledger")
        assert cosine_similarity(query, related) > cosine_similarity(query, unrelated)


class TestRagPipeline:
    @pytest.fixture(autouse=True)
    def _clean_index(self):
        from app.rag import pipeline

        pipeline.clear_index()
        yield
        pipeline.clear_index()

    def test_indexes_and_retrieves_a_document(self):
        from app.rag import pipeline

        result = pipeline.ingest_document(
            document_id="doc-zoho",
            title="Zoho Recruitment Process",
            content=(
                "Zoho Corporation conducts a multi-stage hiring process for campus recruitment. "
                "The first round is an online aptitude and programming test. Candidates who clear it "
                "attend an advanced programming round conducted on paper. The final stages are a "
                "technical interview followed by an HR discussion."
            ),
            category="COMPANY_PROFILE",
            metadata={"companyId": "c1"},
        )
        assert result["indexed"] is True
        assert result["chunkCount"] >= 1

        hits = pipeline.retrieve("What are the rounds in the Zoho hiring process?", top_k=3)
        assert hits
        assert "zoho" in hits[0].text.lower()

    def test_filters_retrieval_by_metadata(self):
        from app.rag import pipeline

        pipeline.ingest_document("d1", "Company A Process", "Company A runs an aptitude test then interviews.",
                                 "COMPANY_PROFILE", {"companyId": "c1"})
        pipeline.ingest_document("d2", "HR Topics", "Discussion topics about artificial intelligence in hiring.",
                                 "HR_TOPIC", {})

        hits = pipeline.retrieve("aptitude interviews hiring", top_k=5, filters={"category": "HR_TOPIC"})
        assert all(h.metadata.get("category") == "HR_TOPIC" for h in hits)

    def test_re_ingesting_replaces_rather_than_duplicates(self):
        from app.rag import pipeline

        pipeline.ingest_document("dup", "Doc", "Original content about placement preparation resources.", "CAREER_RESOURCE")
        first = pipeline.stats()["chunks"]
        pipeline.ingest_document("dup", "Doc", "Updated content about placement preparation resources.", "CAREER_RESOURCE")
        assert pipeline.stats()["chunks"] == first

    def test_deletes_a_document(self):
        from app.rag import pipeline

        pipeline.ingest_document("gone", "Doc", "Content that will shortly be removed from the index.", "CAREER_RESOURCE")
        assert pipeline.stats()["chunks"] > 0
        pipeline.delete_document("gone")
        assert pipeline.stats()["chunks"] == 0

    @pytest.mark.asyncio
    async def test_admits_when_it_has_no_verified_information(self):
        """§10: never hallucinate a company's recruitment policy."""
        from app.rag import pipeline

        result = await pipeline.query("What is the exact salary band at a company we have no data about?")
        assert result["insufficientContext"] is True
        assert result["grounded"] is False
        assert result["sources"] == []
        assert "do not have verified information" in result["answer"].lower() \
            or "does not contain verified information" in result["answer"].lower()

    @pytest.mark.asyncio
    async def test_rejects_a_domain_adjacent_but_unanswerable_question(self):
        """The relevance cut-off must separate 'related vocabulary' from 'answerable'.

        A question that shares words with the corpus but is not covered by it is
        the case the filter exists for. Scoring it above the threshold would
        produce a confident answer grounded in irrelevant passages.
        """
        from app.rag import pipeline

        pipeline.ingest_document(
            "doc-prep",
            "Preparing for an IT Services Campus Interview",
            (
                "Campus interviews at large IT services companies follow a consistent structure. "
                "The first stage is an online assessment covering quantitative aptitude, logical reasoning "
                "and verbal ability. The technical interview focuses on fundamentals: data structures, "
                "object-oriented programming, database normalisation and the projects on your resume."
            ),
            "INTERVIEW_PREP",
        )

        on_topic = pipeline.retrieve("What should I prepare for a technical interview at an IT services company?")
        assert on_topic, "A genuinely on-topic question must retrieve context"

        # Shares vocabulary ("company", "role") but the corpus says nothing about
        # salary bands or quantum cryptography.
        unanswerable = pipeline.retrieve(
            "What is the exact salary band for a quantum cryptography role at a company we have no data about?"
        )
        assert not unanswerable, (
            "A domain-adjacent but unanswerable question must be filtered out. "
            "If this fails, the relevance threshold is too permissive."
        )

        unrelated = pipeline.retrieve("How do I bake sourdough bread at home")
        assert not unrelated

    @pytest.mark.asyncio
    async def test_answers_from_indexed_context_and_cites_sources(self):
        from app.rag import pipeline

        pipeline.ingest_document(
            "doc-tcs",
            "TCS NQT Overview",
            (
                "The TCS National Qualifier Test assesses numerical ability, verbal ability and reasoning. "
                "Candidates who clear the NQT proceed to a technical interview and then a managerial round. "
                "The test is conducted online and is the primary entry route for campus hiring."
            ),
            "COMPANY_PROFILE",
            {"companyId": "tcs"},
        )
        result = await pipeline.query("What does the TCS National Qualifier Test assess?")
        assert result["insufficientContext"] is False
        assert result["grounded"] is True
        assert result["sources"]
        assert result["sources"][0]["title"] == "TCS NQT Overview"
        assert result["sources"][0]["score"] > 0


class TestApie:
    def _components(self, **overrides):
        base = {
            key: {"value": 60.0, "evidenceCount": 1, "lastUpdated": "2099-01-01T00:00:00Z"}
            for key in ("resume", "coding", "technical", "hr", "communication", "aptitude", "academic")
        }
        base.update(overrides)
        return base

    def test_is_not_a_plain_average(self):
        """§6: weighting must matter. Equal inputs, different placement."""
        from app.services import apie

        # Coding weighs 0.20; HR weighs 0.10. Putting the high score on the
        # heavier component must produce a higher overall score.
        heavy = apie.compute_readiness({
            "components": self._components(
                coding={"value": 90.0, "evidenceCount": 1, "lastUpdated": "2099-01-01T00:00:00Z"},
                hr={"value": 30.0, "evidenceCount": 1, "lastUpdated": "2099-01-01T00:00:00Z"},
            ),
        })
        light = apie.compute_readiness({
            "components": self._components(
                coding={"value": 30.0, "evidenceCount": 1, "lastUpdated": "2099-01-01T00:00:00Z"},
                hr={"value": 90.0, "evidenceCount": 1, "lastUpdated": "2099-01-01T00:00:00Z"},
            ),
        })
        assert heavy["score"] > light["score"]

    def test_weights_are_configurable_at_runtime(self):
        from app.services import apie

        components = self._components(
            coding={"value": 100.0, "evidenceCount": 1, "lastUpdated": "2099-01-01T00:00:00Z"},
        )
        default = apie.compute_readiness({"components": components})
        coding_heavy = apie.compute_readiness({
            "components": components,
            "weights": {"resume": 0.05, "coding": 0.60, "technical": 0.10, "hr": 0.05,
                        "communication": 0.10, "aptitude": 0.05, "academic": 0.05},
        })
        assert coding_heavy["score"] > default["score"]
        assert coding_heavy["weightsSnapshot"]["coding"] == 0.60

    def test_components_without_evidence_are_reported_and_cost_points(self):
        from app.services import apie

        result = apie.compute_readiness({
            "components": {"coding": {"value": 90.0, "evidenceCount": 1, "lastUpdated": "2099-01-01T00:00:00Z"}},
        })
        missing = [c for c in result["components"] if c["raw"] is None]
        assert len(missing) == 6
        # A single strong component cannot alone produce a high overall score.
        assert result["score"] < 30
        assert any("no evidence" in w.lower() for w in result["weaknesses"])
        assert result["evidenceCoverage"] < 20

    def test_derives_the_academic_score_from_cgpa_and_backlogs(self):
        from app.services import apie

        clean = apie.compute_readiness({"components": {}, "profile": {"cgpa": 8.0, "backlogs": 0}})
        backlogged = apie.compute_readiness({"components": {}, "profile": {"cgpa": 8.0, "backlogs": 2}})

        academic_clean = next(c for c in clean["components"] if c["key"] == "academic")
        academic_backlogged = next(c for c in backlogged["components"] if c["key"] == "academic")
        assert academic_clean["raw"] == 80.0
        assert academic_backlogged["raw"] == 64.0

    def test_alumni_feedback_moves_the_score_in_both_directions(self):
        """§43: human-in-the-loop feedback is weighted into readiness."""
        from app.services import apie

        components = self._components()
        neutral = apie.compute_readiness({"components": components})
        positive = apie.compute_readiness({"components": components, "profile": {"alumniFeedbackScore": 95}})
        negative = apie.compute_readiness({"components": components, "profile": {"alumniFeedbackScore": 20}})

        assert positive["score"] > neutral["score"]
        assert negative["score"] < neutral["score"]
        assert any(m["label"] == "Alumni feedback" for m in positive["modifiers"])

    def test_assigns_the_correct_readiness_band(self):
        from app.services import apie

        def score_for(value):
            return apie.compute_readiness({
                "components": {
                    key: {"value": value, "evidenceCount": 1, "lastUpdated": "2099-01-01T00:00:00Z"}
                    for key in ("resume", "coding", "technical", "hr", "communication", "aptitude", "academic")
                }
            })

        assert score_for(20)["band"] == "AT_RISK"
        assert score_for(50)["band"] == "NEEDS_IMPROVEMENT"
        assert score_for(70)["band"] == "PLACEMENT_READY"
        assert score_for(90)["band"] == "HIGHLY_READY"

    def test_flags_stale_evidence_for_reassessment(self):
        from app.services import apie

        result = apie.compute_readiness({
            "components": self._components(
                coding={"value": 70.0, "evidenceCount": 1, "lastUpdated": "2020-01-01T00:00:00Z"},
            ),
            "reassessmentDays": 30,
        })
        coding = next(c for c in result["components"] if c["key"] == "coding")
        assert coding["stale"] is True
        assert any("coding" in s["component"].lower() for s in result["reassessmentSuggestions"])

    def test_tracks_improvement_against_the_previous_score(self):
        from app.services import apie

        result = apie.compute_readiness({"components": self._components(), "previousScore": 45.0})
        assert result["delta"] is not None
        assert result["delta"] == round(result["score"] - 45.0, 2)
        assert result["improvementSummary"]

    def test_always_carries_the_prototype_disclaimer(self):
        from app.services import apie

        result = apie.compute_readiness({"components": self._components()})
        assert "PROTOTYPE" in result["modelDisclaimer"].upper()

    def test_derives_skill_gaps_and_escalates_multi_role_gaps(self):
        from app.services import apie

        gaps = apie.derive_skill_gaps({
            "studentSkills": ["Python"],
            "targetRoles": [
                {"roleTitle": "Backend Engineer", "coreSkills": ["Python", "System Design", "SQL"]},
                {"roleTitle": "Data Engineer", "coreSkills": ["Python", "System Design"]},
            ],
        })
        by_skill = {g["skill"]: g for g in gaps}
        assert "Python" not in by_skill, "A skill the student already has is not a gap"
        # Required by two target roles, so escalated above a single-role gap.
        assert by_skill["System Design"]["severity"] == "CRITICAL"
        assert by_skill["SQL"]["severity"] == "HIGH"
        assert gaps[0]["skill"] == "System Design"


class TestMlPipeline:
    def test_synthetic_data_is_labelled_and_well_formed(self):
        from app.ml.features import CLASS_LABELS, FEATURE_NAMES
        from app.ml.synthetic_data import generate_dataset

        frame = generate_dataset(n=400, seed=7)
        assert len(frame) == 400
        assert set(FEATURE_NAMES).issubset(frame.columns)
        assert (frame["provenance"] == "SYNTHETIC").all()
        assert set(frame["readinessBand"].unique()).issubset(set(CLASS_LABELS))

    def test_synthetic_data_is_deterministic_for_a_given_seed(self):
        from app.ml.synthetic_data import generate_dataset

        a = generate_dataset(n=200, seed=99)
        b = generate_dataset(n=200, seed=99)
        assert a.equals(b)

    def test_synthetic_labels_are_not_perfectly_separable(self):
        """A ~99% accuracy figure on synthetic data would be meaningless."""
        from app.ml.train import train

        metrics = train(samples=1200, seed=3, cv_folds=3)
        assert 0.5 < metrics["accuracy"] < 0.95, (
            "Deliberate label noise should keep accuracy realistic, not near-perfect"
        )

    def test_training_reports_honest_labelled_metrics(self):
        from app.ml.train import train

        metrics = train(samples=1200, seed=5, cv_folds=3)
        assert metrics["datasetProvenance"] == "SYNTHETIC"
        assert metrics["evaluationLabel"] == "Prototype Evaluation - Synthetic Dataset"
        assert "not real student data" in metrics["disclaimer"].lower()
        assert metrics["trainSize"] + metrics["testSize"] == metrics["datasetSize"]
        assert len(metrics["confusionMatrix"]) == len(metrics["labels"])
        assert metrics["featureImportance"]

    def test_feature_vector_order_is_stable_and_clipped(self):
        from app.ml.features import FEATURE_NAMES, to_vector

        vector = to_vector({"atsScore": 150, "codingScore": -20, "unknownField": 999})
        assert vector.shape == (1, len(FEATURE_NAMES))
        assert vector[0][0] == 100.0   # clipped down to the maximum
        assert vector[0][1] == 0.0     # clipped up to the minimum

    def test_prediction_returns_probabilities_and_provenance(self):
        from app.ml import predict as ml_predict
        from app.ml.train import train

        train(samples=1200, seed=11, cv_folds=3)
        ml_predict.reset_model_cache()

        result = ml_predict.predict({
            "atsScore": 85, "codingScore": 88, "technicalScore": 82, "hrScore": 78,
            "communicationScore": 80, "aptitudeScore": 85, "academicScore": 88,
            "projectCount": 4, "certificationCount": 3, "internshipMonths": 6,
            "alumniFeedbackScore": 80, "skillGapCount": 2, "assessmentsTaken": 10, "interviewsTaken": 8,
        })
        assert result["band"] in {"AT_RISK", "NEEDS_IMPROVEMENT", "PLACEMENT_READY", "HIGHLY_READY"}
        assert 0 <= result["confidence"] <= 1
        assert abs(sum(result["classProbabilities"].values()) - 1.0) < 0.01
        assert result["trainedOn"] == "SYNTHETIC"
        assert "prototype" in result["disclaimer"].lower()

    def test_a_strong_profile_outranks_a_weak_one(self):
        from app.ml import predict as ml_predict
        from app.ml.train import train

        train(samples=2000, seed=13, cv_folds=3)
        ml_predict.reset_model_cache()

        order = ["AT_RISK", "NEEDS_IMPROVEMENT", "PLACEMENT_READY", "HIGHLY_READY"]
        strong = ml_predict.predict({
            "atsScore": 92, "codingScore": 94, "technicalScore": 90, "hrScore": 88,
            "communicationScore": 90, "aptitudeScore": 92, "academicScore": 93,
            "projectCount": 6, "certificationCount": 5, "internshipMonths": 12,
            "alumniFeedbackScore": 90, "skillGapCount": 0, "assessmentsTaken": 20, "interviewsTaken": 15,
        })
        weak = ml_predict.predict({
            "atsScore": 20, "codingScore": 15, "technicalScore": 18, "hrScore": 22,
            "communicationScore": 25, "aptitudeScore": 18, "academicScore": 30,
            "projectCount": 0, "certificationCount": 0, "internshipMonths": 0,
            "alumniFeedbackScore": 0, "skillGapCount": 15, "assessmentsTaken": 1, "interviewsTaken": 0,
        })
        assert order.index(strong["band"]) > order.index(weak["band"])

    @pytest.mark.asyncio
    async def test_readiness_agent_degrades_gracefully_without_a_trained_model(self, tmp_path, monkeypatch):
        """§7: never fabricate a prediction when no model exists."""
        from app.agents.orchestrator import run_agent
        from app.core.config import settings
        from app.ml import predict as ml_predict

        monkeypatch.setattr(type(settings), "artifacts_path", property(lambda _self: tmp_path))
        ml_predict.reset_model_cache()

        result = await run_agent("PLACEMENT_READINESS", {
            "components": {"coding": {"value": 70, "evidenceCount": 1, "lastUpdated": "2099-01-01T00:00:00Z"}},
            "includeMlPrediction": True,
        })
        data = result["data"]
        # The APIE score still computes; only the ML second opinion is absent.
        assert data["score"] >= 0
        assert data["mlPrediction"] is None
        assert "not been trained" in (data["mlUnavailableReason"] or "").lower()

        ml_predict.reset_model_cache()
