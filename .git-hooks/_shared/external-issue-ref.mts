// External-issue-ref matcher — shared by the commit-msg git-stage backstop
// AND the Claude-side no-ext-issue-ref-guard. Gate-free (no Node-25 hard-exit,
// unlike helpers.mts) so the Claude hook can import it on the operator's Node.
// Flags foreign <owner>/<repo>#<num> refs + github.com issue/PR URLs that
// would auto-link a backref into an upstream maintainer's issue.

// CRLF-tolerant line split. Inlined (not imported from helpers.mts) so this
// module stays free of the Node-25 hard-exit gate that helpers.mts carries —
// a Claude hook importing it must run on the operator's (possibly older) Node.
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

//
// Foreign `<owner>/<repo>#<num>` tokens (and full github.com issue/PR
// URLs) auto-link on GitHub and post an `added N commits that reference
// this issue` event back to the target. A fleet cascade of N commits =
// N pings to a maintainer who never asked to be tagged. The canonical
// CLAUDE.md "public-surface hygiene" block documents the policy; this
// scanner makes it mechanical on the commit-msg git-stage so a foreign
// ref can't slip past `--no-verify` or onto a subprocess / worktree /
// CI commit the Bash-time no-ext-issue-ref-guard never sees.
//
// Canonical home: this module. The Claude-side
// .claude/hooks/fleet/no-ext-issue-ref-guard/index.mts imports the same
// matcher cross-tree so the two surfaces never diverge.
//
// Allowed (NOT reported):
//   - bare `#123` (resolves against the current repo — no cross-repo leak)
//   - `SocketDev/<repo>#<num>` (same org — case-insensitive)
//   - `https://github.com/SocketDev/...` (same org)
//
// Blocked (reported):
//   - `<other-owner>/<repo>#<num>`
//   - `https://github.com/<other-owner>/<repo>/{issues,pull}/<n>`

export interface ExternalIssueRef {
  kind: 'token' | 'url'
  owner: string
  repo: string
  num: string
  raw: string
}

// Org allowlist — case-insensitive, stored lowercase for comparison.
// GitHub resolves orgs case-insensitively in URLs and refs, so
// `socketdev` / `SocketDev` / `SOCKETDEV` all name the same org.
export const ALLOWED_ISSUE_REF_ORGS = new Set<string>(['socketdev'])

// Detect `<owner>/<repo>#<num>` token. Owner and repo names follow
// GitHub's rules: alphanumerics, dashes, underscores, dots (no leading
// dot/dash). Permissive on boundaries since we pattern-match prose, not
// validate canonical refs.
//
//   (^|\s|\() — anchor at start, whitespace, or open paren so we don't
//                re-match the owner/repo fragment already inside a URL.
//   ([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?) — owner / repo
//   #(\d+) — issue/PR number
//   (?=\b|[\s.,;:)\]]|$) — terminate cleanly
const OWNER_REPO_REF_RE =
  /(?:^|\s|\()([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)#(\d+)(?=\b|[\s.,;:)\]]|$)/g

// Detect full GitHub issue/PR URLs to non-SocketDev orgs.
const GITHUB_ISSUE_URL_RE =
  /https?:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/(?:issues|pull)\/(\d+)/g

// Walk the text and collect every external-org reference. Returns an
// empty array when the text only references same-repo (`#123`) or
// SocketDev-owned (`SocketDev/socket-lib#42`) issues. Comment lines
// (after leading whitespace, start with `#`) are skipped — git inlines
// the diff snippet + "Please enter the commit message" hint there, and a
// foreign ref quoted in that snippet isn't part of the authored message.
export function scanExternalIssueRefs(text: string): ExternalIssueRef[] {
  const out: ExternalIssueRef[] = []
  for (const rawLine of splitLines(text)) {
    if (rawLine.trimStart().startsWith('#')) {
      continue
    }
    let m: RegExpExecArray | null
    OWNER_REPO_REF_RE.lastIndex = 0
    while ((m = OWNER_REPO_REF_RE.exec(rawLine)) !== null) {
      const owner = m[1]!
      const repo = m[2]!
      const num = m[3]!
      if (!ALLOWED_ISSUE_REF_ORGS.has(owner.toLowerCase())) {
        out.push({
          kind: 'token',
          owner,
          repo,
          num,
          raw: `${owner}/${repo}#${num}`,
        })
      }
    }
    GITHUB_ISSUE_URL_RE.lastIndex = 0
    while ((m = GITHUB_ISSUE_URL_RE.exec(rawLine)) !== null) {
      const owner = m[1]!
      const repo = m[2]!
      const num = m[3]!
      if (!ALLOWED_ISSUE_REF_ORGS.has(owner.toLowerCase())) {
        out.push({ kind: 'url', owner, repo, num, raw: m[0]! })
      }
    }
  }
  return out
}

// ── File classification ────────────────────────────────────────────
