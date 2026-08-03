# rg-replace-flag-guard

A **Claude Code hook** that runs before every Bash command and BLOCKS when
a ripgrep invocation clusters `-r` with other short flags.

## The hazard

ripgrep's `-r` / `--replace` takes a value. Inside a short-flag cluster
it consumes the REST of the cluster as the replacement text:

```console
rg -rln pattern      # parses as: rg --replace 'ln' pattern
```

Instead of listing files (`-l`) with line numbers (`-n`), every match is
rewritten to the literal text `ln`. The command exits 0, so a caller
checking only the exit code never sees the corruption. This shape has
bitten agent sessions repeatedly — the flags read like a normal cluster.

## Why it blocks

The hazard is deterministic, unambiguous, and mechanically correctable:
spell the flags apart. There is no judgment call to preserve, and a
careful operator can trip it twice in a single session while a stderr
reminder scrolls past. Blocking costs one retry; a silent `--replace`
costs a wrong answer that reads like a real one.

## What blocks

Any Bash command whose parsed `rg` invocation carries a short-flag
cluster (`-[a-zA-Z]{2,}`) with `r` at a non-final position and no other
value-taking flag before it: `-rn`, `-rl`, `-rc`, `-rln`, `-orn`.

## What stays silent

- `rg --replace <text> <pattern>` — the long spelling, unambiguous.
- `rg -r <text> <pattern>` — standalone `-r`; the next argument is the
  replacement, as written.
- `rg -nr <text> <pattern>` — `r` last in the cluster; same deal.
- Clusters where an earlier value-taking flag consumes the `r` (`-ern`
  is `--regexp 'rn'`, a different mistake).
- Anything after a literal `--` (patterns/paths, not flags).
- Non-rg commands.

## Fix it points you at

Spell each short flag separately (`rg -l -n <pattern>`), use long flags
(`rg --files-with-matches --line-number`), or spell `-r '<text>'` apart
from the rest when a replacement is actually wanted.

## Bypass

Slug `rg-replace-cluster`, for a genuine `--replace` written as a
cluster. The block message prints the full phrase to type.
