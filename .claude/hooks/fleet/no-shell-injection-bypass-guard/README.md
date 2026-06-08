# no-shell-injection-bypass-guard

**Type:** PreToolUse(Bash) hook (BLOCK — exit 2).

## Trigger

Blocks a Bash command that uses an evasion-only shell construct which routes
around the fleet's command allowlists + `findInvocation` deny rules by hiding or
rewriting the command the parser sees:

1. **Zsh EQUALS expansion** — a base command starting with `=` (`=curl x`
   expands to `$(which curl) x` and runs `/usr/bin/curl`, but the parsed base
   token is `=curl`, so a `Bash(curl:*)` deny never fires).
2. **Process substitution** — `<(…)`, `>(…)`, `=(…)` run an inner command whose
   name no allowlist inspects.
3. **Zsh-module exfil / exec / file-IO builtins** — `zmodload` and the builtins
   it enables (`ztcp`, `zpty`, `sysopen`/`sysread`/`syswrite`/`sysseek`), plus
   `emulate -c` (eval-equivalent). Blocked as defense-in-depth.

**Not blocked:** `$(…)`, `${…}`, and backticks — legitimate and common in fleet
Bash (e.g. the default-branch recipe). Detection is AST-based (the fleet shell
parser, not raw-string regex), per `no-command-regex-in-hooks-guard`.

## Why

These constructs have no legitimate fleet use and are the single most effective
way to defeat a base-command allowlist. Threat model lifted from the Claude Code
client's BashTool/bashSecurity.ts. Detection consumes the same structural parse
facts `@socketsecurity/lib`'s `detectShellHazards` surfaces.

## Bypass

Type the exact phrase in a recent message:

```
Allow shell-injection bypass
```

The hook fails open on a malformed payload or an unparseable command (a string
it can't parse isn't a confirmed bypass).
