# File size

The CLAUDE.md `### File size` section is the cap; this file is the splitting playbook and the explicit exception list.

## Caps

Source files have a **soft cap of 500 lines** and a **hard cap of 1000 lines**. Past those thresholds, split the file along its natural seams. Long files are not a badge of thoroughness — they are a sign the module is doing too many things.

## How to split

- **Group by domain or concept, not by line count.** Lines 0–500 of a 1500-line file is not a split. Find the natural boundary (one tool per file, one ecosystem per file, one orchestration phase per file) and cut there.
- **Name the new files for what they are.** `spawn-cdxgen.mts`, `spawn-coana.mts`, `parse-arguments.mts`, `validate-options.mts` — the file name should match what's inside it. Avoid generic suffixes (`-helpers`, `-utils`, `-lib`) that just kick the can down the road.
- **Co-locate related helpers with their consumer.** A helper used only by one function lives next to that function in the same file (or the same domain split). A helper used across three files lives in a shared module named after the concept (`format-purl.mts`, not `purl-helpers.mts`).
- **Update the index/barrel only if one already exists.** Don't introduce a barrel just to hide the split — let importers update their paths to the specific file. Barrels are for stable public surfaces.
- **Run tests after each split, not at the end.** A reviewable commit is one logical extraction. Batching ten splits into one commit makes a regression impossible to bisect.

## When NOT to split

- A single function legitimately needs 500 lines (a parser, a state machine, a configuration table). State this in a one-line comment at the top of the function.
- The file is a generated artifact (lockfile-style data, schema dump). Generated files don't count toward the cap.

## Principle

A reader should be able to predict what's in a file from its name, and find what they need without scrolling past three other concerns. If a file's table-of-contents reads like "this and also that and also the other thing," it's overdue for a split.
