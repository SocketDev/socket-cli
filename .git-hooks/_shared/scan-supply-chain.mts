// Supply-chain / lockdown push-time content scanners: the programmatic-Claude
// lockdown check, the soak-exclude date-annotation check, and the AI-config
// poison-fingerprint warner. Gate-free string logic built on scan-core.

import { scanLines } from './scan-core.mts'

import type { LineHit } from './scan-core.mts'

// ── Programmatic-Claude lockdown (HARD block) ──────────────────────
//
// A `.mts` that drives Claude programmatically (the agent SDK `query({…})`
// or `new ClaudeSDKClient({…})`) MUST pin the four lockdown options; a headless
// agent without them can be steered into arbitrary tool use. The
// claude-lockdown-guard hook covers the `claude` CLI at Bash time; this covers
// the SDK call sites in committed source (round-2 code-is-law gap: no
// commit/push tier existed for the non-Bash form). Deterministic, so it blocks.
//
// Flags a line that opens a `query(` / `new ClaudeSDKClient(` call when the
// surrounding file does NOT also mention all four option keys, OR when it sets a
// forbidden permission mode. Conservative: only fires when a driver call is
// actually present, and reads the whole file for the keys (they're often on
// separate lines), so a call with the options nearby passes.
//
// The SDK `query` is the bare imported function — `query({…})`, never a method
// and never inside a string. The negative lookbehind excludes:
//   - method calls named query (`chrome.tabs.query(…)`, `db.query(…)`) — the `.`
//   - a `query(` opening INSIDE a string / template literal — the `` ` ``/`'`/`"`.
//     The canonical false positive is a GraphQL request body
//     (`query: ` + a backtick + `query($owner: …`), which is data, not a driver.
const CLAUDE_DRIVER_RE = /(?:(?<![.`'"])\bquery|new\s+ClaudeSDKClient)\s*\(/
const LOCKDOWN_KEYS = [
  'tools',
  'allowedTools',
  'disallowedTools',
  'permissionMode',
] as const
const BAD_PERMISSION_MODE_RE =
  /permissionMode\s*:\s*['"`](?:bypassPermissions|default)['"`]/
const BYPASS_PERMISSIONS_RE = /\bbypassPermissions\b/

export const scanProgrammaticClaudeLockdown = (text: string): LineHit[] => {
  if (!CLAUDE_DRIVER_RE.test(text)) {
    return []
  }
  // A forbidden mode anywhere is an immediate fail, pointed at its line.
  const badMode = scanLines(text, BAD_PERMISSION_MODE_RE)
  if (badMode.length > 0) {
    return badMode
  }
  // bypassPermissions in any form (string/flag) is forbidden.
  const bypass = scanLines(text, BYPASS_PERMISSIONS_RE)
  if (bypass.length > 0) {
    return bypass
  }
  // All four keys must appear somewhere in the file. If any is missing, flag
  // the driver-call line(s).
  const missing = LOCKDOWN_KEYS.filter(
    k => !new RegExp(`\\b${k}\\s*:`).test(text),
  )
  if (missing.length === 0) {
    return []
  }
  return scanLines(text, CLAUDE_DRIVER_RE)
}

// ── Soak-exclude date annotations (HARD block, pnpm-workspace.yaml) ──
//
// Every exact-pin soak-bypass entry (`'pkg@1.2.3'`) under
// `minimumReleaseAgeExclude:` MUST carry a `# published: YYYY-MM-DD | removable:
// YYYY-MM-DD` annotation on the line above. The edit-time guard + the
// soak-excludes-have-dates check cover Claude-authored edits + CI; this is the
// push-time tier for entries that landed via non-Claude paths. Deterministic.
const SOAK_BLOCK_RE = /^\s*minimumReleaseAgeExclude:\s*$/
const SOAK_PIN_RE = /^\s*-\s*['"]?[^'"#\s]+@[^'"#\s]+['"]?\s*$/
const SOAK_ANNOTATION_RE =
  /^\s*#\s+published:\s+\d{4}-\d{2}-\d{2}\s+\|\s+removable:\s+\d{4}-\d{2}-\d{2}\s*$/
// Same opt-out the canonical soak-excludes-have-dates check honors — an entry
// that legitimately can't carry a date annotation marks the slot above it.
const SOAK_ALLOW_MARKER =
  '# oxlint-disable-next-line socket/soak-exclude-has-date'

export const scanSoakExcludeDateAnnotations = (text: string): LineHit[] => {
  const lines = text.split(/\r?\n/)
  const hits: LineHit[] = []
  let inBlock = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (SOAK_BLOCK_RE.test(line)) {
      inBlock = true
      continue
    }
    // Block ends at the next non-indented, non-blank line.
    if (inBlock && line !== '' && !/^\s/.test(line)) {
      inBlock = false
    }
    if (!inBlock) {
      continue
    }
    // An exact-pin bullet (`- 'pkg@1.2.3'`) needs the annotation directly above
    // — unless the slot above carries the allow-marker (parity with the
    // canonical soak-excludes-have-dates check).
    if (SOAK_PIN_RE.test(line)) {
      const prev = i > 0 ? lines[i - 1]! : ''
      if (!SOAK_ANNOTATION_RE.test(prev) && !prev.includes(SOAK_ALLOW_MARKER)) {
        hits.push({ lineNumber: i + 1, line })
      }
    }
  }
  return hits
}

// ── AI-config poison fingerprints (WARN — heuristic, never blocks) ──
//
// Out-of-band writes to `.claude/`/`.cursor/`/`.gemini/`/`.vscode/` that tell an
// agent to bypass a guard, exfiltrate secrets, or store tokens off-keychain are
// the npm-worm postinstall signature. The edit-time ai-config-poisoning-guard
// sees only Claude's OWN writes; a poison file that arrives via a dependency /
// merge / outside editor reaches push unscanned. Heuristic + literal-pattern, so
// it WARNS, surfaces for a human glance, rather than blocking — a false block on
// a mandatory push gate is worse than a missed nudge.
const POISON_RES: readonly RegExp[] = [
  // An `Allow <x> bypass` phrase planted in a config file (not a hook/doc).
  /\bAllow\s+[a-z][a-z0-9-]*\s+bypass\b/i,
  // Exfiltration: curl/fetch/POST a SOCKET_API* / GITHUB_TOKEN somewhere.
  /(?:curl|fetch|https?:\/\/)[^\n]*(?:GH_TOKEN|GITHUB_TOKEN|SOCKET_API)/i,
  // Store a token off-keychain (into a dotenv / dotfile).
  /(?:GITHUB_TOKEN|SOCKET_API\w*)\s*=.*(?:>>?\s*[~.]|\.bashrc|\.env|\.zshrc)/i,
  // Tell the agent to disable / ignore a guard.
  /(?:disable|ignore|skip|turn off)\s+(?:the\s+)?[a-z-]*(?:check|guard|hook)\b/i,
]

export const scanAiConfigPoison = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    for (let p = 0, { length: pLen } = POISON_RES; p < pLen; p += 1) {
      if (POISON_RES[p]!.test(line)) {
        hits.push({ lineNumber: i + 1, line })
        break
      }
    }
  }
  return hits
}
