# Multi-Janus MCP shim

A stdio MCP server (`scripts/fleet/janus-multi-mcp.mts`) that fronts **many** repo Janus queues behind one connection, so an agent can read or file tickets in any fleet repo's queue without switching checkouts.

## Why

The native `janus mcp` is rooted at a single `.janus/` (its launch cwd). An agent working in `socket-lib` can't file a ticket into the fleet source repo's queue without changing directories — which, on a shared checkout, means fighting the other session's `.git/index`. That contention is what wedged a recent landing.

This shim adds a `workspace` parameter to every tool and routes the call to that repo's `.janus/` by shelling `janus` with `JANUS_ROOT` set. So a `socket-lib` agent that discovers it needs a fleet-canonical change **files it into the the fleet source repo queue and keeps draining its own** — no cross-checkout commit.

## Stopgap status

This is a stopgap. The upstream `janus mcp --workspace name=path` (a PR stack against `divmain/janus`) will provide the same `workspace`-parameterized tool shape natively. When it lands, callers swap shim → native with no change, and the shim (`janus-multi-{mcp,runner,workspace}.mts` + this doc + the test) is deleted. It needs zero Janus changes today — it only uses the already-shipping `JANUS_ROOT` env knob.

## Workspaces

Zero-config discovery: every fleet repo (from the fleet-canonical `fleet-repos.json`, cascaded per-repo) that is a sibling directory of the running repo's root **and** has a `.janus/` dir is a workspace. The shim is fleet-tier (`scripts/fleet/`), so it ships to every member — an agent in any repo drives its own queue and its siblings'. The workspace name is the repo dir name (e.g. the fleet source repo). Call `list_workspaces` for the live set. A repo with no `.janus/` is not listed (it has not adopted Janus yet).

## Tools

Each tool except `list_workspaces` takes a required `workspace` arg.

| Tool | Maps to | Notes |
| ------ | --------- | ------- |
| `list_workspaces` | discovery | name + repoPath for each |
| `create_ticket` | `janus create` | the cross-repo fire-off; `externalRef` links back |
| `get_next_available_ticket` | `janus next --json` | the runner loop's "what's next" |
| `list_tickets` | `janus ls --json` | |
| `show_ticket` | `janus show <id> --json` | |
| `update_status` | `janus status <id> <status> --json` | new/next/in_progress/complete/cancelled/archived |

## Wiring (`.mcp.json`)

```json
{
  "mcpServers": {
    "janus-multi": {
      "command": "node",
      "args": ["scripts/fleet/janus-multi-mcp.mts"]
    }
  }
}
```

Requires the `janus` binary on `PATH` (Homebrew: `brew tap divmain/janus && brew install janus`).

## Smoke test (live, needs the janus binary)

```sh
( printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}';
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}';
  sleep 1 ) | node scripts/fleet/janus-multi-mcp.mts
```

The pure logic (JSON-RPC dispatch, tool→argv mapping, workspace discovery) is unit-tested in `test/repo/unit/janus-multi-mcp.test.mts`.

## `.janus/` is gitignored (release-bundle, not the cascade)

`.janus/` is in the fleet-canonical `.gitignore` block, so a repo's ticket queue never enters the byte-identical commit cascade — it rides the gh-release bundle and per-repo seeding instead (less in the cascade, more in the release). The shim only reads whatever `.janus/` exists on disk; a repo that has not been seeded is simply absent from `list_workspaces`.
