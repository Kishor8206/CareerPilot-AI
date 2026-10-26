"""Resume pipeline tests (§8): parsing, ATS scoring and keyword matching."""
from __future__ import annotations

import base64

import pytest

from tests.conftest import SAMPLE_RESUME


class TestResumeParser:
    def test_extracts_contact_details(self):
        from app.nlp.resume_parser import parse_resume

        parsed = parse_resume(SAMPLE_RESUME)
        assert parsed["email"] == "priya.sharma@example.com"
        assert parsed["phone"] is not None
        assert any("linkedin" in link.lower() for link in parsed["links"])
        assert any("github" in link.lower() for link in parsed["links"])

    def test_extracts_name(self):
        from app.nlp.resume_parser import parse_resume

        parsed = parse_resume(SAMPLE_RESUME)
        assert parsed["name"] is not None
        assert "priya" in parsed["name"].lower()

    def test_detects_standard_sections(self):
        from app.nlp.resume_parser import detect_sections

        sections = detect_sections(SAMPLE_RESUME)
        for expected in ("education", "skills", "projects", "certifications"):
            assert expected in sections, f"Section '{expected}' was not detected"

    def test_extracts_education_with_normalised_cgpa(self):
        from app.nlp.resume_parser import parse_resume

        parsed = parse_resume(SAMPLE_RESUME)
        assert len(parsed["education"]) >= 1
        degree = parsed["education"][0]
        assert degree["degree"] == "B.Tech"
        assert degree["cgpa"] == pytest.approx(8.6, abs=0.01)
        assert "university" in (degree["institution"] or "").lower()

    def test_normalises_a_four_point_gpa_to_ten(self):
        from app.nlp.resume_parser import extract_education

        entries = extract_education("B.Tech in Computer Science\nStanford University\nGPA: 3.8/4")
        assert entries[0].cgpa == pytest.approx(9.5, abs=0.01)

    def test_categorises_skills(self):
        from app.nlp.resume_parser import parse_resume

        parsed = parse_resume(SAMPLE_RESUME)
        assert "Python" in parsed["programmingLanguages"]
        assert "React" in parsed["frameworks"]
        assert "MongoDB" in parsed["databases"]
        assert "Docker" in parsed["cloud"]
        assert "Data Structures" in parsed["fundamentals"]

    def test_collapses_skill_aliases(self):
        from app.nlp.skills_taxonomy import canonicalise, extract_skills

        assert canonicalise("reactjs").name == "React"
        assert canonicalise("JS").name == "JavaScript"
        assert canonicalise("node js").name == "Node.js"
        names = {s.name for s in extract_skills("Experienced in ReactJS, NodeJS and MongoDB")}
        assert {"React", "Node.js", "MongoDB"}.issubset(names)

    def test_does_not_match_skills_inside_other_words(self):
        from app.nlp.skills_taxonomy import extract_skills

        # "Go" must not match "going"; "R" must not match every capital R.
        names = {s.name for s in extract_skills("I am going to the shop. Rahul Ramesh reviewed it.")}
        assert "Go" not in names
        assert "R" not in names

    def test_extracts_projects_and_internships(self):
        from app.nlp.resume_parser import parse_resume

        parsed = parse_resume(SAMPLE_RESUME)
        assert len(parsed["projects"]) >= 2
        assert any("placement" in p["title"].lower() for p in parsed["projects"])
        assert len(parsed["internships"]) >= 1
        assert parsed["totalExperienceMonths"] >= 2

    def test_extracts_certifications(self):
        from app.nlp.resume_parser import parse_resume

        parsed = parse_resume(SAMPLE_RESUME)
        assert len(parsed["certifications"]) >= 2
        assert any("aws" in c["name"].lower() for c in parsed["certifications"])


