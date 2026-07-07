# max-file-lines hard-cap-only

## What

The per-file exemption comment (the `socket/max-file-lines` marker) exempts a file from the lint rule only past the 1000-line hard cap. A file in the soft band (501–1000 lines) must be split. The marker is silently ignored there and the rule reports anyway.

## Why

A categorized marker in the soft band was still an escape hatch that let oversized files dodge the cap. The fleet principle: rules enforce and hooks block. A marker that silently does nothing is policy-on-paper, not enforcement. Banning soft-band markers removes the escape hatch and forces the correct action: splitting.

## How to apply

**Over 500 lines, split along a natural seam.** Common strategies:

- **Comment-heavy registries.** When bulk is per-entry prose or catalog comments, move the prose to `docs/agents.md/fleet/<topic>.md` with a one-line pointer inline. This honors the cap's "defer detail to docs" intent.
- **Dispatchers and state machines.** Extract themed sub-modules that return a delta or a handled signal. Keep shared mutable state in one owner file.
- **Tangled leaf helpers.** Use a one-directional DAG: `<module>-internal.mts` imported by `<module>-commands.mts` imported by `cli.mts`. Module-scoped imports are safe at runtime because nothing executes at load time.
- **Function and class clusters.** Group by domain, not by type. A file named for its contents is easier to split later.

When a file legitimately exceeds 1000 lines (a generated artifact, a spec table, a genuine single cohesive unit), the marker is allowed. The category field must name WHAT the file is (`generated`, `spec-table`, `registry`), not a meta-label like `ok` or `exempt`. The reason field must state WHY it cannot be split.

## Enforcement

| Layer          | Surface                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Lint rule      | `socket/max-file-lines` gates the marker to >1000 and reports soft-band files regardless of any marker |
| Edit-time hook | `.claude/hooks/fleet/no-blanket-file-exclusion-guard/` blocks bad-shape markers at write time          |
| Commit-time    | commit caps in the same hook set                                                                       |
| Docs           | [`file-size`](docs/agents.md/fleet/file-size.md) covers the full playbook including all split patterns |
