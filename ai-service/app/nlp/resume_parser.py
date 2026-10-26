"""Structured extraction from resume text (§8).

Pipeline: section detection -> per-section entity extraction -> skill matching.

Design note
-----------
Section detection comes first and everything else is scoped to a section. That
matters: without it, a "Technologies: React, Node" line inside a project would
be indistinguishable from the skills section, and dates inside the education
block would be read as work experience.

spaCy is used for person-name detection when the model is installed; a
positional heuristic takes over when it is not, so the parser never hard-fails
on a missing model.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from app.core.logging import get_logger
from app.nlp.skills_taxonomy import (
    CLOUD,
    CS_FUNDAMENTAL,
    DATABASE,
    FRAMEWORK,
    PROGRAMMING_LANGUAGE,
    TOOL,
    by_category,
    extract_skills,
)

log = get_logger(__name__)

# --------------------------------------------------------------------------
# Section detection
# --------------------------------------------------------------------------

SECTION_PATTERNS: dict[str, tuple[str, ...]] = {
    "summary": ("professional summary", "career objective", "objective", "summary", "profile",
                "about me", "career summary", "professional profile"),
    "education": ("education", "academic background", "academic qualification", "qualifications",
                  "educational details", "academics", "academic details"),
    "skills": ("technical skills", "skills", "core competencies", "technical proficiency",
               "areas of expertise", "technologies", "tech stack", "skill set", "competencies"),
    "experience": ("work experience", "professional experience", "experience", "employment",
                   "internship", "internships", "work history", "professional background"),
    "projects": ("projects", "academic projects", "personal projects", "key projects",
                 "project work", "major projects", "mini projects"),
    "certifications": ("certifications", "certificates", "courses", "licenses",
                       "professional certifications", "online courses", "training"),
    "achievements": ("achievements", "accomplishments", "awards", "honors", "honours",
                     "extra-curricular", "extracurricular", "activities", "positions of responsibility"),
    "contact": ("contact", "personal details", "contact information", "personal information"),
    "publications": ("publications", "research", "papers"),
    "languages": ("languages known", "languages"),
    "interests": ("interests", "hobbies"),
    "references": ("references", "referees"),
}

# A heading is a short line that is a known section name, optionally decorated.
_HEADING_CLEAN = re.compile(r"^[\s\-–—*#:•|]+|[\s\-–—*#:•|]+$")


def _heading_key(line: str) -> str | None:
    stripped = _HEADING_CLEAN.sub("", line).strip()
    if not stripped or len(stripped) > 45:
        return None
    lowered = re.sub(r"[^a-z\s&/-]", "", stripped.lower()).strip()
    if not lowered:
        return None

    for key, names in SECTION_PATTERNS.items():
        for name in names:
            if lowered == name:
                return key
    # Headings are often written as "TECHNICAL SKILLS :" or "Skills & Tools".
    for key, names in SECTION_PATTERNS.items():
        for name in names:
            if lowered.startswith(name) and len(lowered) <= len(name) + 12:
                return key
    return None


def detect_sections(text: str) -> dict[str, str]:
    """Splits resume text into named sections.

    Text appearing before the first recognised heading is kept as `header`,
    which is where the name and contact details normally live.
    """
    lines = text.split("\n")
    sections: dict[str, list[str]] = {"header": []}
    current = "header"

    for line in lines:
        key = _heading_key(line)
        if key:
            current = key
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)

    return {k: "\n".join(v).strip() for k, v in sections.items() if "\n".join(v).strip()}


# --------------------------------------------------------------------------
# Contact details
# --------------------------------------------------------------------------

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
# Phone numbers, tolerant of the many ways resumes group the digits:
#   +91 98765 43210 | +91-9876543210 | (044) 2345 6789 | 9876543210
# Deliberately permissive here; `extract_contact` then discards any match whose
# digit count is not plausible, which is what rejects year ranges and PIN codes.
PHONE_RE = re.compile(
    r"(?:(?:\+|00)\s?\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)|\d{2,5})[\s.-]?\d{3,5}[\s.-]?\d{0,5}"
)
URL_RE = re.compile(r"\b(?:https?://|www\.)[^\s,;)\]]+", re.IGNORECASE)
LINKEDIN_RE = re.compile(r"(?:linkedin\.com/in/|linkedin\.com/pub/)[A-Za-z0-9_-]+", re.IGNORECASE)
GITHUB_RE = re.compile(r"github\.com/[A-Za-z0-9_-]+", re.IGNORECASE)


def extract_contact(text: str, header: str) -> dict[str, Any]:
    emails = EMAIL_RE.findall(text)
    # A phone number has 10-15 digits. Anything shorter is a year, a PIN code or
    # a metric; anything longer is not a phone number.
    phones = [
        p.strip(" .-")
        for p in PHONE_RE.findall(text)
        if 10 <= len(re.sub(r"\D", "", p)) <= 15
    ]

    links = set(URL_RE.findall(text))
    links.update(f"https://{m}" for m in LINKEDIN_RE.findall(text))
    links.update(f"https://{m}" for m in GITHUB_RE.findall(text))

    return {
        "email": emails[0] if emails else None,
        "phone": phones[0] if phones else None,
        "links": sorted(links)[:10],
        "linkedin": next((l for l in links if "linkedin" in l.lower()), None),
        "github": next((l for l in links if "github" in l.lower()), None),
    }


_NAME_STOPWORDS = {
    "resume", "curriculum", "vitae", "cv", "profile", "contact", "email", "phone",
    "mobile", "address", "linkedin", "github", "portfolio", "objective", "summary",
}

_spacy_nlp: Any = None
_spacy_checked = False


def _get_spacy() -> Any:
    """Loads en_core_web_sm once; returns None if spaCy or the model is absent."""
    global _spacy_nlp, _spacy_checked
    if _spacy_checked:
        return _spacy_nlp
    _spacy_checked = True
    try:
        import spacy

        _spacy_nlp = spacy.load("en_core_web_sm", disable=["lemmatizer", "textcat"])
        log.info("spaCy model loaded for named-entity extraction")
    except Exception:
        log.warning(
            "spaCy model 'en_core_web_sm' is not available; falling back to heuristic name detection. "
            "Install it with: python -m spacy download en_core_web_sm"
        )
        _spacy_nlp = None
    return _spacy_nlp


def extract_name(header: str, full_text: str) -> str | None:
    """Finds the candidate's name.

    Resumes put the name on one of the first few lines, so spaCy's PERSON
    entities are searched there first; the heuristic fallback looks for a short
    title-case line that is not a heading or a contact detail.
    """
    candidate_lines = [ln.strip() for ln in header.split("\n") if ln.strip()][:6]
    if not candidate_lines:
        candidate_lines = [ln.strip() for ln in full_text.split("\n") if ln.strip()][:6]

    nlp = _get_spacy()
    if nlp is not None:
        doc = nlp("\n".join(candidate_lines))
        for ent in doc.ents:
            if ent.label_ == "PERSON" and 2 <= len(ent.text.split()) <= 4:
                return ent.text.strip()

    for line in candidate_lines:
        if EMAIL_RE.search(line) or PHONE_RE.search(line) or URL_RE.search(line):
            continue
        words = [w for w in re.split(r"\s+", line) if w]
        if not 1 < len(words) <= 5:
            continue
        if any(w.lower().strip(".,:") in _NAME_STOPWORDS for w in words):
            continue
        if not re.fullmatch(r"[A-Za-z.'\- ]+", line):
            continue
        # Names are Title Case or ALL CAPS; sentence fragments are neither.
        if line.isupper() or all(w[0].isupper() for w in words if w[0].isalpha()):
            return " ".join(w.capitalize() if w.isupper() else w for w in words)
    return None


# --------------------------------------------------------------------------
# Education
# --------------------------------------------------------------------------

DEGREE_PATTERNS = [
    (r"\b(b\.?\s?tech|bachelor of technology)\b", "B.Tech"),
    (r"\b(b\.?\s?e\.?|bachelor of engineering)\b", "B.E."),
    (r"\b(m\.?\s?tech|master of technology)\b", "M.Tech"),
    (r"\b(m\.?\s?e\.?|master of engineering)\b", "M.E."),
    (r"\b(b\.?\s?sc|bachelor of science)\b", "B.Sc"),
    (r"\b(m\.?\s?sc|master of science)\b", "M.Sc"),
    (r"\b(bca|bachelor of computer applications)\b", "BCA"),
    (r"\b(mca|master of computer applications)\b", "MCA"),
    (r"\b(b\.?\s?com|bachelor of commerce)\b", "B.Com"),
    (r"\b(m\.?\s?com|master of commerce)\b", "M.Com"),
    (r"\b(mba|master of business administration)\b", "MBA"),
    (r"\b(bba|bachelor of business administration)\b", "BBA"),
    (r"\b(ph\.?\s?d|doctor of philosophy)\b", "Ph.D"),
    (r"\b(diploma)\b", "Diploma"),
    (r"\b(hsc|higher secondary|12th|class xii|intermediate)\b", "Higher Secondary"),
    (r"\b(sslc|ssc|10th|class x|secondary school)\b", "Secondary School"),
]

CGPA_RE = re.compile(
    r"(?:cgpa|gpa|c\.g\.p\.a)\s*[:\-–]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:/\s*(\d{1,2}))?",
    re.IGNORECASE,
)
PERCENT_RE = re.compile(r"(\d{1,3}(?:\.\d{1,2})?)\s*%")
YEAR_RE = re.compile(r"\b(19[7-9]\d|20[0-4]\d)\b")

INSTITUTION_HINTS = ("college", "university", "institute", "school", "academy", "polytechnic", "iit", "nit")


@dataclass
class Education:
    degree: str
    institution: str = ""
    fieldOfStudy: str | None = None
    startYear: int | None = None
    endYear: int | None = None
    cgpa: float | None = None
    percentage: float | None = None


def _normalise_cgpa(value: float, scale: int | None) -> float | None:
    """Rescales a CGPA to the /10 convention used across the platform."""
    if scale == 4 or (scale is None and value <= 4.0 and value > 0):
        # A "3.8" with no stated scale is far more likely /4 than /10.
        return round(value * 2.5, 2)
    if scale in (10, None) and 0 < value <= 10:
        return round(value, 2)
    if scale == 100 or value > 10:
        return round(value / 10, 2)
    return None


def extract_education(section: str) -> list[Education]:
    if not section:
        return []

    entries: list[Education] = []
    # Split into blocks: a blank line, or a line that names a degree, starts one.
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in section.split("\n"):
        starts_new = any(re.search(p, line, re.IGNORECASE) for p, _ in DEGREE_PATTERNS)
        if starts_new and current:
            blocks.append(current)
            current = [line]
        elif not line.strip():
            if current:
                blocks.append(current)
                current = []
        else:
            current.append(line)
    if current:
        blocks.append(current)

    for block in blocks:
        text = " ".join(block)
        degree = next((label for pattern, label in DEGREE_PATTERNS if re.search(pattern, text, re.IGNORECASE)), None)
        if not degree:
            continue

        institution = next(
            (ln.strip() for ln in block if any(h in ln.lower() for h in INSTITUTION_HINTS)),
            "",
        )[:200]

        cgpa = None
        cgpa_match = CGPA_RE.search(text)
        if cgpa_match:
            scale = int(cgpa_match.group(2)) if cgpa_match.group(2) else None
            cgpa = _normalise_cgpa(float(cgpa_match.group(1)), scale)

        percentage = None
        pct_match = PERCENT_RE.search(text)
        if pct_match:
            value = float(pct_match.group(1))
            if 0 < value <= 100:
                percentage = value

        years = sorted({int(y) for y in YEAR_RE.findall(text)})
        field_match = re.search(
            r"\b(?:in|of)\s+((?:computer science|information technology|electronics(?:\s+and\s+communication)?|"
            r"mechanical|civil|electrical|artificial intelligence|data science|business administration)[a-z\s&]*)",
            text,
            re.IGNORECASE,
        )

        entries.append(
            Education(
                degree=degree,
                institution=institution,
                fieldOfStudy=field_match.group(1).strip().title() if field_match else None,
                startYear=years[0] if len(years) >= 2 else None,
                endYear=years[-1] if years else None,
                cgpa=cgpa,
                percentage=percentage,
            )
        )

    return entries[:6]


# --------------------------------------------------------------------------
# Experience & projects
# --------------------------------------------------------------------------

MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
DATE_RANGE_RE = re.compile(
    rf"((?:{'|'.join(MONTHS)})[a-z]*\.?\s*\d{{4}}|\d{{1,2}}/\d{{4}}|\d{{4}})"
    r"\s*(?:-|–|—|to|until|through)\s*"
    rf"((?:{'|'.join(MONTHS)})[a-z]*\.?\s*\d{{4}}|\d{{1,2}}/\d{{4}}|\d{{4}}|present|current|ongoing|till date)",
    re.IGNORECASE,
)

ROLE_HINTS = ("intern", "engineer", "developer", "analyst", "consultant", "associate",
              "trainee", "manager", "designer", "scientist", "architect", "lead")

INTERNSHIP_HINTS = ("intern", "internship", "trainee", "apprentice", "summer training")


def _parse_month_year(token: str) -> tuple[int, int] | None:
    token = token.strip().lower()
    if token in {"present", "current", "ongoing", "till date"}:
        today = date.today()
        return today.year, today.month
    slash = re.fullmatch(r"(\d{1,2})/(\d{4})", token)
    if slash:
        return int(slash.group(2)), int(slash.group(1))
    year_only = re.fullmatch(r"(\d{4})", token)
    if year_only:
        return int(year_only.group(1)), 1
    month_year = re.match(rf"({'|'.join(MONTHS)})[a-z]*\.?\s*(\d{{4}})", token)
    if month_year:
        return int(month_year.group(2)), MONTHS.index(month_year.group(1)) + 1
    return None


def _duration_months(start: str, end: str) -> int:
    a, b = _parse_month_year(start), _parse_month_year(end)
    if not a or not b:
        return 0
    months = (b[0] - a[0]) * 12 + (b[1] - a[1])
    # Guard against reversed or nonsensical ranges in messy resumes.
    return months if 0 < months <= 600 else 0


@dataclass
class Experience:
    company: str
    role: str
    type: str = "INTERNSHIP"
    startDate: str | None = None
    endDate: str | None = None
    description: str | None = None
    durationMonths: int = 0


def extract_experience(section: str) -> list[Experience]:
    if not section:
        return []

    entries: list[Experience] = []
    blocks = [b for b in re.split(r"\n\s*\n", section) if b.strip()]
    # A single dense block still contains several roles; split on date ranges.
    if len(blocks) == 1 and len(DATE_RANGE_RE.findall(section)) > 1:
        blocks = [b for b in re.split(r"\n(?=[A-Z])", section) if b.strip()]

    for block in blocks[:10]:
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue

        date_match = DATE_RANGE_RE.search(block)
        start = date_match.group(1) if date_match else None
        end = date_match.group(2) if date_match else None

        role_line = next((ln for ln in lines if any(h in ln.lower() for h in ROLE_HINTS)), lines[0])
        role = re.split(r"\s{2,}|\||,|\bat\b|—|–", role_line, maxsplit=1)[0].strip()[:120]

        company = ""
        at_match = re.search(r"\bat\s+([A-Z][\w&.,'\- ]{2,60})", block)
        if at_match:
            company = at_match.group(1).strip()
        else:
            for line in lines[:3]:
                if line == role_line:
                    continue
                if not DATE_RANGE_RE.search(line) and 2 < len(line) < 70:
                    company = re.split(r"\s{2,}|\||,", line)[0].strip()
                    break

        is_internship = any(h in block.lower() for h in INTERNSHIP_HINTS)
        description = " ".join(lines[1:])[:600] or None

        if not role and not company:
            continue

        entries.append(
            Experience(
                company=company[:120] or "Not specified",
                role=role or "Not specified",
                type="INTERNSHIP" if is_internship else "FULL_TIME",
                startDate=start,
                endDate=end,
                description=description,
                durationMonths=_duration_months(start, end) if start and end else 0,
            )
        )

    return entries


@dataclass
class Project:
    title: str
    description: str | None = None
    technologies: list[str] = field(default_factory=list)
    link: str | None = None
    durationMonths: int | None = None


TECH_LINE_RE = re.compile(
    r"(?:tech(?:nologies|nology)?|tools|stack|built with|developed using|skills used)\s*[:\-–]\s*(.+)",
    re.IGNORECASE,
)


def extract_projects(section: str) -> list[Project]:
    if not section:
        return []

    projects: list[Project] = []
    blocks = [b for b in re.split(r"\n\s*\n", section) if b.strip()]
    if len(blocks) <= 1:
        blocks = [b for b in re.split(r"\n(?=[-•*]|\s*[A-Z][\w ]{3,60}\s*(?:\||-|:|$))", section) if b.strip()]

    for block in blocks[:12]:
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue

        title = re.sub(r"^[-•*\s]+", "", lines[0])
        title = re.split(r"\s*[|:\-–]\s*", title, maxsplit=1)[0].strip()[:150]
        if not title or len(title) < 3:
            continue

        tech_match = TECH_LINE_RE.search(block)
        if tech_match:
            technologies = [t.strip() for t in re.split(r"[,;/|]", tech_match.group(1)) if 1 < len(t.strip()) < 30]
        else:
            technologies = [s.name for s in extract_skills(block)]

        link_match = URL_RE.search(block)

        projects.append(
            Project(
                title=title,
                description=" ".join(lines[1:])[:800] or None,
                technologies=technologies[:12],
                link=link_match.group(0) if link_match else None,
            )
        )

    return projects


@dataclass
class Certification:
    name: str
    issuer: str | None = None
    issuedOn: str | None = None
    link: str | None = None


ISSUER_HINTS = ("coursera", "udemy", "nptel", "edx", "google", "microsoft", "aws", "oracle",
                "ibm", "cisco", "hackerrank", "linkedin", "meta", "azure", "simplilearn", "great learning")


def extract_certifications(section: str) -> list[Certification]:
    if not section:
        return []

    certs: list[Certification] = []
    for raw in section.split("\n"):
        line = re.sub(r"^[-•*\s]+", "", raw).strip()
        if len(line) < 5 or len(line) > 220:
            continue

        issuer = next((h.title() for h in ISSUER_HINTS if h in line.lower()), None)
        year_match = YEAR_RE.search(line)
        link_match = URL_RE.search(line)

        name = re.split(r"\s*[-–|,]\s*(?:" + "|".join(ISSUER_HINTS) + ")", line, flags=re.IGNORECASE)[0]
        name = URL_RE.sub("", name).strip(" -–|,:")

        if name:
            certs.append(
                Certification(
                    name=name[:180],
                    issuer=issuer,
                    issuedOn=year_match.group(0) if year_match else None,
                    link=link_match.group(0) if link_match else None,
                )
            )

    return certs[:15]


def extract_achievements(section: str) -> list[str]:
    if not section:
        return []
    items = []
    for raw in section.split("\n"):
        line = re.sub(r"^[-•*\s]+", "", raw).strip()
        if 8 <= len(line) <= 300:
            items.append(line)
    return items[:15]


# --------------------------------------------------------------------------
# Top-level parse
# --------------------------------------------------------------------------

def parse_resume(text: str) -> dict[str, Any]:
    """Runs the full extraction pipeline over cleaned resume text."""
    sections = detect_sections(text)
    header = sections.get("header", "")

    contact = extract_contact(text, header)
    name = extract_name(header, text)

    education = extract_education(sections.get("education", ""))
    # Skills appear inside project and experience prose too, not just the skills
    # section, so the whole document is scanned.
    all_skills = extract_skills(text)

    experience_section = sections.get("experience", "")
    experiences = extract_experience(experience_section)
    internships = [e for e in experiences if e.type == "INTERNSHIP"]
    full_time = [e for e in experiences if e.type != "INTERNSHIP"]

    projects = extract_projects(sections.get("projects", ""))
    certifications = extract_certifications(sections.get("certifications", ""))
    achievements = extract_achievements(sections.get("achievements", ""))

    total_experience_months = sum(e.durationMonths for e in experiences)

    return {
        "name": name,
        "email": contact["email"],
        "phone": contact["phone"],
        "links": contact["links"],
        "education": [e.__dict__ for e in education],
        "skills": [s.name for s in all_skills],
        "programmingLanguages": by_category(all_skills, PROGRAMMING_LANGUAGE),
        "frameworks": by_category(all_skills, FRAMEWORK),
        "tools": by_category(all_skills, TOOL),
        "databases": by_category(all_skills, DATABASE),
        "cloud": by_category(all_skills, CLOUD),
        "fundamentals": by_category(all_skills, CS_FUNDAMENTAL),
        "projects": [p.__dict__ for p in projects],
        "internships": [e.__dict__ for e in internships],
        "experience": [e.__dict__ for e in full_time],
        "certifications": [c.__dict__ for c in certifications],
        "achievements": achievements,
        "totalExperienceMonths": total_experience_months,
        "sections": {k: v[:4000] for k, v in sections.items()},
        "detectedSectionNames": sorted(sections.keys()),
        "wordCount": len([w for w in re.split(r"\s+", text) if w]),
        "cgpa": next((e.cgpa for e in education if e.cgpa is not None), None),
    }
