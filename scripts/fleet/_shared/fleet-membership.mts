/**
 * @file Fleet-membership gate for fleet tools that WRITE into a repo working
 *   tree — the bundle fetcher, the `.agents/` skills-mirror generator,
 *   soak-bypass, and the cascade drivers that take a destination. A fleet
 *   sweep once treated a non-member clone under `~/projects` as fleet surface
 *   and landed a fleet-convention commit there; the lesson: location is not
 *   membership. Membership is the DESTINATION's origin remote resolved
 *   against the canonical roster. The predicates derive from the hooks'
 *   `fleet-repos.mts`, which single-sources the roster JSON — never a second
 *   repo list here.
 *   Escape hatch — explicit and audited, never an env-var default:
 *   `--allow-non-member --reason "<why>"`. The reason is required; callers
 *   log the returned note so every sanctioned non-member write leaves a
 *   trail in the transcript. Doctrine:
 *   docs/agents.md/fleet/single-source-of-truth.md and the cascading-fleet
 *   skill's membership-gate section.
 */

import {
  isFleetRepo,
  originRemoteUrl,
  slugFromRemoteUrl,
} from '../../../.claude/hooks/fleet/_shared/fleet-repos.mts'

/**
 * Repo-relative path of the canonical roster — named in every refusal
 * message so the operator knows exactly which file defines membership.
 */
export const FLEET_ROSTER_REL =
  '.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json'

/**
 * The audited escape hatch a writing tool accepts: `--allow-non-member`
 * plus a REQUIRED `--reason "<why>"`.
 */
export interface NonMemberOverride {
  readonly allowNonMember: boolean
  readonly reason: string | undefined
}

/**
 * What the thin git probe learned about a destination: its origin remote
 * URL, the slug extracted from it, and the roster verdict.
 */
export interface MembershipProbe {
  readonly member: boolean
  readonly originUrl: string | undefined
  readonly slug: string | undefined
}

/**
 * A writing tool's destination verdict. `allowed: true` may carry an audit
 * `note` the caller MUST log — that line is the trail a sanctioned
 * non-member write leaves. `allowed: false` carries the full refusal
 * message.
 */
export type WriteGateVerdict =
  | { readonly allowed: true; readonly note: string | undefined }
  | { readonly allowed: false; readonly message: string }

/**
 * Parse the escape hatch out of raw argv: `--allow-non-member` plus
 * `--reason <why>` or `--reason=<why>`. Position-tolerant — tools with
 * positional args parse their own flags and hand the raw argv here.
 */
export function parseNonMemberOverride(
  argv: readonly string[],
): NonMemberOverride {
  let allowNonMember = false
  let reason: string | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--allow-non-member') {
      allowNonMember = true
    } else if (arg === '--reason') {
      reason = argv[i + 1]
      i += 1
    } else if (arg.startsWith('--reason=')) {
      reason = arg.slice('--reason='.length)
    }
  }
  return { allowNonMember, reason: reason || undefined }
}

/**
 * Thin git probe over a destination directory. `member` is false when the
 * origin remote is missing or not a recognizable GitHub remote — an
 * unverifiable destination is NOT fleet surface.
 */
export function probeMembership(dir: string): MembershipProbe {
  const originUrl = originRemoteUrl(dir)
  const slug =
    originUrl === undefined ? undefined : slugFromRemoteUrl(originUrl)
  return {
    member: slug !== undefined && isFleetRepo(slug),
    originUrl,
    slug,
  }
}

/**
 * Pure verdict over a probe + override — unit-testable without git. Members
 * pass silently. Non-members refuse with a message naming the roster, the
 * failing origin, and the escape hatch — or pass with an audit note when
 * `--allow-non-member --reason "<why>"` was given.
 */
export function decideWriteGate(config: {
  readonly destDir: string
  readonly override: NonMemberOverride
  readonly probe: MembershipProbe
  readonly toolName: string
}): WriteGateVerdict {
  const { destDir, override, probe, toolName } = config
  if (probe.member) {
    return { allowed: true, note: undefined }
  }
  const origin = probe.originUrl ?? 'none — no origin remote resolvable'
  if (override.allowNonMember) {
    if (!override.reason) {
      return {
        allowed: false,
        message:
          `[${toolName}] Refused: --allow-non-member requires ` +
          '--reason "<why>" — the logged reason is the audit trail for a ' +
          'non-member write.',
      }
    }
    return {
      allowed: true,
      note:
        `[${toolName}] WARNING: writing into NON-member ${destDir} — ` +
        `origin: ${origin} — allowed by --allow-non-member. ` +
        `Reason: ${override.reason}`,
    }
  }
  return {
    allowed: false,
    message: [
      `[${toolName}] Refused: destination is not a fleet member.`,
      `  dest:   ${destDir}`,
      `  origin: ${origin}`,
      '',
      '  Fleet tooling writes only into roster members. Membership is the',
      "  destination's origin remote resolved against the canonical roster:",
      `    ${FLEET_ROSTER_REL}`,
      '  A clone under ~/projects is not fleet surface by location.',
      '',
      '  If this non-member write is genuinely intended, re-run with the',
      '  audited escape hatch — explicit flags, never an env var:',
      '    --allow-non-member --reason "<why this write is safe>"',
    ].join('\n'),
  }
}

/**
 * Probe + decide in one call — the boundary check every writing tool runs
 * against its destination before the first byte lands.
 */
export function gateWriteDest(config: {
  readonly destDir: string
  readonly override: NonMemberOverride
  readonly toolName: string
}): WriteGateVerdict {
  const { destDir, override, toolName } = config
  return decideWriteGate({
    destDir,
    override,
    probe: probeMembership(destDir),
    toolName,
  })
}
