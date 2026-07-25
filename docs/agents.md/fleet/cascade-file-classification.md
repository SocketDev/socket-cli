# Cascade file classification — bundled vs hybrid

Every fleet repo's files fall into exactly one of three cascade classes. Knowing
which class a file is in tells you **where to edit it** and **how it reaches
member repos**.

## 1. Bundled (byte-identical, full-file mirror)

Repo-agnostic files copied verbatim. Edit only in `template/base/...`; they
mirror to every member unchanged. The whole content is fleet-owned — repo-local
content must live OUTSIDE these trees (e.g. the `.claude/hooks/repo/` carve-out).
These ship in the **release bundle** (`make-release-bundle.mts`), not per-file
cascade.

Source of truth: `IDENTICAL_FILES` + `OPTIONAL_IDENTICAL_FILES` in
`scripts/repo/sync-scaffolding/manifest/{identical-files,files}.mts`. Includes
every `fleet/` tree (hooks, agents, commands, skills, workflows),
`.git-hooks`, `scripts/fleet`, the oxlint plugin, `.config/fleet/*` configs,
`.editorconfig`, `.npmrc`, `.github/dependabot.yml`, byte-identical workflows
(`prune-workflow-runs.yml`, `weekly-update-non-gh-aw.yml.disabled`), schema
files, and branding assets.

## 2. Hybrid (fleet block/fields merged into a repo-owned file)

A repo-owned file with a fleet-managed region the cascade rewrites in place while
preserving everything outside it. These cannot be copied byte-identically. A
release may carry a merge-aware segment; the per-file cascade uses the same
ownership boundary.

| File                                       | Check                                                                           | Fleet-managed region                                                    | Repo-owned                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                | `claude-md-fleet-block`                                                         | the `<fleet-canonical>` block                                           | preamble + Project-Specific                                                                     |
| `.gitignore`                               | `gitignore-fleet-block`                                                         | the `<fleet-canonical>` block                                           | ignores outside markers                                                                         |
| `.gitattributes`                           | `gitattributes-fleet-block`                                                     | the `<fleet-canonical>` block                                           | attrs outside markers                                                                           |
| `README.md`                                | `readme-skeleton-drift`                                                         | the `<fleet-canonical>` block                                           | prose, coverage badge, social buttons                                                           |
| `package.json`                             | `package-scripts`, `package-files`, `package-npm-run-all2-noderun`              | fleet script names/bodies, `engines`, `packageManager`, catalog devDeps | `name`, `description`, version, repo scripts                                                    |
| `pnpm-workspace.yaml`                      | `workspace-config` (+ `-catalog`, `-soak`, `lockfile-workspaces`)               | catalog, soak rules, overrides, `packages`, trust policy                | repo-specific entries                                                                           |
| `.claude/settings.json`                    | `settings-merge`, `settings-hook-paths`                                         | marked hooks + baseline permissions                                     | top-level settings after the close marker; repo hook registrations are preserved inside `hooks` |
| `.config/fleet/oxlintrc.json`              | `identical-files`, sentinel-scoped (+ `-profile`, `-rule-activations`, `-rule-wiring`) | everything through the `#fleet-canonical-end` sentinel                  | `ignorePatterns` tail after the end sentinel, preserved byte-for-byte by every placement path   |
| `tsconfig.json`, `tsconfig.check.json`     | `tsconfig-shape`                                                                | must `extends` the fleet base                                           | `rootDir`, include/exclude, repo knobs                                                          |
| `.github/workflows/ci.yml`                 | `workflow-fleet-block` (+ `-pnpm`, `-sha-pinning`, `-uses-comment`)             | the `<fleet-canonical>` header block                                    | repo matrix/jobs                                                                                |
| `.gitmodules`                              | `gitmodules-hygiene`                                                            | `# name-version` comment format                                         | submodule entries                                                                               |
| `.node-version` ↔ `package.json` `engines` | `node-version-sync`                                                             | the synced version value                                                | —                                                                                               |

## 3. Conditional / optional (marker-gated, feature flags)

Shipped in the bundle but **activated per-repo**: `CONDITIONAL_FILES` groups gate
on a marker file's presence; `OPTIONAL_IDENTICAL_FILES` are byte-identical only
when present; `settings.json` registers only the hooks the repo's
`socket-wheelhouse.json` flags enable. The bundle is the superset; the repo's
config decides what's active.

## Block-marker convention

A fleet-managed region is delimited by HTML-element-like open/close markers; only
the surrounding comment delimiter changes per file syntax.

| Comment style                                                                             | Open marker                  | Close marker                  |
| ----------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------- |
| HTML (`CLAUDE.md`, `README.md`)                                                           | `<!-- <fleet-canonical> -->` | `<!-- </fleet-canonical> -->` |
| `#` (`.gitignore`, `.gitattributes`, YAML, `.gitmodules`, JSON **array** sentinel string) | `# <fleet-canonical>`        | `# </fleet-canonical>`        |
| `//` (JS/TS, JSON **object** sentinel key)                                                | `// <fleet-canonical>`       | `// </fleet-canonical>`       |

The legacy `BEGIN`/`END` keyword form (`# BEGIN <fleet-canonical>` / `# END </fleet-canonical>`)
is still parsed by the detector for backward compatibility during the fleet-wide migration,
but new markers are emitted without the redundant keywords.

- **Tag** — a hyphenated kebab name (`fleet-canonical`). Distinct regions use
  distinct tags; same-tag blocks may **nest**, like HTML elements.
- **Attributes** — the open tag may carry HTML-style attributes
  (`<fleet-canonical id="standards" managed>`), including bare boolean attrs.
  They are PARSED but not yet consumed — a disabled seam, wired in, gated off.
- **Nested + balanced** — blocks nest and must be balanced; overlap, an unclosed
  open, or an orphan close is **malformed → rejected** (never auto-fixed).
- **JSON** carries the marker as a sentinel that reuses the same text: a
  `#`-prefixed string element in an array, or a `"// …"` key in an object
  (both conventionally inert).

Every matcher/fixer parses these markers through the single shared primitive
[`.claude/hooks/fleet/_shared/named-blocks.mts`](../../../.claude/hooks/fleet/_shared/named-blocks.mts)
— html5parser tokenizes each tag's name + attributes, and a stack walk enforces
the balance/malformed rule — so the grammar can't drift between consumers. Old
markers (uppercase `FLEET-CANONICAL`, the reordered `#fleet-canonical-begin`)
are matched leniently so a member repo migrates to the canonical form on its
next cascade.
