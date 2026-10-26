"""Agent framework tests (§5): schemas, validation, orchestration and ethics."""
from __future__ import annotations

import pytest


class TestAgentRegistry:
    def test_registers_every_agent_named_in_the_specification(self):
        from app.agents.orchestrator import registry

        required = {
            "RESUME_INTELLIGENCE", "JOB_MATCHING", "CODING_ASSESSMENT",
            "TECHNICAL_INTERVIEW", "HR_INTERVIEW", "BEHAVIORAL_INTERVIEW",
            "PLACEMENT_READINESS",
            "ALUMNI_MENTORSHIP", "ANALYTICS",
        }
        assert required.issubset(set(registry))

    def test_every_agent_declares_schemas_and_a_responsibility(self):
        from app.agents.orchestrator import registry

        for name, agent in registry.items():
            assert agent.responsibility, f"{name} has no declared responsibility"
            assert agent.InputModel is not None, f"{name} has no input schema"
            assert agent.OutputModel is not None, f"{name} has no output schema"
            described = agent.describe()
            assert described["inputSchema"]["type"] == "object"

    @pytest.mark.asyncio
    async def test_rejects_an_unknown_agent(self):
        from app.agents.orchestrator import run_agent
        from app.core.errors import ServiceError

        with pytest.raises(ServiceError) as exc:
            await run_agent("NOT_A_REAL_AGENT", {})
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_validates_agent_input_against_its_schema(self):
        from app.agents.orchestrator import run_agent
        from app.core.errors import AgentValidationError

        # `components` must be a mapping; a string must be rejected, not coerced.
        with pytest.raises(AgentValidationError):
            await run_agent("PLACEMENT_READINESS", {"components": "not-a-mapping"})


