# no-blanket-file-exclusion-guard

PreToolUse hook that blocks Edit/Write tool calls introducing a `max-file-lines:` file-size exemption marker that does not name a real category.

A file may not wave itself past the soft/hard line cap by asserting it deems itself acceptable. The only valid marker is `max-file-lines: <category> — <reason>`: a single hyphenated category word naming WHAT the file is, plus a separated reason for WHY it can't split. A self-judgment word (`legitimate`, `ok`, `exempt`, `acceptable`, …) is not a description and does not exempt.

This is the edit-time layer of a three-layer defense: the `socket/max-file-lines` oxlint rule catches the same shape at lint time, and the soft/hard caps fire at every commit.

The marker is **hard-cap-only** (>1000 lines): a file in the soft band (501–1000) gets no exemption and must split. The oxlint rule ignores any marker in the soft band and reports anyway; this hook enforces the shape contract on whatever marker does land. In almost every case the answer is to split along a natural seam — reach for a marker only for a genuine single cohesive unit past 1000 lines (or a generated file).

## Allowed

- `max-file-lines: parser — recursive-descent grammar`
- `max-file-lines: state-machine — exhaustive transition table`
- `max-file-lines: integration-test — one end-to-end scenario per file`

## Blocked

- `max-file-lines: legitimate` (self-judgment, no category)
- `max-file-lines: legitimate — one cohesive module` (self-judgment leads)
- `max-file-lines: ok — it's fine` (self-judgment word as category)
- `max-file-lines: parser` (category present, no `— reason`)

## Bypass

No bypass — name a real category (or, better, split the file along a natural seam so it no longer needs an exemption).
