# stale-process-sweeper

A **Claude Code hook** that runs at the _end_ of every Claude turn
and sweeps stale Node test/build worker processes that lost their
parent. Without this, abandoned workers accumulate across turns and
gradually exhaust system memory.

> If you haven't worked with Claude Code hooks before: hooks are tiny
> scripts that run at specific lifecycle points. A `Stop` hook like
> this one fires _after_ Claude finishes a turn (a unit of work that
> ends with the model handing the conversation back to the user).
> Stop hooks can do cleanup, log diagnostics, or — like this one —
> reap orphans.

## Why orphans pile up

Vitest's `forks` pool spawns one Node worker per CPU. When the parent
runner exits abnormally — a `Bash` tool timeout, a `SIGINT` from the
user, a pre-commit hook crash — the workers stay alive holding
roughly 80–100 MB of RSS each. Tools like `tsgo` and `esbuild` have
similar long-lived service processes that can outlive their parent.

After a few interrupted runs, you can have several gigabytes of
abandoned processes sitting around. The sweeper finds them by
matching their command line against a known pattern list, confirms
their parent process has died (so we don't kill workers belonging to
a _real_ in-progress run), and sends them `SIGTERM`.

## What's swept

| Pattern                                | What it matches                  |
| -------------------------------------- | -------------------------------- |
| `vitest/dist/workers/(forks\|threads)` | Vitest worker pool processes     |
| `vitest/dist/(cli\|node).[mc]?js`      | Orphaned Vitest parent runners   |
| `\btsgo\b`                             | TypeScript Go-based type checker |
| `type-coverage/bin/type-coverage`      | Type coverage tool               |
| `esbuild/(bin\|lib)/.*\bservice\b`     | esbuild's daemon service         |
| `…/sfw` (several install layouts)      | Socket Firewall command wrappers |

## Kill-everything mode (`--all`)

The default Stop-hook sweep is conservative — only orphans + wedged
workers, never healthy live-parent work. Run the hook directly with
`--all` (or `--force`) for an explicit "stop all background processing
and reap orphans now":

```bash
node .claude/hooks/fleet/stale-process-sweeper/index.mts --all
```

`--all` SIGKILLs every matched build/test worker regardless of parent
liveness, **and** additionally reaps a set of orphaned AI-agent
processes that only this mode considers (and only when orphaned —
PPID 1 or dead parent — so a live sibling session is never touched):

| Pattern              | What it matches                                                   |
| -------------------- | ----------------------------------------------------------------- |
| `codex-app-server`   | Codex app-server + its `app-server-broker` brokers                |
| `claude-cli`         | Detached `claude doctor` / `update` / `mcp` / `migrate-installer` |
| `claude-task-poller` | Orphaned `bash` loops waiting on a task `.output.exitcode`        |

## What's not swept

- Anything spawned by a still-living shell (parent process alive).
  Those are part of an in-progress run; killing them would break
  legitimate work.
- The Claude Code process itself or its parent terminal.
- **Session-critical daemons** (`isSessionCriticalDaemon`) — the
  headroom proxy that backs `ANTHROPIC_BASE_URL` runs detached
  (PPID 1) on purpose; it is never swept, even under `--all`, because
  killing it would break the live session running the sweep.
- AI-agent processes with a **live** parent, a real running session —
  even under `--all`, only orphaned agents are reaped.
- Anything outside the pattern list. The sweeper is conservative —
  if a stuck process isn't pattern-matched, it survives.

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
            "command": "node .claude/hooks/fleet/stale-process-sweeper/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Output

Silent on the happy path (no orphans found). When something is
reaped:

```
[stale-process-sweeper] reaped 14 stale worker(s), ~1120MB freed:
vitest-worker=29240(95MB), vitest-worker=33278(93MB), …
```

The line goes to stderr. Stop-hook output is shown to the user, not
the model — useful diagnostic, doesn't pollute Claude's context.

## Testing

```bash
cd .claude/hooks/stale-process-sweeper
node --test test/*.test.mts
```

## Cross-fleet sync

This README and the hook itself live in
[`socket-wheelhouse`](https://github.com/SocketDev/socket-wheelhouse/tree/main/template/.claude/hooks/stale-process-sweeper)
and are required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
