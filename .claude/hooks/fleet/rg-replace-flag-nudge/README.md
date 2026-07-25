# rg-replace-flag-nudge

A **Claude Code hook** that runs before every Bash command and prints a
stderr reminder (never blocks) when a ripgrep invocation clusters `-r`
with other short flags.

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

## What fires

Any Bash command whose parsed `rg` invocation carries a short-flag
cluster (`-[a-zA-Z]{2,}`) with `r` at a non-final position and no other
value-taking flag before it: `-rln`, `-rn`, `-orn`.

## What stays silent

- `rg -r <text> <pattern>` — standalone `-r`; the next argument is the
  replacement, as written.
- `rg -lnr <text> <pattern>` — `r` last in the cluster; same deal.
- Clusters where an earlier value-taking flag consumes the `r` (`-ern`
  is `--regexp 'rn'`, a different mistake).
- Anything after a literal `--` (patterns/paths, not flags).
- Non-rg commands.

## Fix it fires you toward

Spell each short flag separately (`rg -l -n <pattern>`), use long flags
(`rg --files-with-matches --line-number`), or keep `--replace '<text>'`
explicit when a replacement is actually wanted.
