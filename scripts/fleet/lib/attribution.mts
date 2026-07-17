/**
 * @file AI-attribution detection + removal for commit messages. Pure string
 *   functions (no FS, no git) so both consumers — the standalone
 *   `strip-ai-attribution.mts` rewriter and any pre-push style scanner —
 *   share one definition of "attribution" and stay fixture-testable.
 *   Fleet rule: NO AI attribution on any GitHub surface; the commit-msg hook
 *   strips it at write time, but commits minted with --no-verify (or born in
 *   another tool) can still carry it into history.
 */

/**
 * One line of AI attribution: a Co-authored-by/Generated-with/robot-emoji
 * trailer naming an AI assistant. Anchored per line; case-insensitive.
 */
export const AI_ATTRIBUTION_LINE_RE =
  /^\s*(?:co-authored-by:.*(?:claude|copilot|anthropic|openai|chatgpt|gemini|cursor)|(?:🤖\s*)?generated with\s+\[?(?:claude|copilot|chatgpt|gemini|cursor))/i

/**
 * True when any line of the message is an AI-attribution line.
 */
export function hasAiAttribution(message: string): boolean {
  return message.split('\n').some(line => AI_ATTRIBUTION_LINE_RE.test(line))
}

/**
 * The message without its AI-attribution lines, normalized so it round-trips
 * through git cleanly: interior blank runs collapse to one blank line and the
 * message ends with exactly one newline.
 */
export function stripAiAttribution(message: string): string {
  const kept = message
    .split('\n')
    .filter(line => !AI_ATTRIBUTION_LINE_RE.test(line))
  let out = kept.join('\n')
  out = out.replace(/\n{3,}/g, '\n\n')
  out = `${out.replace(/\s+$/, '')}\n`
  return out
}
