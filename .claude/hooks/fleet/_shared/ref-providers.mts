/*
 * @file Which issue-tracker a bare reference in a reply belongs to, decided from
 *   the tools the session ACTUALLY used rather than from the shape of the token.
 *
 *   The shape alone cannot answer it. `ENG-456` is a Linear issue and `SHA-256`
 *   is a hash; `RFC-2606`, `ISO-8601`, `UTF-8`, and `CVE-2026-1` all match the
 *   same `[A-Z]+-\d+` silhouette. A regex that flagged them would fire on half
 *   the fleet's own docs, and one narrow enough to avoid that would miss every
 *   team key it had not been told about.
 *
 *   The session's tool calls settle it without guessing. A reply that mentions
 *   `SURF-1456` in a turn that called `mcp__linear__get_issue` is talking about
 *   the issue it just read, and the destination follows from the provider. No
 *   Linear call anywhere in the session means a `[A-Z]+-N` token is far more
 *   likely to be a spec number, so nothing fires.
 *
 *   This is deliberately evidence-based rather than AI-assisted. The classifier
 *   an `odai` extract-then-decide pass would provide is not needed when the
 *   transcript already records which tracker was open, and the fleet's own rule
 *   is to exhaust the deterministic path first. `localAssistEnabled` is also
 *   opt-in per repo, so an AI-only answer would silently do nothing wherever it
 *   is off.
 */

import { readPriorAssistantToolUses } from './transcript.mts'

import type { ToolUseEvent } from './transcript.mts'

/**
 * How many prior assistant turns to scan for provider evidence. A tracker
 * touched early in a long session is still the tracker under discussion, so
 * this reaches well past the immediate turn.
 */
export const PROVIDER_LOOKBACK_TURNS = 40

/**
 * An issue-tracker a reply can reference, with the tool-name fragments that
 * prove the session used it and the URL shape a reference should carry.
 *
 * `toolFragments` are matched as substrings of a tool name, so both the
 * claude.ai connector spelling (`mcp__claude_ai_Linear__…`) and a
 * project-server spelling (`mcp__linear__…`) count — which one arrives depends
 * on the checkout's `.mcp.json`, never on what the reply is about.
 */
export interface RefProvider {
  readonly name: string
  readonly refShape: string
  readonly toolFragments: readonly string[]
  readonly urlShape: string
}

export const REF_PROVIDERS: readonly RefProvider[] = [
  {
    name: 'GitHub',
    refShape: '#123 or owner/repo#123',
    toolFragments: ['gh ', 'mcp__github'],
    urlShape: 'https://github.com/<owner>/<repo>/pull/123',
  },
  {
    name: 'Linear',
    refShape: 'ABC-123',
    toolFragments: ['linear'],
    urlShape: 'https://linear.app/<workspace>/issue/ABC-123',
  },
  {
    name: 'Notion',
    refShape: 'a page title',
    toolFragments: ['notion'],
    urlShape: 'https://www.notion.so/<page-id>',
  },
]

/**
 * True when `event` is evidence the session used `provider`.
 *
 * A Bash call counts only when the fragment appears at a command position in
 * the command string, so prose mentioning `linear` in a commit message is not
 * evidence. MCP tool names are matched on the name itself, which carries no
 * prose.
 */
export function eventUsesProvider(
  event: ToolUseEvent,
  provider: RefProvider,
): boolean {
  const name = event.name.toLowerCase()
  for (let i = 0, { length } = provider.toolFragments; i < length; i += 1) {
    const fragment = provider.toolFragments[i]!
    // A TRAILING SPACE marks a CLI fragment, matched at a command position so
    // `gh pr view` counts and `git commit -m "gh is nice"` does not. Anything
    // else is matched against the tool NAME, which carries no prose and so needs
    // no position rule.
    if (fragment.endsWith(' ')) {
      if (name === 'bash') {
        const command = event.input['command']
        if (
          typeof command === 'string' &&
          command.trimStart().startsWith(fragment)
        ) {
          return true
        }
      }
      continue
    }
    if (name.includes(fragment)) {
      return true
    }
  }
  return false
}

/**
 * The providers this session has evidence of using, in `REF_PROVIDERS` order.
 *
 * An unreadable or missing transcript answers an empty list: with no evidence
 * the caller should stay silent rather than guess a destination, which is the
 * same blindness-is-not-absence rule the fleet's checks follow.
 */
export function sessionRefProviders(
  transcriptPath: string | undefined,
  lookback: number = PROVIDER_LOOKBACK_TURNS,
): RefProvider[] {
  const events = readPriorAssistantToolUses(transcriptPath, lookback)
  if (events.length === 0) {
    return []
  }
  const found: RefProvider[] = []
  for (let i = 0, { length } = REF_PROVIDERS; i < length; i += 1) {
    const provider = REF_PROVIDERS[i]!
    for (let j = 0, { length: eventCount } = events; j < eventCount; j += 1) {
      if (eventUsesProvider(events[j]!, provider)) {
        found.push(provider)
        break
      }
    }
  }
  return found
}

/**
 * The hint line naming where a reference should point, given the providers the
 * session used. Undefined when there is no evidence, so a caller prints nothing
 * rather than a generic lecture.
 */
export function refDestinationHint(
  providers: readonly RefProvider[],
): string | undefined {
  if (providers.length === 0) {
    return undefined
  }
  const parts = providers.map(p => `${p.name} (${p.refShape} → ${p.urlShape})`)
  return `This session used ${parts.join(', ')} — link a reference to the tracker it came from.`
}
