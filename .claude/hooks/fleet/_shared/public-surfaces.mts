/**
 * @file Shared "is this command a public-facing publish?" check. The
 *   public-surface-reminder (Stop, nudges) and private-name-reminder (PreToolUse,
 *   blocks a private name reaching a public surface) both gate on the same set
 *   of outward-facing commands — commit, push, gh pr/issue/release, mutating gh
 *   api. One source keeps the two gates from drifting.
 */

// Commands that can publish content outside the local machine.
// Keep broad — better to remind on an extra read than miss a write.
export const PUBLIC_SURFACE_PATTERNS: readonly RegExp[] = [
  /\bgit\s+commit\b/,
  /\bgit\s+push\b/,
  /\bgh\s+pr\s+(?:comment|create|edit|review)\b/,
  /\bgh\s+issue\s+(?:comment|create|edit)\b/,
  /\bgh\s+api\b[^|]*-X\s*(?:PATCH|POST|PUT)\b/i,
  /\bgh\s+release\s+(?:create|edit)\b/,
]

/**
 * True when `command` invokes one of the public-surface publish commands.
 */
export function isPublicSurface(command: string): boolean {
  const normalized = command.replace(/\s+/g, ' ')
  return PUBLIC_SURFACE_PATTERNS.some(re => re.test(normalized))
}
