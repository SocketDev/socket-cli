# stale-process-sweeper

Claude Code `Stop` hook that sweeps stale Node test/build worker
processes at turn-end, before they pile up across turns and exhaust
system memory.

## Why

Vitest's `forks` pool spawns one Node worker per CPU. When the parent
runner exits abnormally — `Bash` timeout, `SIGINT` from the user,
pre-commit hook crash — the workers stay alive holding 80–100 MB
each. After a few interrupted runs the host has gigabytes of
abandoned processes.

The sweeper finds those processes (matched by command-line pattern)
that have lost their parent, and sends them `SIGTERM`. A still-living
parent means the worker is part of a real, in-progress run, and the
sweeper leaves it alone.

## What's swept

| Pattern | Source |
| --- | --- |
| `vitest/dist/workers/(forks\|threads)` | Vitest worker pool |
| `vitest/dist/(cli\|node).[mc]?js` | Orphaned Vitest parent runners |
| `\btsgo\b` | TypeScript Go-based type checker |
| `type-coverage/bin/type-coverage` | Type coverage tool |
| `esbuild/(bin\|lib)/.*\bservice\b` | esbuild's daemon service |

## What's not swept

- Anything spawned by a still-living shell (PPID alive)
- The Claude Code process itself or its parent terminal
- Anything outside the pattern list

## Wiring

In `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/stale-process-sweeper/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Output

Silent on the happy path (no orphans found). When something is reaped:

```
[stale-process-sweeper] reaped 14 stale worker(s), ~1120MB freed:
vitest-worker=29240(95MB), vitest-worker=33278(93MB), …
```

The line goes to stderr. Stop-hook output is shown to the user, not
the model — useful diagnostic, doesn't pollute Claude's context.

## Tests

```bash
cd .claude/hooks/stale-process-sweeper
node --test test/*.test.mts
```