class TestAtsScoring:
    def test_scores_a_strong_resume_highly(self):
        from app.nlp.resume_parser import parse_resume
        from app.services.ats import score_resume

        result = score_resume(parse_resume(SAMPLE_RESUME), SAMPLE_RESUME)
        assert 55 <= result["atsScore"] <= 100
        assert result["strengths"]

    def test_breakdown_covers_every_criterion_and_sums_to_the_score(self):
        from app.nlp.resume_parser import parse_resume
        from app.services.ats import CRITERIA_WEIGHTS, score_resume

        result = score_resume(parse_resume(SAMPLE_RESUME), SAMPLE_RESUME)
        assert len(result["breakdown"]) == len(CRITERIA_WEIGHTS)
        assert sum(i["maxScore"] for i in result["breakdown"]) == 100
        assert round(sum(i["score"] for i in result["breakdown"]), 2) == pytest.approx(result["atsScore"], abs=0.01)

    def test_scores_a_weak_resume_lower_than_a_strong_one(self):
        from app.nlp.resume_parser import parse_resume
        from app.services.ats import score_resume

        weak = "John Doe\nI want a job.\nI know some programming.\nPlease hire me. " * 6
        weak_score = score_resume(parse_resume(weak), weak)["atsScore"]
        strong_score = score_resume(parse_resume(SAMPLE_RESUME), SAMPLE_RESUME)["atsScore"]
        assert weak_score < strong_score
        assert weak_score < 45

    def test_flags_a_missing_cgpa(self):
        from app.nlp.resume_parser import parse_resume
        from app.services.ats import score_resume

        text = SAMPLE_RESUME.replace("CGPA: 8.6/10", "").replace("| 92%", "")
        result = score_resume(parse_resume(text), text)
        assert any("cgpa" in w.lower() or "percentage" in w.lower() for w in result["weaknesses"])

    def test_keyword_matching_is_alias_aware(self):
        from app.nlp.resume_parser import parse_resume
        from app.services.ats import keyword_match

        parsed = parse_resume(SAMPLE_RESUME)
        # The resume says "React"; the JD asks for "ReactJS".
        result = keyword_match(parsed, SAMPLE_RESUME, ["ReactJS", "Kubernetes", "Python"])
        assert "React" in result["matchedKeywords"]
        assert "Python" in result["matchedKeywords"]
        assert "Kubernetes" in result["missingKeywords"]
        assert result["keywordCoverage"] == pytest.approx(66.67, abs=0.1)


class TestTextExtraction:
    def test_rejects_an_unsupported_file_type(self):
        from app.core.errors import UnsupportedFileType
        from app.nlp.text_extraction import extract_text

        with pytest.raises(UnsupportedFileType):
            extract_text(b"MZ\x90\x00" * 100, "application/x-msdownload", "resume.exe")

    def test_rejects_an_empty_file(self):
        from app.core.errors import ResumeParseError
        from app.nlp.text_extraction import extract_text

        with pytest.raises(ResumeParseError):
            extract_text(b"", "text/plain", "resume.txt")

    def test_rejects_a_file_with_too_little_text(self):
        from app.core.errors import ResumeParseError
        from app.nlp.text_extraction import extract_text

        with pytest.raises(ResumeParseError, match="readable text"):
            extract_text(b"Hi", "text/plain", "resume.txt")

    def test_reads_a_plain_text_resume(self):
        from app.nlp.text_extraction import extract_text

        text = extract_text(SAMPLE_RESUME.encode("utf-8"), "text/plain", "resume.txt")
        assert "PRIYA SHARMA" in text


class TestResumeApi:
    def test_requires_the_internal_key(self, client):
        response = client.post("/ai/resume/analyze", json={"text": SAMPLE_RESUME})
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "UNAUTHENTICATED"

    def test_analyzes_a_resume_supplied_as_text(self, client, internal_headers):
        response = client.post("/ai/resume/analyze", json={"text": SAMPLE_RESUME}, headers=internal_headers)
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"]["atsScore"] > 0
        assert body["data"]["parsed"]["email"] == "priya.sharma@example.com"
        assert body["data"]["disclaimer"]

    def test_analyzes_a_base64_upload(self, client, internal_headers):
        encoded = base64.b64encode(SAMPLE_RESUME.encode()).decode()
        response = client.post(
            "/ai/resume/analyze",
            json={"fileBase64": encoded, "mimeType": "text/plain", "filename": "resume.txt"},
            headers=internal_headers,
        )
        assert response.status_code == 200
        assert response.json()["data"]["parsed"]["name"] is not None

    def test_rejects_a_request_with_no_content(self, client, internal_headers):
        response = client.post("/ai/resume/analyze", json={}, headers=internal_headers)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "RESUME_PARSE_FAILED"

    def test_returns_job_specific_recommendations_for_missing_keywords(self, client, internal_headers):
        response = client.post(
            "/ai/resume/analyze",
            json={"text": SAMPLE_RESUME, "jobKeywords": ["Kubernetes", "Terraform"], "roleTitle": "DevOps Engineer"},
            headers=internal_headers,
        )
        body = response.json()["data"]
        assert "Kubernetes" in body["missingKeywords"]
        assert body["jobSpecificRecommendations"]
