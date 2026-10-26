"""Add verified YouTube tutorials to the resource catalogue.

    python training/fetch_youtube_resources.py              # top 60 skills by importance
    python training/fetch_youtube_resources.py --skills 30

Needs YOUTUBE_API_KEY in .env. Quota: search.list costs 100 units and the
default daily quota is 10,000, so this is limited to ~60 searches and every
raw response is cached under data/raw/youtube/ — re-running costs nothing.

Verification uses the YouTube Data API itself (videos.list, 1 unit per 50
videos), which is more reliable than fetching watch pages:
    verified   public, embeddable, and the title names the skill
    reachable  public and embeddable, but the title does not name the skill
    (private, deleted or non-embeddable videos are dropped)
Search results are candidates, not endorsements: no quality rating is invented.
`quality_score` is a fixed editorial weight (0.6) below official documentation.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone

import httpx

from common import KNOWLEDGE, RAW, publish, read_json

from app.core.config import settings

CACHE = RAW / "youtube"
PER_SKILL = 3
_DUR = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def minutes(iso: str) -> int | None:
    m = _DUR.fullmatch(iso or "")
    return None if not m else int(m.group(1) or 0) * 60 + int(m.group(2) or 0) + (1 if int(m.group(3) or 0) >= 30 else 0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skills", type=int, default=60)
    args = ap.parse_args()
    key = (settings.youtube_api_key or "").strip()
    if not key:
        print("YOUTUBE_API_KEY is not set; nothing fetched.")
        sys.exit(1)

    taxonomy = read_json(KNOWLEDGE / "skill_taxonomy.json")
    skills = {s["canonical_skill"]: s for s in taxonomy["skills"]}
    ranked = [s["canonical_skill"] for s in sorted(taxonomy["skills"], key=lambda s: -s["importance"]) if s["category"] != "SOFT"]
    CACHE.mkdir(parents=True, exist_ok=True)

    searches = 0
    found: dict[str, dict] = {}
    with httpx.Client(timeout=20) as client:
        for skill in ranked[: args.skills]:
            cache = CACHE / (re.sub(r"[^a-z0-9]+", "_", skill.lower()) + ".json")
            if not cache.exists():
                r = client.get("https://www.googleapis.com/youtube/v3/search",
                               params={"key": key, "q": f"{skill} tutorial for beginners", "part": "snippet", "type": "video",
                                       "maxResults": 8, "relevanceLanguage": "en", "safeSearch": "strict",
                                       "videoEmbeddable": "true", "videoDuration": "medium"})
                if r.status_code != 200:
                    err = r.json().get("error", {})
                    print(f"stopped at '{skill}': HTTP {r.status_code} {err.get('status')} — {str(err.get('message'))[:120]}")
                    break
                cache.write_text(json.dumps(r.json()), encoding="utf-8")
                searches += 1
            for item in json.loads(cache.read_text(encoding="utf-8")).get("items", [])[:PER_SKILL]:
                vid = item["id"]["videoId"]
                entry = found.setdefault(vid, {"snippet": item["snippet"], "skills": []})
                if skill not in entry["skills"]:
                    entry["skills"].append(skill)

        # ---- verify through the API: 50 ids per call, 1 quota unit each
        details: dict[str, dict] = {}
        ids = sorted(found)
        for i in range(0, len(ids), 50):
            r = client.get("https://www.googleapis.com/youtube/v3/videos",
                           params={"key": key, "id": ",".join(ids[i:i + 50]), "part": "status,contentDetails,snippet"})
            r.raise_for_status()
            for item in r.json().get("items", []):
                details[item["id"]] = item

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    videos, dropped = [], Counter()
    for vid, entry in found.items():
        d = details.get(vid)
        if d is None:
            dropped["not_found"] += 1
            continue
        if d["status"].get("privacyStatus") != "public" or not d["status"].get("embeddable", False):
            dropped["not_public_or_embeddable"] += 1
            continue
        title = d["snippet"]["title"]
        terms = [t for s in entry["skills"] for t in (s, *skills[s]["aliases"])]
        named = any(re.search(r"(?<![a-z0-9])" + re.escape(t.lower()) + r"(?![a-z0-9])", title.lower()) for t in terms)
        videos.append({
            "resource_id": f"yt_{vid}", "title": title, "provider": d["snippet"]["channelTitle"],
            "resource_type": "youtube_video", "url": f"https://www.youtube.com/watch?v={vid}",
            "allowed_domains": ["youtube.com"], "skill_ids": entry["skills"], "difficulty": ["beginner"],
            "language": d["snippet"].get("defaultAudioLanguage") or d["snippet"].get("defaultLanguage") or "en",
            "duration": minutes(d["contentDetails"].get("duration", "")), "rating": None,
            "quality_score": 0.6, "quality_score_basis": "editorial weight by resource type",
            "verification_status": "verified" if named else "reachable", "last_verified": now,
            "verification_detail": ("YouTube API: public, embeddable; title names the skill" if named
                                    else "YouTube API: public, embeddable; title does not name the skill"),
            "page_title": title,
        })

    catalogue = read_json(KNOWLEDGE / "resources.json")
    kept = [r for r in catalogue["resources"] if r["resource_type"] != "youtube_video"]
    resources = kept + sorted(videos, key=lambda r: r["resource_id"])
    status = Counter(r["verification_status"] for r in resources)
    usable = {s for r in resources if r["verification_status"] in ("verified", "reachable") for s in r["skill_ids"]}
    catalogue.update(resources=resources, summary={"total": len(resources), "by_status": dict(status),
                                                   "by_type": dict(Counter(r["resource_type"] for r in resources)),
                                                   "skills_with_a_usable_resource": len(usable), "skills_total": len(skills)})
    publish("resources.json", catalogue)
    print(f"searches made now: {searches} (~{searches * 100} quota units) | cached skills: {len(list(CACHE.glob('*.json')))}")
    print(f"videos: {len(videos)} kept, dropped {dict(dropped)} | "
          f"{dict(Counter(v['verification_status'] for v in videos))}")
    print(f"catalogue: {len(resources)} resources {catalogue['summary']['by_type']} | status {dict(status)}")
    print(f"skills with a usable resource: {len(usable)}/{len(skills)}")


if __name__ == "__main__":
    main()
