---
description: Single-pass quality scan — fans out finders in parallel, runs variant analysis, adversarially verifies High/Critical findings, and produces an A-F report. Read-only; makes no commits.
---

Run the `scanning-quality` skill.

**Read-only** — this produces a report and makes no code changes or commits.
To iterate-fix-recheck until the report is clean, use the interactive loop
driver `/fleet:looping-quality` instead.
