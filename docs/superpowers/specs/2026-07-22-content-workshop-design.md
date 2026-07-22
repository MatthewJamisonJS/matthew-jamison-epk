# Content Workshop — self-authored copy workflow + repo-agnostic skill

Date: 2026-07-22
Status: approved (plan mode, 5 design questions answered by Matthew)

## Problem

Matthew wants every word on the EPK site to be his own. The current flow (Claude drafts, Matthew approves per element) still starts from Claude's words. Flip it: Claude scaffolds a granular "workshop" Markdown doc listing every visible string with current copy shown; Matthew writes into it on his own time (Zed); Claude applies his words to the page verbatim. Then generalize the workflow into a repo-agnostic personal skill.

## Decisions

1. **Granularity** — every visible string: headings, paragraphs, buttons, stat labels, link text, captions. Aria/meta excluded (small opt-in appendix only).
2. **Slot format** — current copy as `> current:` reference + blank write-in block. Blank = keep current, so the doc supports work-in-passes.
3. **Sourcing** — verbatim application (HTML-escape `& < >` only; markdown `*em*` / `` `code` `` in write-ins converts to `<em>`/`<code>`). Claude never edits. After applying, Claude lists flags — typo suspects, canonical-fact conflicts, WCAG AA concerns — and waits for Matthew's call.
4. **Skill** — `content-workshop`, personal skill at `~/.claude/skills/content-workshop/`.
5. **Slot mapping** — metadata comment per slot: source file + exact current source text (+ occurrence note where the string repeats). Apply = exact string match with surrounding markup added for uniqueness. Source drifted since generation → conflict flag, never fuzzy-apply. No annotations added to site markup.
6. **Editor** — open generated doc in Zed (`zed` CLI), fall back to `$EDITOR`, else report the path.

## Workshop doc format

```markdown
<!-- slot:bio.short.p1 file:index.html -->
### bio — short · paragraph 1

> current:
> St. Louis. I grew up in the church; bongos &amp; auxiliary percussion...

<!-- WRITE BELOW -->

<!-- END -->
```

Slot types:
- **single** — one element (heading, paragraph, button label, quote).
- **grouped list** — repetitive collections (catalog tile names, rider items, nav links, caption fragments): one slot, one line per item, rewrite any line. Blank or unchanged line = keep.

Multi-paragraph bodies (bio short/medium/long) get one slot per paragraph. `> current:` shows source-exact text (entities and inline tags visible) so the replace target is unambiguous.

## Apply semantics

1. Parse slots from `content-workshop.md`.
2. Non-empty write-in → replace recorded current text in the recorded file, verbatim (escaped), preserving surrounding markup and indentation. Ambiguous match → widen match context; still ambiguous or text missing → conflict, skip, report.
3. Report: applied / skipped-blank / conflicts, then flags (typos, canonical facts, AA). No edits from flags without explicit go-ahead.

## Skill design (`content-workshop`)

**Draft phase** (trigger: user wants to write their own site/page copy):
- Context order: read `.claude/rules/*` if present → direct Glob/Read of content files. Never spawn Explore/general-purpose agents; if scope unclear, ask the user for paths first.
- Generate `content-workshop.md` at repo root per the slot spec; open in editor.

**Apply phase** (trigger: "apply/source the workshop"): semantics above. Works in a later session — the doc is self-describing.

**Research rules baked in:** web search from canonical root URLs when unsure; never fetch/firecrawl a guessed deep URL; external facts verified against a really-fetched page or asked.

## BDD scenarios

```
Story: Workshop doc generation
  In order to put my own words on my site,
  Matthew wants a granular write-in doc scaffolded from the current page.

  Scenario: Doc generated
    Given the EPK repo with index.html
    When Matthew asks to open the content workshop
    Then content-workshop.md exists with one slot per visible string,
      each showing current copy and an empty write-in block,
      and the doc opens in Zed

Story: Applying his words
  Scenario: One slot filled
    Given a saved workshop doc with new text only in the short-bio slot
    When Matthew asks to apply the workshop
    Then only that string in index.html changes, verbatim,
      and the report shows 1 applied / rest skipped

  Scenario: Source drifted
    Given a slot whose recorded current text no longer exists in index.html
    When applying
    Then the slot is flagged as a conflict and that part of the file is untouched

Story: Skill reuse in another repo
  Scenario: Rules-first discovery
    Given a repo with .claude/rules describing its templates
    When the skill drafts a workshop doc
    Then it reads rules and content files directly and spawns no Explore agents
```

## Verification

- Slot count cross-checked against visible strings in `index.html`; spot-check hero, stats, one rider list, footer.
- Apply tested on a scratchpad copy: one filled slot → exactly one diff line; blanks untouched; drift test → conflict flagged. Real file only touched with Matthew's words.
- Skill: plugin-dev skill-reviewer pass; description triggers on "write my own copy" phrasing; no-Explore-agents and no-guessed-URL rules present verbatim.
- WCAG: applied copy re-checked for empty headings/links; flag if Matthew's words create any.
