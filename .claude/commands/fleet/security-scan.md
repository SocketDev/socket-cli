---
description: Chain AgentShield (AI config scanner) + SkillSpector (skill scanner) + Zizmor (GH Actions scanner) + security-reviewer agent for a graded security report
---

Run the `scanning-security` skill. This chains AgentShield (Claude config audit) → SkillSpector (untrusted-skill audit) → zizmor (GitHub Actions security) → security-reviewer agent (grading).

For a quick manual run without the full pipeline: `pnpm run security`
