# prefer-pipx-over-pip-guard

PreToolUse hook that blocks `pip install <pkg>`, `pip3 install <pkg>`,
and `python -m pip install <pkg>` in two surfaces:

1. **Bash tool invocations** — direct CLI commands.
2. **Edit / Write tool** operations on Dockerfiles, shell scripts
   (`.sh` / `.bash`), and Python helpers that add `pip install` lines.

The rule: **fleet tools install via `pipx` at a pinned version** —
`pipx install <pkg>==<exact-version>` or `pipx install git+<url>@<sha>`.
Bare `pip install <pkg>` pollutes the global / user `site-packages`
and leaves the version range floating (catastrophic for reproducibility).

## Why

`pip install requests` lands `requests` in the current Python's
`site-packages`. Two days later somebody else's machine resolves a
newer version. Mid-CI surprise. pipx is the documented fix: each
tool gets its own venv, version is exact, upgrades are explicit.

The fleet has zero active `pip install <pkg>` call sites in build
code as of 2026-06-01 (the inventory is in `docs/claude.md/fleet/
pip-to-pipx.md`). This guard exists to keep that count at zero.

## What it blocks

The hook fires on:

- `pip install <name>`
- `pip3 install <name>`
- `python -m pip install <name>` (any `python*` interpreter)
- The same patterns inside Dockerfile `RUN` lines
- The same patterns inside shell scripts being edited/written

It does NOT block:

- `pip install pipx` — bootstrapping pipx itself is the canonical
  recovery when pipx is absent. Recognized literal allowlist.
- `pip install -e .` — editable install of the current project; not
  the same anti-pattern (it doesn't pull from PyPI, it links a local
  source dir). Recognized when `.` is the target.
- `pip install -r requirements.txt` — requirements files have pinned
  versions per project convention; pipx doesn't handle multi-package
  manifests. Recognized when `-r` flag is present.
- Comments mentioning `pip install` (error-message instructions
  telling the human user how to recover are fine).
- Documentation files (`*.md`, `*.rst`).
- `pip install --user <pipx-itself>` patterns used by `setup-pipx`.

## Bypass

Type the canonical phrase in a new message:

    Allow pip-install bypass

Use sparingly — a genuine `pip install` in build code is almost
always a sign the rule is right and the code is wrong. Bypass only
for upstream-vendor Dockerfiles you don't control AND can't carve
out (most upstream Dockerfiles you copy can be modified).

## Fix

```dockerfile
# WRONG — pollutes site-packages, floats version
RUN pip install requests

# RIGHT — pinned, isolated, predictable
RUN pipx install requests==2.31.0
```

```bash
# WRONG
pip3 install black

# RIGHT
pipx install black==24.10.0
```

For an unreleased package that only exists as a git SHA:

```bash
pipx install git+https://github.com/owner/repo.git@<sha>
```

For first-time setup on a machine without pipx:

```bash
node .claude/hooks/fleet/setup-pipx/install.mts
```

Cross-platform — mac / linux / windows. Picks the right pipx
installer for the host (brew / apt / yum / apk / vanilla Python).
