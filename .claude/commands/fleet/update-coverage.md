---
description: Refresh the coverage badge in the root README via the updating-coverage skill.
---

Run the repo's coverage script, parse the resulting percentage, and rewrite the `![Coverage](...)` line in the root `README.md` to match. Two decimal places, direct-push per fleet norm.

Use after landing significant test changes, pre-release, or whenever the public badge has drifted from the actual coverage number. Exits silently if the repo declares no coverage script (many fleet repos legitimately don't track coverage).

Invokes the `updating-coverage` skill.
