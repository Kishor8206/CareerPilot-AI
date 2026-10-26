"""Resource verification: is this URL real, reachable, on the provider it claims, and about the skill?

A resource is only ever marked `verified` by this module, after a real request.

SSRF protection — this service fetches URLs, so it must not be usable to reach
internal systems:
  * https only;
  * the host must be on the declared provider's domain (an allow-list per
    resource, not an open fetcher);
  * every address the host resolves to must be public — private, loopback,
    link-local, reserved and multicast ranges are refused;
  * redirects are followed by hand, at most 3, re-checking each hop;
  * short timeouts and a hard cap on bytes read.
Residual risk: a DNS answer could change between the check and the connection
(DNS rebinding). The provider allow-list is what bounds that in practice.
"""
from __future__ import annotations

import ipaddress
import re
import socket
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

MAX_REDIRECTS = 3
MAX_BYTES = 200_000
TIMEOUT = httpx.Timeout(12.0, connect=6.0)
USER_AGENT = "CareerPilot-ResourceVerifier/1.0 (+educational project; verifies learning-resource links)"
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)

STATUSES = ("verified", "reachable", "unreachable", "blocked", "unverified")


class BlockedUrl(Exception):
    """The URL was refused before any request was made."""


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_multicast or ip.is_unspecified)


def check_url(url: str, allowed_domains: list[str]) -> str:
    """Raise BlockedUrl unless the URL is https, on an allowed domain and
    resolves only to public addresses. Returns the host."""
    parts = urlparse(url)
    if parts.scheme != "https":
        raise BlockedUrl(f"scheme '{parts.scheme}' is not allowed (https only)")
    if parts.username or parts.password:
        raise BlockedUrl("credentials in URL are not allowed")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise BlockedUrl("no host")
    if not any(host == d or host.endswith("." + d) for d in (x.lower() for x in allowed_domains)):
        raise BlockedUrl(f"host '{host}' is not on the provider's domain {allowed_domains}")
    try:
        ipaddress.ip_address(host)
        raise BlockedUrl("literal IP addresses are not allowed")
    except ValueError:
        pass
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, parts.port or 443, proto=socket.IPPROTO_TCP)}
    except socket.gaierror as exc:
        raise BlockedUrl(f"host does not resolve: {exc}") from exc
    for address in addresses:
        if not _is_public(address):
            raise BlockedUrl(f"host resolves to a non-public address ({address})")
    return host


def _relevant(text: str, terms: list[str]) -> bool:
    lowered = text.lower()
    return any(re.search(r"(?<![a-z0-9])" + re.escape(t.lower()) + r"(?![a-z0-9])", lowered) for t in terms if t)


def verify(resource: dict[str, Any], skill_terms: list[str], client: httpx.Client | None = None) -> dict[str, Any]:
    """Check one resource. Returns the fields to merge into it:
    verification_status, last_verified, verification_detail, final_url, page_title."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out: dict[str, Any] = {"last_verified": now, "final_url": None, "page_title": None}
    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": USER_AGENT})
    try:
        url = resource["url"]
        for _ in range(MAX_REDIRECTS + 1):
            check_url(url, resource["allowed_domains"])
            with client.stream("GET", url) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        return {**out, "verification_status": "unreachable", "verification_detail": "redirect without location"}
                    url = urljoin(url, location)
                    continue
                if response.status_code >= 400:
                    return {**out, "verification_status": "unreachable", "final_url": url,
                            "verification_detail": f"HTTP {response.status_code}"}
                body = b""
                for chunk in response.iter_bytes():
                    body += chunk
                    if len(body) >= MAX_BYTES:
                        break
            text = body.decode("utf-8", errors="ignore")
            match = _TITLE.search(text)
            title = re.sub(r"\s+", " ", match.group(1)).strip()[:200] if match else None
            relevant = _relevant((title or "") + " " + text, skill_terms)
            return {**out, "final_url": url, "page_title": title,
                    "verification_status": "verified" if relevant else "reachable",
                    "verification_detail": ("reachable on the provider's domain and mentions the skill" if relevant
                                            else "reachable on the provider's domain; skill not confirmed on the page")}
        return {**out, "verification_status": "unreachable", "verification_detail": "too many redirects"}
    except BlockedUrl as exc:
        return {**out, "verification_status": "blocked", "verification_detail": str(exc)}
    except httpx.HTTPError as exc:
        return {**out, "verification_status": "unreachable", "verification_detail": f"{type(exc).__name__}: {exc}"[:200]}
    finally:
        if own:
            client.close()
