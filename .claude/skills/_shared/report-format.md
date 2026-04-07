# Report Format

Shared output format for all scan and review pipelines.

## Finding Format

Each finding:
```
- **[SEVERITY]** file:line — description
  Fix: how to fix it
```

Severity levels: CRITICAL, HIGH, MEDIUM, LOW

## Grade Calculation

Based on finding severity distribution:
- **A** (90-100): 0 critical, 0 high
- **B** (80-89): 0 critical, 1-3 high
- **C** (70-79): 0 critical, 4+ high OR 1 critical
- **D** (60-69): 2-3 critical
- **F** (< 60): 4+ critical

## Pipeline HANDOFF

When a skill completes as part of a larger pipeline (e.g., quality-scan within release),
output a structured handoff block:

```
=== HANDOFF: {skill-name} ===
Status: {pass|fail}
Grade: {A-F}
Findings: {critical: N, high: N, medium: N, low: N}
Summary: {one-line description}
=== END HANDOFF ===
```

The parent pipeline reads this to decide whether to proceed (gate check) or abort.

## Queue Completion

When the final phase completes, update `.claude/ops/queue.yaml`:
- `status`: `done` (or `failed`)
- `completed`: current UTC timestamp
- `current_phase`: `~` (null)
- `completed_phases`: full list
- `findings_count`: `{critical: N, high: N, medium: N, low: N}`
