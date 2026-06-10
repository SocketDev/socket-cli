# proc-environ-exfil-guard

`PreToolUse(Bash | Edit | Write | MultiEdit)` blocker. Refuses to author a read
of `/proc/<pid>/environ` or `/proc/<pid>/cmdline` — the secret + argv harvest
path.

## Why

`/proc/self/environ` exposes a process's full environment (any unscrubbed
token); `/proc/<pid>/cmdline` exposes another process's argv (where a secret may
have been passed). The Microsoft Security writeup (2026-06-05) on
`anthropics/claude-code-action` showed a prompt-injected issue steering the
agent into reading `/proc/self/environ` through the unsandboxed Read tool, then
laundering the `ANTHROPIC_API_KEY` past GitHub's secret scanner (stripping the
`sk-ant-` prefix) and exfiltrating it. Anthropic patched the Read tool in Claude
Code 2.1.128; this guard owns the **authoring** fingerprint — code that reads
these paths is the exfil primitive, so the fleet never writes or copies it
inward.

Detection is a path-string match (`/proc/<pid>/environ|cmdline`), so it fires
the same on `darwin` / `linux` / `win32` — it gates the attempt to author such a
read, not a Linux runtime.

## Covers

- **Bash**: `cat /proc/self/environ`, `xxd /proc/$$/environ`, `tr … <
/proc/1/cmdline`.
- **Edit / Write / MultiEdit**: source that constructs the path —
  `readFileSync('/proc/self/environ')`, `'/proc/' + pid + '/cmdline'`.

The pid segment matches any process name: `self`, a digit run, `$$` / `$pid`, a
`*` glob, or a `' + var + '` interpolation.

## Self-exempt

The guard's own files plus `ai-config-poisoning-guard` and the
`env-kill-switches-are-absent` check, which legitimately name the pattern to
detect it.

The Edit/Write arm also exempts **prose** surfaces — markdown files, anything
under a `docs/` tree, and `.claude/` memory / plan / report files — because
naming the path there is documentation, not a read. (Source files still trip:
authoring `/proc/<pid>/environ` in `.ts`/`.mts` is the exfil primitive.) This is
the Edit-arm counterpart to the Bash arm's read-context gate. Motivating
incident: the guard blocked an attempt to write a memory file describing the
incident it was built from.

## Bypass

`Allow proc-environ-read bypass` in a recent user turn. Rare — only a genuine
operator diagnostic that must read `/proc` env qualifies.

The rule lives in [`CLAUDE.md`](../../../CLAUDE.md) under "Prompt-injection +
agent-DoS"; full threat model in
[`docs/agents.md/fleet/prompt-injection.md`](../../../docs/agents.md/fleet/prompt-injection.md).
