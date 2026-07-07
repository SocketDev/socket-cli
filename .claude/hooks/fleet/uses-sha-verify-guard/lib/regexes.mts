// Canonical regexes used across the four scan surfaces (workflow uses:,
// bare uses, lone SHA, gitmodules, package.json).

// Match `uses: <owner>/<repo>(/<path>)?@<ref>`. Tolerates leading
// whitespace, list dash (`- uses:`), and trailing comments.
export const USES_RE =
  /^\s*(?:-\s+)?uses:\s+(?<ownerRepoPath>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?)@(?<ref>[^\s#]+)/

// Bare `<owner>/<repo>(/<path>)?@<ref>` anywhere in a string. Used to
// catch Bash commands (sed/awk/echo/heredoc) writing SHA pins into
// `.github/workflows/*.yml` without going through Edit/Write — the
// gap that let a fabricated SHA suffix land in a `sed -i` invocation
// (see commit d6483ba4 which had to correct it).
//
// The pattern is conservative — it only matches a NON-trivial repo
// reference (owner/repo, at least one slash, both sides alphanumeric)
// followed by `@` and a candidate ref. The downstream validation
// (40-char hex check + gh api reachability) runs on whatever it
// captures, so false positives are harmless (a `random@sha` would
// just 404 and be flagged accurately).
export const BARE_USES_RE_GLOBAL =
  /(?<ownerRepoPath>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?)@(?<ref>[0-9a-f]{7,64})/g

// Lone 40-char hex token (no preceding `@`). Used to catch sed s/// or
// awk substitutions where the SHA appears bare in the replacement
// because the owner/repo is on a different line of the target file
// (the actual shape of the v6.0.7 publish miss). Case-insensitive —
// git accepts mixed-case SHAs.
export const LONE_SHA_RE_GLOBAL = /\b(?<sha>[0-9a-f]{40})\b/gi

// Match `# <name>-<version> sha256:<hex>` header.
export const GITMODULES_HEADER_RE =
  /^#\s+[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?-[^\s]+\s+sha256:(?<sha>[0-9a-f]+)/

// Match `ref = <hex>` inside a submodule block.
export const GITMODULES_REF_RE = /^\s*ref\s*=\s*(?<ref>[0-9a-f]+)\s*$/

// Match `[submodule "PATH"]`.
export const SUBMODULE_OPEN_RE = /^\s*\[submodule\s+"(?<name>[^"]+)"\s*\]\s*$/

// Match `url = https://github.com/<owner>/<repo>(.git)?` inside a
// submodule block. Captures owner/repo so we can verify the
// submodule's `ref = <40hex>` against the right upstream repo.
export const GITMODULES_URL_RE =
  /^\s*url\s*=\s*(?:https?:\/\/github\.com\/|git@github\.com:)(?<ownerRepo>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\s*$/

// Match `git+https://github.com/<owner>/<repo>(.git)?#<ref>` in JSON.
// Captures owner/repo and ref. Tolerates quoting around the URL value.
export const PACKAGE_JSON_GITHUB_RE =
  /git\+https?:\/\/github\.com\/(?<ownerRepo>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?#(?<ref>[^"]+)/g

// Detect when a Bash command targets a workflow / action / submodule
// file via sed/awk/echo/tee/cat-heredoc. The match doesn't need to be
// exhaustive — a false negative just means the Edit/Write surface
// remains the primary gate. A false positive is harmless: the SHA
// still has to be malformed or unreachable to actually block.
export const BASH_TARGETS_WORKFLOW_RE =
  /\.github\/(?:workflows\/[^\s'")]+\.ya?ml|actions\/[^\s'")]+\/action\.ya?ml)|(?:^|\s)\.gitmodules(?:\s|$)/

// Pull workflow / action file paths the Bash command writes to.
// Captures the path portion so we can read the file on disk and
// discover which <owner>/<repo> the substituted SHAs apply to.
export const BASH_WORKFLOW_PATH_RE_GLOBAL =
  /(?<path>\.github\/(?:workflows\/[^\s'")]+\.ya?ml|actions\/[^\s'")]+\/action\.ya?ml))/g

// Match a .gitmodules path token in a Bash command. Limited to
// repo-root .gitmodules — the only place git looks for submodule
// declarations.
export const BASH_GITMODULES_PATH_RE_GLOBAL =
  /(?:^|\s)(?<path>\.gitmodules)(?:\s|$)/g
