# File size

The CLAUDE.md `### File size` section is the cap. This file is the splitting playbook and the explicit exception list.

## Caps

Source files have a **soft cap of 500 lines** and a **hard cap of 1000 lines**. Past those thresholds, split the file along its natural seams. Long files are not a badge of thoroughness. They are a sign the module is doing too many things.

## How to split

- **Group by domain or concept, not by line count.** Lines 0–500 of a 1500-line file is not a split. Find the natural boundary (one tool per file, one ecosystem per file, one orchestration phase per file) and cut there.
- **Name the new files for what they are.** `spawn-cdxgen.mts`, `spawn-coana.mts`, `parse-arguments.mts`, `validate-options.mts`. The file name should match what's inside it. Avoid generic suffixes (`-helpers`, `-utils`, `-lib`) that just kick the can down the road.
- **Co-locate related helpers with their consumer.** A helper used only by one function lives next to that function in the same file (or the same domain split). A helper used across three files lives in a shared module named after the concept (`format-purl.mts`, not `purl-helpers.mts`).
- **Update the index/barrel only if one already exists.** Don't introduce a barrel just to hide the split. Let importers update their paths to the specific file. Barrels are for stable public surfaces.
- **Run tests after each split, not at the end.** A reviewable commit is one logical extraction. Batching ten splits into one commit makes a regression impossible to bisect.

## When NOT to split

There is exactly one case, and it lives **past the hard cap (>1000 lines)**:

- A single function legitimately needs the space (a parser, a state machine, a configuration table), or the file is a generated artifact (lockfile-style data, schema dump). Generated files the lint config already ignores don't count toward the cap.

A file in the **soft band (501–1000) always splits.** There is no "when NOT to split" in the soft band — the cap forces the seam. If a 600-line file feels cohesive, that is the signal it has two concerns sharing a scope, not an exception.

## Exemption markers: hard-cap-only, no blanket exclusions

The exemption marker is **hard-cap-only**. A file past 1000 lines that is one genuine cohesive unit (generated artifact, a single parser/state-machine/table, a one-flow CLI) marks itself `max-file-lines: <category> — <reason>`. The `<category>` is a single hyphenated word naming WHAT the file is (`parser`, `state-machine`, `table`, `cli`, `integration-test`, `vendored`, and the like); the `<reason>` after the separator says WHY it can't split.

**A soft-band (501–1000) marker is ignored** — the `socket/max-file-lines` rule reports the warning anyway. You cannot mark a soft-band file exempt; you split it. A bare self-judgment marker (`legitimate`, `ok`, `exempt`, `acceptable`) is NOT a category and never exempts, at any size. A file may not wave itself through by asserting it deems itself fine; it must name what it is, and be past the hard cap.

Enforced three ways: the `socket/max-file-lines` oxlint rule (which gates the marker to >1000) at lint time, `.claude/hooks/fleet/no-blanket-file-exclusion-guard/` (which blocks a bad-shape marker) at edit time, and the soft/hard caps at every commit.

## Principle

A reader should be able to predict what's in a file from its name, and find what they need without scrolling past three other concerns. If a file's table-of-contents reads like "this and also that and also the other thing," it's overdue for a split.
