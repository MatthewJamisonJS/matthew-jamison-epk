#!/usr/bin/env python3
"""Release scheduled blog drafts whose publish_at date has arrived.

Copied from ~/Code/jss-landing/scripts/release_scheduled.py; the only changes
are the content directory and the paths in the warning text.

A scheduled post is a markdown file under content/blog/ with TOML front matter
carrying `draft = true` and `publish_at = <YYYY-MM-DD>` — the shape
~/Code/mj-writing-room/scripts/ship.py writes. On or after that date
(America/Chicago), this flips `draft = false` and sets `date = publish_at`, so
scripts/build.mjs renders it on the next deploy. The post sits invisibly on
`main` until then.

A draft with NO `publish_at` is left alone but reported with a warning, so an
unscheduled draft can never silently rot; every daily run surfaces it.

Stdlib only (Python 3.11+ for tomllib). Idempotent: an already-released post
(`draft = false`) is skipped. See
docs/superpowers/specs/2026-09-04-content-layer-design.md
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import tomllib
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Chicago")
FENCE = "+++"
DEFAULT_CONTENT_DIR = Path(__file__).resolve().parent.parent / "content" / "blog"


def split_front_matter(text: str) -> tuple[str | None, str]:
    """Return (front_matter_text, body). front_matter_text is None when the file
    has no leading +++ TOML block.

    Fences are matched as whole lines (a line that is exactly +++, ignoring
    surrounding whitespace), the same rule Hugo uses. A line that merely starts
    with +++ inside the body or a multiline value is therefore not mistaken for
    the closing fence."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != FENCE:
        return None, text
    for i in range(1, len(lines)):
        if lines[i].strip() == FENCE:
            fm = "\n".join(lines[1:i])
            body = "\n".join(lines[i + 1:])
            return fm, body
    return None, text


def _coerce_date(value) -> dt.date | None:
    """Accept a TOML date (2026-07-01) or an ISO date string; else None."""
    if isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return value
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return dt.date.fromisoformat(value.strip())
        except ValueError:
            return None
    return None


def rewrite_front_matter(fm: str, publish_iso: str) -> str:
    """Set draft = false and date = publish_iso in the front-matter block,
    preserving every other line (comments, publish_at, ordering). Inserts a
    date line if none exists."""
    out: list[str] = []
    saw_date = False
    for line in fm.split("\n"):
        stripped = line.lstrip()
        if stripped.startswith("draft") and "=" in line and line.split("=", 1)[0].strip() == "draft":
            out.append("draft = false")
        elif stripped.startswith("date") and "=" in line and line.split("=", 1)[0].strip() == "date":
            out.append(f"date = {publish_iso}")
            saw_date = True
        else:
            out.append(line)
    if not saw_date:
        out.insert(0, f"date = {publish_iso}")
    return "\n".join(out)


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _lacks_cover(meta: dict) -> bool:
    """True when the front matter has no usable index-card cover.

    The blog index card renders bare unless BOTH `image` and `image_alt` are
    present and non-empty, so an empty string counts as missing.
    """
    for key in ("image", "image_alt"):
        value = meta.get(key)
        if not isinstance(value, str) or not value.strip():
            return True
    return False


