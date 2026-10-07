// Push-time content scanners: programmatic-Claude lockdown, soak-exclude dates,
// AI-config poison fingerprints. Gate-free string logic built on scan-core.

import { maskStringContents } from '../../scripts/fleet/hooks/guard-block-shape.mts'
import { scanLines } from './scan-core.mts'

import type { LineHit } from './scan-core.mts'

// ── Programmatic-Claude lockdown (HARD block) ──────────────────────
//
// An SDK `query({…})` / `new ClaudeSDKClient({…})` call MUST pin the four
// lockdown options. See docs/fleet/agents.md/locking-down-agent-calls.md.
const CLAUDE_DRIVER_RE =
  /(?:(?<![.`'"])\bquery|new\s+ClaudeSDKClient)\s*\((?!\s*[A-Za-z_$][\w$]*\s*:)/
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
  const executable = maskStringContents(text)
  if (!CLAUDE_DRIVER_RE.test(executable)) {
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
  const lines = text.split(/\r?\n/)
  const hits = scanLines(executable, CLAUDE_DRIVER_RE)
  for (const hit of hits) {
    hit.line = lines[hit.lineNumber - 1]!
  }
  return hits
}

// ── Soak-exclude date annotations (HARD block, pnpm-workspace.yaml) ──
//
// Every exact-pin soak-bypass entry under `minimumReleaseAgeExclude:` carries a
// `# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotation on the line above.
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
    // An exact-pin bullet needs the annotation directly above, unless the slot
    // above carries the allow-marker. This mirrors the canonical check.
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
// Out-of-band writes to agent config dirs that order a guard bypass, secret
// exfiltration, or off-keychain tokens are the npm-worm postinstall signature.
const BYPASS_GRANT_SOURCE = '\\bAllow\\s+[a-z][a-z0-9-]*\\s+bypass\\b'
const POISON_RES: readonly RegExp[] = [
  // An operator bypass grant planted in a config file (not a hook/doc).
  new RegExp(BYPASS_GRANT_SOURCE, 'i'),
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
