#!/usr/bin/env node
/**
 * @file `check --all` gate: the fleet-owned local-agent egress allowlist
 *   (.config/fleet/egress-allowlist.json) is a SUBSET of gh-aw's expanded
 *   firewall allowDomains — the hosts CI's agent firewall already trusts. This
 *   is one-directional containment (fleet ⊆ gh-aw), NOT byte-equality: gh-aw
 *   owns its list (it expands the `defaults` bundle at compile time), so a
 *   gh-aw version bump that re-expands `defaults` must not flap this check. We
 *   only fail when the fleet list grants a host gh-aw does NOT permit — a local
 *   egress reach the CI fence would block, i.e. a hole. Background:
 *   docs/agents.md/fleet/agent-egress.md.
 *   Reference set = the union of every `allowDomains` array across the repo's
 *   compiled gh-aw `*.lock.yml` files. A gh-aw `*.suffix` wildcard covers any
 *   subdomain of `suffix`. Vacuous pass (exit 0) when the allowlist is absent
 *   (a repo not yet onboarded) or no gh-aw lock declares allowDomains (a pure
 *   consumer with no agentic workflow — nothing to contain against here; the
 *   SSOT is validated in the repos that carry the workflow). Exit 1 only when a
 *   fleet host escapes the gh-aw set.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- sync check; needs typed string stdout from `git ls-files`, no async.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const ALLOWLIST_REL = '.config/fleet/egress-allowlist.json'

// Every `allowDomains` array embedded in a gh-aw compiled lock, unioned. gh-aw
// writes the same list into multiple printf'd JSON blobs (main run + threat
// detection), sometimes with a one-host delta; the union is the most permissive
// gh-aw-trusted set, so containment never false-fails on a host one blob omits.
export function collectGhAwAllowDomains(lockText: string): string[] {
  const hosts: string[] = []
  const re = /"allowDomains"\s*:\s*\[([^\]]*)\]/gu
  let m: RegExpExecArray | null = re.exec(lockText)
  while (m) {
    const body = m[1]!
    // A JSON double-quoted string: opening `"`, then any mix of non-`"\`
    // characters or backslash-escaped pairs `\.`, then closing `"`.
    const strRe = /"((?:[^"\\]|\\.)*)"/gu
    let s: RegExpExecArray | null = strRe.exec(body)
    while (s) {
      hosts.push(s[1]!)
      s = strRe.exec(body)
    }
    m = re.exec(lockText)
  }
  return hosts
}

// A fleet host is covered if it's an exact member of the gh-aw set, or a gh-aw
// `*.suffix` wildcard covers it. A fleet `*.suffix` wildcard is covered only by
// an identical gh-aw wildcard (an exact-membership match) — we never widen.
export function isCovered(host: string, ghSet: ReadonlySet<string>): boolean {
  if (ghSet.has(host)) {
    return true
  }
  if (host.startsWith('*.')) {
    return false
  }
  for (const entry of ghSet) {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(2)
      if (host === suffix || host.endsWith(`.${suffix}`)) {
        return true
      }
    }
  }
  return false
}

function listGhAwLocks(): string[] {
  try {
    const r = spawnSync('git', ['ls-files', '*.github/workflows/*.lock.yml'], {
      stdio: 'pipe',
    })
    if (r.status !== 0) {
      return []
    }
    const { stdout } = r
    return (typeof stdout === 'string' ? stdout : String(stdout))
      .split(/\r?\n/u)
      .map(s => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

const allowlistPath = path.join(REPO_ROOT, ALLOWLIST_REL)

if (!existsSync(allowlistPath)) {
  logger.log(
    `egress allowlist: no ${ALLOWLIST_REL} in this repo (not applicable).`,
  )
  process.exitCode = 0
} else {
  let fleetHosts: string[] = []
  let mode: unknown
  let parsedOk = false
  try {
    const parsed = JSON.parse(readFileSync(allowlistPath, 'utf8')) as {
      allowDomains?: unknown | undefined
      mode?: unknown | undefined
    }
    mode = parsed.mode
    if (
      !Array.isArray(parsed.allowDomains) ||
      !parsed.allowDomains.every(h => typeof h === 'string')
    ) {
      logger.fail(
        `[egress-allowlist] malformed ${ALLOWLIST_REL}: "allowDomains" must be ` +
          `an array of hostname strings (saw ${JSON.stringify(parsed.allowDomains)}). ` +
          `Fix: restore the array; edit template/base/${ALLOWLIST_REL} + cascade.`,
      )
      process.exitCode = 1
    } else {
      fleetHosts = parsed.allowDomains as string[]
      parsedOk = true
    }
  } catch (e) {
    logger.fail(
      `[egress-allowlist] could not parse ${ALLOWLIST_REL}: ${String(e)}. ` +
        `Fix: it must be valid JSON; edit template/base/${ALLOWLIST_REL} + cascade.`,
    )
    process.exitCode = 1
  }

  if (parsedOk) {
    const locks = listGhAwLocks()
    const ghHosts = new Set<string>()
    for (let i = 0, { length } = locks; i < length; i += 1) {
      try {
        for (const h of collectGhAwAllowDomains(
          readFileSync(locks[i]!, 'utf8'),
        )) {
          ghHosts.add(h)
        }
      } catch {
        // Unreadable lock — skip; a lock we can't read can't widen the set.
      }
    }

    if (ghHosts.size === 0) {
      logger.log(
        `egress allowlist: ${ALLOWLIST_REL} present, but no gh-aw lock declares ` +
          `allowDomains here — nothing to contain against (not applicable).`,
      )
      process.exitCode = 0
    } else {
      const escapes = fleetHosts.filter(h => !isCovered(h, ghHosts))
      if (escapes.length === 0) {
        logger.success(
          `[egress-allowlist] ${fleetHosts.length} host(s) subset-of gh-aw ` +
            `firewall allowDomains (${ghHosts.size} trusted); mode="${String(mode)}".`,
        )
        process.exitCode = 0
      } else {
        logger.fail(
          `[egress-allowlist] ${escapes.length} host(s) in ${ALLOWLIST_REL} are ` +
            `NOT permitted by gh-aw's firewall allowDomains:`,
        )
        for (let i = 0, { length } = escapes; i < length; i += 1) {
          logger.substep(escapes[i]!)
        }
        logger.error(
          `Wanted: every local-egress host also trusted by the CI agent fence. ` +
            `Fix: remove the host from template/base/${ALLOWLIST_REL} + cascade, or ` +
            `add it to the gh-aw workflow's network.allowed (get-green.md) and recompile ` +
            `so the fence trusts it too.`,
        )
        process.exitCode = 1
      }
    }
  }
}
