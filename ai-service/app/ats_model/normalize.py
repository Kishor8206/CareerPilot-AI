"""Text normalisation and section-boundary reconstruction.

Why reconstruction is necessary
-------------------------------
Every resume and job description in the public fit datasets (0xnbk, med2425)
has had its line structure destroyed upstream: the corpus contains zero
newline characters. Headings are glued to the following word — "SummaryI am
seeking…", "Highlights17 years experience…".

CareerPilot's deterministic parser detects sections line by line, so on this
text it finds only a `header` section in every resume. Scoring the raw text
would penalise every resume for "missing" sections that are present but
unseparated — producing systematically wrong weak labels.

Reinserting a newline around a known heading is non-destructive: no word is
removed or altered, only the boundary the original document had is restored.
"""
from __future__ import annotations

import re
import unicodedata

# Headings used by the LiveCareer-derived resume corpus that both public fit
# datasets descend from, ordered longest-first so "Professional Summary" wins
# over "Summary". Title case is required: these are headings, and matching
# lowercase would split ordinary prose ("my experience with…").
_HEADINGS = sorted(
    [
        "Professional Summary", "Career Overview", "Executive Profile", "Summary of Qualifications",
        "Core Qualifications", "Skill Highlights", "Summary", "Profile", "Objective",
        "Career Objective", "Highlights", "Qualifications",
        "Professional Experience", "Work Experience", "Work History", "Experience",
        "Employment History", "Education and Training", "Education", "Academic Background",
        "Technical Skills", "Skills", "Core Competencies", "Areas of Expertise",
        "Accomplishments", "Achievements", "Awards", "Certifications", "Certificates",
        "Licenses", "Projects", "Publications", "Affiliations", "Interests",
        "Languages", "Additional Information", "Volunteer Experience", "Presentations",
    ],
    key=len,
    reverse=True,
)

# A heading is glued when it is followed immediately by an uppercase letter or
# a digit ("SummaryI", "Highlights17"), and is preceded by the start of text,
# whitespace, sentence punctuation, or a lowercase letter ("…workflowExperience").
_GLUED = re.compile(
    r"(?:(?<=^)|(?<=[\s.;:!?)\]])|(?<=[a-z]))"
    r"(" + "|".join(re.escape(h) for h in _HEADINGS) + r")"
    r"(?=[A-Z0-9])"
)

_CONTROL = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
_REPEAT_PUNCT = re.compile(r"([^\w\s])\1{3,}")   # "-----" / "*****" → one char
_SPACES = re.compile(r"[ \t\u00A0]{2,}")
_MANY_NL = re.compile(r"\n{3,}")


def clean_text(text: str) -> str:
    """Encoding and whitespace normalisation. Never removes words."""
    if not isinstance(text, str):
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub(" ", text)
    text = _REPEAT_PUNCT.sub(r"\1", text)
    text = _SPACES.sub(" ", text)
    text = _MANY_NL.sub("\n\n", text)
    return text.strip()


def restore_sections(text: str) -> str:
    """Put known headings that are GLUED to the next word back on their own line.

    Applied regardless of how many newlines the text has. An earlier version
    skipped text with >= 3 newlines on the assumption it was already
    structured, but the med2425 corpus has a few newlines AND glued headings
    ("SummaryMore than 15 years..."), so 96% of it went unrestored and its
    structure and project-relevance labels collapsed to zero. `_GLUED` only
    matches a heading fused to a following capital or digit, so a properly
    formatted resume ("Summary\\nI am...") is left untouched.
    """
    restored = _GLUED.sub(lambda m: f"\n{m.group(1)}\n", text)
    return _MANY_NL.sub("\n\n", restored).strip()


def normalise_resume(text: str) -> str:
    return restore_sections(clean_text(text))


def normalise_jd(text: str) -> str:
    # JDs are matched on skills and keywords, not sections; cleaning suffices.
    return clean_text(text)


def clip(text: str, max_chars: int) -> str:
    """Serving-time length guard. Keeps the BEGINNING and marks the cut, as the
    training data does, so the model is told content was removed rather than
    led to believe the document ended there. (Training truncates by exact token
    count; serving has no tokenizer, so ~3.5 chars/token is used conservatively.)"""
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    space = cut.rfind(" ")
    return (cut[:space] if space > max_chars * 0.8 else cut).rstrip() + " [...]"


RESUME_MAX_CHARS = 7700   # ~2,200 tokens: the training input budget
JD_MAX_CHARS = 2450       # ~700 tokens: the training JD cap