def release(content_dir: Path, today: dt.date, apply: bool = True) -> dict:
    """Scan content_dir for scheduled posts and (optionally) release the due ones.

    Returns a dict of slug lists: released, future, unscheduled, published,
    malformed, skipped, bare, bare_upcoming. Pure except for the file writes it
    does when apply=True.

    `bare` = posts released on this run whose front matter has no image /
    image_alt (warn-only; they still publish). `bare_upcoming` = drafts not yet
    released (future or unscheduled) with the same gap, so it surfaces days
    before release rather than on release day.
    """
    result = {
        "released": [], "future": [], "unscheduled": [],
        "published": [], "malformed": [], "skipped": [],
        "bare": [], "bare_upcoming": [],
    }
    for path in sorted(content_dir.glob("*.md")):
        if path.name == "_index.md":
            continue
        slug = path.stem
        # utf-8-sig transparently strips a leading BOM (some editors add one),
        # so a BOM-prefixed draft is still detected rather than silently skipped.
        text = path.read_text(encoding="utf-8-sig")
        fm, body = split_front_matter(text)
        if fm is None:
            result["skipped"].append(slug)
            continue
        try:
            meta = tomllib.loads(fm)
        except tomllib.TOMLDecodeError:
            result["malformed"].append(slug)
            continue

        if meta.get("draft") is not True:
            result["published"].append(slug)
            continue

        if "publish_at" not in meta:
            result["unscheduled"].append(slug)
            if _lacks_cover(meta):
                result["bare_upcoming"].append(slug)
            continue

        publish_date = _coerce_date(meta["publish_at"])
        if publish_date is None:
            result["malformed"].append(slug)
            continue

        if publish_date > today:
            result["future"].append(slug)
            if _lacks_cover(meta):
                result["bare_upcoming"].append(slug)
            continue

        # Due: release it.
        if apply:
            new_fm = rewrite_front_matter(fm, publish_date.isoformat())
            _atomic_write(path, f"{FENCE}\n{new_fm}\n{FENCE}\n{body}")
        result["released"].append(slug)
        # Warn-only by ruling: a missing cover never blocks publication.
        if _lacks_cover(meta):
            result["bare"].append(slug)

    return result


def _emit_ci(result: dict) -> None:
    """Surface results to GitHub Actions: step outputs, a run summary, and a
    warning annotation per unscheduled draft and per bare-cover release (the
    spec's 'surfaces to the User')."""
    released = result["released"]
    out_path = os.environ.get("GITHUB_OUTPUT")
    if out_path:
        with open(out_path, "a", encoding="utf-8") as fh:
            fh.write(f"released={'true' if released else 'false'}\n")
            fh.write(f"slugs={', '.join(released)}\n")

    # Warn (prominently) about drafts that will never auto-publish.
    for slug in result["unscheduled"]:
        print(
            f"::warning title=Unscheduled draft::"
            f"content/blog/{slug}.md is draft = true with no publish_at; "
            f"it will never auto-publish. Add publish_at = <YYYY-MM-DD> to schedule it.",
            file=sys.stdout,
        )
    for slug in result.get("bare", []):
        print(
            f"::warning title=Bare cover::"
            f"content/blog/{slug}.md released without image/image_alt; "
            f"the blog index card renders bare.",
            file=sys.stdout,
        )
    for slug in result["malformed"]:
        print(
            f"::warning title=Malformed front matter::"
            f"content/blog/{slug}.md could not be parsed or has a bad publish_at; skipped.",
            file=sys.stdout,
        )

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        lines = ["## Scheduled publishing run", ""]
        lines.append(f"- Released: {', '.join(released) if released else 'none'}")
        if result["unscheduled"]:
            lines.append(f"- ⚠ Unscheduled drafts (no publish_at): {', '.join(result['unscheduled'])}")
        if result.get("bare"):
            lines.append(
                f"- ⚠ Released with a bare card (no image/image_alt): {', '.join(result['bare'])}"
            )
        if result.get("bare_upcoming"):
            lines.append(
                f"- ⚠ Upcoming drafts missing image/image_alt: {', '.join(result['bare_upcoming'])}"
            )
        if result["malformed"]:
            lines.append(f"- ⚠ Malformed/skipped: {', '.join(result['malformed'])}")
        if result["future"]:
            lines.append(f"- Waiting (future publish_at): {', '.join(result['future'])}")
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content-dir", type=Path, default=DEFAULT_CONTENT_DIR)
    parser.add_argument("--today", help="override today's date (YYYY-MM-DD) for testing")
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args(argv)

    today = dt.date.fromisoformat(args.today) if args.today else dt.datetime.now(TZ).date()

    if not args.content_dir.is_dir():
        print(f"error: content dir not found: {args.content_dir}", file=sys.stderr)
        return 1

    result = release(args.content_dir, today, apply=not args.dry_run)
    _emit_ci(result)

    print(
        f"today={today} released={result['released']} future={result['future']} "
        f"unscheduled={result['unscheduled']} malformed={result['malformed']} "
        f"published={result['published']} bare={result['bare']} "
        f"bare_upcoming={result['bare_upcoming']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
