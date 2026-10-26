"""Resource service: find and rank learning resources, and resolve resource IDs.

The career model never produces URLs. It is shown candidate resources by ID,
selects IDs, and this service resolves them — so a hallucinated link cannot
reach a student, and links can be re-verified or replaced without retraining.

Ranking is deterministic. Score (higher is better):
    3.0  the resource covers the skill                 (required to be a candidate)
  + 2.0  its difficulty matches the learner's stage
  + 1.5  verified   | +0.5 reachable                   (unreachable/blocked are excluded)
  + quality_score (0-1, an editorial rating by resource type — not a user rating)
  + 0.5  resource type matches the learner's preference
  + 0.3  language matches
Ties break on resource_id, so the order is reproducible.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import httpx

from app.career.knowledge import DATA_DIR, get_knowledge

CATALOGUE = DATA_DIR / "resources.json"
USABLE = {"verified", "reachable"}
STAGE = {"none": "beginner", "beginner": "beginner", "intermediate": "intermediate", "advanced": "advanced"}
PREFERENCE_TYPES = {"video": {"youtube_video", "youtube_playlist"}, "reading": {"documentation", "book", "tutorial"},
                    "hands-on": {"practice_platform", "project_resource", "free_course"},
                    "course": {"free_course", "paid_course"}}


class ResourceCatalogue:
    def __init__(self, resources: list[dict[str, Any]]) -> None:
        self.by_id = {r["resource_id"]: r for r in resources}

    def exists(self, resource_id: str) -> bool:
        return resource_id in self.by_id

    def resolve(self, resource_ids: Iterable[str]) -> tuple[list[dict[str, Any]], list[str]]:
        """-> (resources for known, usable IDs; IDs that were unknown or unusable)."""
        found, rejected = [], []
        for rid in resource_ids:
            r = self.by_id.get(rid)
            if r and r["verification_status"] in USABLE:
                found.append(r)
            else:
                rejected.append(rid)
        return found, rejected

    def candidates(self, skill: str, stage: str = "beginner", *, preference: str | None = None,
                   language: str = "en", limit: int = 3) -> list[dict[str, Any]]:
        stage = STAGE.get(stage, "beginner")
        wanted = PREFERENCE_TYPES.get((preference or "").lower(), set())
        scored = []
        for r in self.by_id.values():
            if skill not in r["skill_ids"] or r["verification_status"] not in USABLE:
                continue
            score = (3.0 + (2.0 if stage in r["difficulty"] else 0.0)
                     + (1.5 if r["verification_status"] == "verified" else 0.5)
                     + float(r.get("quality_score") or 0.0)
                     + (0.5 if r["resource_type"] in wanted else 0.0)
                     + (0.3 if r.get("language") == language else 0.0))
            scored.append((-round(score, 3), r["resource_id"], r))
        return [r for _, _, r in sorted(scored)[:limit]]

    def for_gaps(self, gaps: list[dict[str, Any]], *, preference: str | None = None, per_skill: int = 2,
                 limit: int = 12) -> list[dict[str, Any]]:
        """Candidates for a plan: highest-priority gaps first, no duplicates."""
        order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
        picked: dict[str, dict[str, Any]] = {}
        for gap in sorted(gaps, key=lambda g: (order[g["priority"]], -g["priority_score"])):
            for r in self.candidates(gap["skill"], gap["current_level"], preference=preference, limit=per_skill):
                picked.setdefault(r["resource_id"], r)
                if len(picked) >= limit:
                    return list(picked.values())
        return list(picked.values())


    def by_skill(self, gaps: list[dict[str, Any]], *, preference: str | None = None, reading: int = 2,
                 videos: int = 2) -> list[dict[str, Any]]:
        """For EVERY gap skill: its best courses/documentation and its best videos.

        The plan's `resource_ids` is a short list for the top priorities. This is
        the complete, per-skill view for the resources page. Retrieval and
        ranking only — no model is involved, so nothing here can be invented.
        """
        out = []
        for gap in gaps:
            ranked = self.candidates(gap["skill"], gap["current_level"], preference=preference, limit=50)
            video = [r for r in ranked if r["resource_type"].startswith("youtube")][:videos]
            other = [r for r in ranked if not r["resource_type"].startswith("youtube")][:reading]
            out.append({"skill": gap["skill"], "priority": gap["priority"], "current_level": gap["current_level"],
                        "required_level": gap["required_level"],
                        "courses_and_docs": [public_view(r) for r in other], "videos": [public_view(r) for r in video]})
        return out


@lru_cache(maxsize=1)
def get_catalogue() -> ResourceCatalogue:
    if not CATALOGUE.exists():
        return ResourceCatalogue([])
    return ResourceCatalogue(json.loads(CATALOGUE.read_text(encoding="utf-8"))["resources"])


def public_view(resource: dict[str, Any]) -> dict[str, Any]:
    """What the frontend receives: no internal verification detail."""
    keys = ("resource_id", "title", "provider", "resource_type", "url", "skill_ids", "difficulty", "language",
            "duration", "verification_status", "last_verified")
    return {k: resource.get(k) for k in keys}


# ----------------------------------------------------------------- YouTube
class ResourceProviderUnavailable(Exception):
    pass


def search_youtube(skill: str, stage: str, *, objective: str = "", language: str = "en",
                   max_results: int = 5) -> list[dict[str, Any]]:
    """Candidate videos from the YouTube Data API v3 (search.list).

    Needs YOUTUBE_API_KEY. Results are returned UNVERIFIED: a search hit is not
    a quality judgement, and nothing is added to the catalogue from here
    without passing through the verification service.
    """
    from app.core.config import settings
    api_key = (settings.youtube_api_key or os.environ.get("YOUTUBE_API_KEY", "")).strip()
    if not api_key:
        raise ResourceProviderUnavailable("YOUTUBE_API_KEY is not set; YouTube retrieval is disabled")
    if get_knowledge().skill(skill) is None:
        raise ValueError(f"unknown skill: {skill!r}")
    query = " ".join(x for x in (skill, STAGE.get(stage, "beginner"), objective, "tutorial") if x)
    response = httpx.get("https://www.googleapis.com/youtube/v3/search", timeout=15,
                         params={"key": api_key, "q": query, "part": "snippet", "type": "video",
                                 "maxResults": max(1, min(max_results, 25)), "relevanceLanguage": language,
                                 "safeSearch": "strict"})
    response.raise_for_status()
    out = []
    for item in response.json().get("items", []):
        video_id = item["id"]["videoId"]
        out.append({
            "resource_id": f"yt_{video_id}", "title": item["snippet"]["title"], "provider": item["snippet"]["channelTitle"],
            "resource_type": "youtube_video", "url": f"https://www.youtube.com/watch?v={video_id}",
            "allowed_domains": ["youtube.com"], "skill_ids": [get_knowledge().skill(skill)],
            "difficulty": [STAGE.get(stage, "beginner")], "language": language, "duration": None, "rating": None,
            "quality_score": 0.5, "verification_status": "unverified", "last_verified": None,
        })
    return out