class TestJobMatchingAgent:
    @pytest.mark.asyncio
    async def test_scores_a_strong_match_highly(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("JOB_MATCHING", {
            "studentSkills": ["Python", "React", "Node.js", "MongoDB", "SQL", "Git"],
            "requiredSkills": ["Python", "React", "MongoDB"],
            "preferredSkills": ["Docker"],
            "companyName": "Zoho", "roleTitle": "Software Developer",
            "descriptionText": "Build web applications with Python, React and MongoDB.",
            "cgpa": 8.5,
        })
        data = result["data"]
        assert data["matchScore"] >= 65
        assert data["requiredCoverage"] == 100.0
        assert "Docker" in data["recommendedSkills"]
        assert data["eligible"] is True

    @pytest.mark.asyncio
    async def test_identifies_missing_required_skills(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("JOB_MATCHING", {
            "studentSkills": ["Python"],
            "requiredSkills": ["Java", "Spring Boot", "Kubernetes"],
            "roleTitle": "Backend Engineer",
        })
        data = result["data"]
        assert set(data["missingSkills"]) == {"Java", "Spring Boot", "Kubernetes"}
        assert data["requiredCoverage"] == 0.0
        assert len(data["preparationPlan"]) >= 3
        assert all(item["reason"] for item in data["preparationPlan"])

    @pytest.mark.asyncio
    async def test_matches_skills_through_aliases(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("JOB_MATCHING", {
            "studentSkills": ["ReactJS", "NodeJS"],
            "requiredSkills": ["React", "Node.js"],
        })
        assert result["data"]["requiredCoverage"] == 100.0

    @pytest.mark.asyncio
    async def test_enforces_cgpa_eligibility(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("JOB_MATCHING", {
            "studentSkills": ["Python", "Java"],
            "requiredSkills": ["Python"],
            "cgpa": 5.5, "minCgpa": 7.0,
            "companyName": "Infosys",
        })
        data = result["data"]
        assert data["eligible"] is False
        assert any("cgpa" in note.lower() for note in data["eligibilityNotes"])

    @pytest.mark.asyncio
    async def test_flags_a_missing_cgpa_without_failing_eligibility(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("JOB_MATCHING", {
            "studentSkills": ["Python"], "requiredSkills": ["Python"],
            "cgpa": None, "minCgpa": 7.0,
        })
        data = result["data"]
        # An unrecorded CGPA is a data gap the student can fix, not a rejection.
        assert data["eligible"] is True
        assert any("no cgpa is recorded" in n.lower() for n in data["eligibilityNotes"])

    @pytest.mark.asyncio
    async def test_enforces_department_eligibility(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("JOB_MATCHING", {
            "studentSkills": ["Python"], "requiredSkills": ["Python"],
            "department": "Mechanical", "allowedDepartments": ["Computer Science", "IT"],
        })
        assert result["data"]["eligible"] is False


class TestInterviewAgents:
    @pytest.mark.asyncio
    async def test_generates_a_question_with_expected_points(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("TECHNICAL_INTERVIEW", {
            "sessionId": "s1", "mode": "TECHNICAL", "index": 0,
            "skills": ["React", "Node.js"], "difficulty": "MEDIUM",
        })
        data = result["data"]
        assert len(data["question"]) > 20
        assert data["difficulty"] in {"EASY", "MEDIUM", "HARD"}
        assert data["difficultyReason"]

    @pytest.mark.asyncio
    async def test_increases_difficulty_after_strong_answers(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("TECHNICAL_INTERVIEW", {
            "sessionId": "s2", "mode": "TECHNICAL", "index": 3,
            "difficulty": "MEDIUM", "recentScores": [85, 88, 90],
        })
        assert result["data"]["difficulty"] == "HARD"
        assert "increased" in result["data"]["difficultyReason"].lower()

    @pytest.mark.asyncio
    async def test_reduces_difficulty_after_weak_answers(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("TECHNICAL_INTERVIEW", {
            "sessionId": "s3", "mode": "TECHNICAL", "index": 3,
            "difficulty": "MEDIUM", "recentScores": [30, 35, 28],
        })
        assert result["data"]["difficulty"] == "EASY"
        assert "reduced" in result["data"]["difficultyReason"].lower()

    @pytest.mark.asyncio
    async def test_holds_difficulty_until_enough_evidence_exists(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("TECHNICAL_INTERVIEW", {
            "sessionId": "s4", "mode": "TECHNICAL", "index": 1,
            "difficulty": "MEDIUM", "recentScores": [95],
        })
        # One strong answer is too noisy a signal to move the whole interview.
        assert result["data"]["difficulty"] == "MEDIUM"

    @pytest.mark.asyncio
    async def test_evaluates_a_substantive_answer(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("INTERVIEW_EVALUATION", {
            "question": "Explain the difference between state and props in React.",
            "answer": (
                "Props are read-only inputs passed from a parent component, whereas state is owned and "
                "mutated by the component itself. For example, in my placement portal project I lifted "
                "state up to a shared parent because two sibling components needed the same filter value. "
                "The result was that both stayed in sync without duplicating logic."
            ),
            "expectedPoints": [
                "Props are read-only inputs, state is owned by the component",
                "Unidirectional data flow",
                "A concrete lifting-state-up scenario",
            ],
            "mode": "TECHNICAL",
        })
        data = result["data"]
        assert data["overall"] > 30
        assert data["deliverySignals"]["wordCount"] > 40
        assert data["explanation"]
        assert data["disclaimer"]

    @pytest.mark.asyncio
    async def test_scores_an_empty_answer_at_zero_without_calling_a_model(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("INTERVIEW_EVALUATION", {
            "question": "Explain polymorphism.", "answer": "idk",
            "expectedPoints": ["Compile-time vs runtime polymorphism"],
        })
        data = result["data"]
        assert data["overall"] == 0
        assert data["deliverySignals"]["responseLengthVerdict"] == "TOO_SHORT"
        assert result["meta"]["provider"] == "internal"

    @pytest.mark.asyncio
    async def test_measures_filler_words_objectively(self):
        from app.agents.interview_agents import delivery_signals

        clean = delivery_signals("Props are read only inputs passed down from the parent component.")
        filled = delivery_signals("Um so like basically props are, you know, kind of um read only I mean inputs.")
        assert filled["fillerWordRate"] > clean["fillerWordRate"]
        assert filled["clarityScore"] < clean["clarityScore"]

    @pytest.mark.asyncio
    async def test_evaluation_never_reports_emotional_or_demographic_inference(self):
        """§12: no psychological, emotional or protected-characteristic claims."""
        from app.agents.orchestrator import run_agent

        result = await run_agent("INTERVIEW_EVALUATION", {
            "question": "Tell me about yourself.",
            "answer": "I am a final year computer science student with experience in React and Node.js. "
                      "I built a placement portal used by 400 students and I enjoy solving problems.",
            "expectedPoints": ["Concise structured narrative"],
            "mode": "HR",
        })
        data = result["data"]
        # Scan the GENERATED FEEDBACK only. The disclaimer legitimately names
        # these concepts in order to state that they are not assessed.
        feedback = " ".join([
            *data["strengths"], *data["improvements"], *data["missedPoints"],
            data["explanation"],
        ]).lower()

        for forbidden in ("gender", "race", "ethnicity", "accent", "emotion", "nervous", "anxious",
                          "personality type", "introvert", "extrovert", "disability"):
            assert forbidden not in feedback, f"Evaluation leaked a forbidden inference: {forbidden}"

        # And the disclaimer must be present, stating the limits explicitly.
        assert "not a hiring decision" in data["disclaimer"].lower()


class TestCodingAgent:
    @pytest.mark.asyncio
    async def test_correctness_comes_from_test_results_not_the_model(self):
        from app.agents.orchestrator import run_agent

        passing = await run_agent("CODING_ASSESSMENT", {
            "code": "def two_sum(nums, t):\n    seen = {}\n    for i, n in enumerate(nums):\n        if t-n in seen:\n            return [seen[t-n], i]\n        seen[n] = i",
            "language": "python", "problemTitle": "Two Sum",
            "passedCount": 10, "totalCount": 10, "executionStatus": "ACCEPTED",
        })
        failing = await run_agent("CODING_ASSESSMENT", {
            "code": "def two_sum(nums, t):\n    return []",
            "language": "python", "problemTitle": "Two Sum",
            "passedCount": 0, "totalCount": 10, "executionStatus": "WRONG_ANSWER",
        })
        assert passing["data"]["correctnessScore"] == 100.0
        assert failing["data"]["correctnessScore"] == 0.0
        assert passing["data"]["score"] > failing["data"]["score"]

    @pytest.mark.asyncio
    async def test_zeroes_correctness_on_a_compilation_error(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("CODING_ASSESSMENT", {
            "code": "def broken(:", "language": "python",
            "passedCount": 0, "totalCount": 5, "executionStatus": "COMPILATION_ERROR",
        })
        assert result["data"]["correctnessScore"] == 0.0
        assert "compile" in result["data"]["verdict"].lower()

    @pytest.mark.asyncio
    async def test_states_that_it_did_not_execute_the_code(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("CODING_ASSESSMENT", {
            "code": "print(1)", "language": "python", "passedCount": 1, "totalCount": 1,
            "executionStatus": "ACCEPTED",
        })
        assert "did not execute" in result["data"]["disclaimer"].lower()


class TestMentorshipAndAnalytics:
    @pytest.mark.asyncio
    async def test_ranks_a_target_company_mentor_first(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("ALUMNI_MENTORSHIP", {
            "targetCompanies": ["Amazon"], "targetRoles": ["Software Developer"],
            "studentSkills": ["Python", "Java"], "skillGaps": ["System Design"],
            "candidates": [
                {"alumniId": "a1", "fullName": "Ravi", "company": "TCS", "designation": "Analyst",
                 "skills": ["Excel"], "averageRating": 5, "sessionsConducted": 10},
                {"alumniId": "a2", "fullName": "Sneha", "company": "Amazon", "designation": "Software Developer",
                 "skills": ["Python", "Java", "System Design"], "averageRating": 4.5,
                 "sessionsConducted": 8, "availabilitySlots": 3},
            ],
        })
        matches = result["data"]["matches"]
        assert matches[0]["alumniId"] == "a2"
        assert any("amazon" in r.lower() for r in matches[0]["reasons"])
        assert "System Design" in matches[0]["coveredGaps"]

    @pytest.mark.asyncio
    async def test_converts_alumni_feedback_into_an_apie_delta(self):
        from app.agents.orchestrator import run_agent

        strong = await run_agent("ALUMNI_FEEDBACK_INGEST", {
            "technicalKnowledge": 9, "communication": 9, "problemSolving": 9,
            "confidence": 8, "roleSuitability": 9, "recommendation": "STRONG_HIRE",
        })
        weak = await run_agent("ALUMNI_FEEDBACK_INGEST", {
            "technicalKnowledge": 3, "communication": 4, "problemSolving": 3,
            "confidence": 3, "roleSuitability": 2, "recommendation": "NEEDS_WORK",
        })
        assert strong["data"]["apieDelta"] > 0
        assert weak["data"]["apieDelta"] < 0
        # The influence is bounded so human feedback informs but cannot dominate.
        assert -4.0 <= weak["data"]["apieDelta"] <= 4.0
        assert -4.0 <= strong["data"]["apieDelta"] <= 4.0

    @pytest.mark.asyncio
    async def test_analytics_identifies_the_at_risk_cohort_and_common_gaps(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("ANALYTICS", {
            "students": [
                {"studentId": "1", "fullName": "A", "department": "CSE", "prs": 25, "codingScore": 20},
                {"studentId": "2", "fullName": "B", "department": "CSE", "prs": 75},
                {"studentId": "3", "fullName": "C", "department": "ECE", "prs": 35},
                {"studentId": "4", "fullName": "D", "department": "ECE", "prs": None},
            ],
            "skillGaps": [
                {"skill": "System Design", "gap": 70}, {"skill": "System Design", "gap": 65},
                {"skill": "Docker", "gap": 50},
            ],
            "groupBy": "department",
        })
        data = result["data"]
        assert len(data["riskCohort"]) == 2
        assert data["commonGaps"][0]["skill"] == "System Design"
        assert len(data["groupComparison"]) == 2
        assert any("no readiness score" in i.lower() for i in data["insights"])

    @pytest.mark.asyncio
    async def test_analytics_handles_an_empty_cohort(self):
        from app.agents.orchestrator import run_agent

        result = await run_agent("ANALYTICS", {"students": [], "skillGaps": []})
        assert result["data"]["insights"]
        assert result["data"]["riskCohort"] == []


class TestCustomJobDescription:
    """A student-supplied job description: keywords come from its text alone."""

    JD = ("We are hiring a Backend Developer. Required skills: Python, Django, PostgreSQL, Docker and Git. "
          "Preferred: Kubernetes and AWS.")
    RESUME = ("Priya Sharma\npriya@example.com\n\nEDUCATION\nB.E. Computer Science, CGPA 8.4\n\nSKILLS\nPython, Git, SQL\n\n"
              "PROJECTS\n" + "Built a placement portal in Python with a SQL database and Git workflows. " * 4)

    def test_keywords_are_derived_from_the_text(self):
        import asyncio
        from app.agents.orchestrator import run_agent

        result = asyncio.run(run_agent("RESUME_INTELLIGENCE", {"text": self.RESUME, "jobDescriptionText": self.JD}))
        data = result["data"]
        assert {"Python", "Git"} <= set(data["matchedKeywords"])
        assert {"Django", "Docker", "PostgreSQL"} <= set(data["missingKeywords"])
        assert 0 < data["keywordCoverage"] < 100

    def test_no_job_description_means_no_keyword_comparison(self):
        import asyncio
        from app.agents.orchestrator import run_agent

        data = asyncio.run(run_agent("RESUME_INTELLIGENCE", {"text": self.RESUME}))["data"]
        assert data["matchedKeywords"] == [] and data["missingKeywords"] == []

    def test_file_extraction_returns_text_and_recognised_skills(self):
        import asyncio
        import base64
        from app.api.routes.resume import extract_document_text

        payload = {"fileBase64": base64.b64encode((self.JD * 2).encode()).decode(), "mimeType": "text/plain", "filename": "jd.txt"}
        data = asyncio.run(extract_document_text(payload))["data"]
        assert "Backend Developer" in data["text"]
        assert {"Python", "Django", "Docker"} <= set(data["recognisedSkills"])

    def test_unreadable_file_is_rejected_with_a_job_description_message(self):
        import asyncio
        import base64
        import pytest
        from app.api.routes.resume import extract_document_text
        from app.core.errors import ResumeParseError

        payload = {"fileBase64": base64.b64encode(b"hi").decode(), "mimeType": "text/plain", "filename": "jd.txt"}
        with pytest.raises(ResumeParseError, match="job description"):
            asyncio.run(extract_document_text(payload))
