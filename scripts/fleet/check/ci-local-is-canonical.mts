#!/usr/bin/env node
/*
 * @file Code-is-law backing for the onboarding skill's CI step (step 18 of
 *   `.claude/skills/fleet/onboarding-fleet-member/SKILL.md`). The skill
 *   DESCRIBES the local-CI path; this check ENFORCES it so the prose can't
 *   drift from reality:
 *
 *   - `ci:local` shape — if package.json declares a `ci:local` script, it must be
 *     the canonical agent-ci command. A repo that dropped a flag (or the whole
 *     script) in a bad cascade would otherwise run a different / no local CI
 *     than the skill + the cascaded `agent-ci-local.test.mts` assume.
 *   - agent-ci Dockerfile identity — `.github/agent-ci.Dockerfile` is
 *     OPTIONAL_IDENTICAL (opt-in; byte-identical to the template WHEN present).
 *     A drifted copy would bake a different pnpm than CI uses. Only enforced
 *     when a template copy is reachable (the wheelhouse, or a checkout that
 *     vendored it); a downstream repo without the template skips that half.
 *     Scope: the repo this runs in (check --all is per-repo). Exit codes: 0 —
 *     the ci:local script (and Dockerfile, if present) are canonical; 1 —
 *     drift.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Single source of truth, mirrored in the scripts manifest
// (scripts/repo/sync-scaffolding/manifest/scripts.mts) + the cascaded
// agent-ci-local.test.mts. Keep all three in lock-step.
const CANONICAL_CI_LOCAL =
  'node scripts/fleet/agent-ci-skip-locks.mts run --all --quiet --pause-on-failure --github-token'

const AGENT_CI_DOCKERFILE = '.github/agent-ci.Dockerfile'

export function ciLocalScript(repoDir: string): string | undefined {
  const pkgPath = path.join(repoDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return undefined
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string> | undefined
  }
  return pkg.scripts?.['ci:local']
}

// The reachable canonical Dockerfile: prefer the in-repo template (the
// wheelhouse), else undefined (a downstream repo can't compare without it).
export function templateDockerfilePath(repoDir: string): string | undefined {
  // The canonical seed lives under template/base/ (not the old top-level
  // template/); a stale template/.github/... probe returned undefined for the
  // wheelhouse, so the byte-identity check below was silently skipped.
  const inTemplate = path.join(repoDir, 'template', 'base', AGENT_CI_DOCKERFILE)
  return existsSync(inTemplate) ? inTemplate : undefined
}

async function main(): Promise<void> {
  const errors: string[] = []

  // 1. ci:local script shape (when declared).
  const ciLocal = ciLocalScript(REPO_ROOT)
  if (ciLocal !== undefined && ciLocal !== CANONICAL_CI_LOCAL) {
    errors.push(
      `package.json scripts.ci:local must be the canonical agent-ci command.\n` +
        `    saw:    ${JSON.stringify(ciLocal)}\n` +
        `    wanted: ${JSON.stringify(CANONICAL_CI_LOCAL)}\n` +
        `    Fix: restore the canonical command (it cascades from the scripts manifest).`,
    )
  }

  // 2. agent-ci Dockerfile byte-identity (when both the repo copy + a template
  //    reference exist).
  const repoDockerfile = path.join(REPO_ROOT, AGENT_CI_DOCKERFILE)
  const templateDockerfile = templateDockerfilePath(REPO_ROOT)
  if (existsSync(repoDockerfile) && templateDockerfile) {
    const repoText = readFileSync(repoDockerfile, 'utf8')
    const templateText = readFileSync(templateDockerfile, 'utf8')
    if (repoText !== templateText) {
      errors.push(
        `${AGENT_CI_DOCKERFILE} drifted from template/${AGENT_CI_DOCKERFILE}.\n` +
          `    It's OPTIONAL_IDENTICAL — byte-identical when present.\n` +
          `    Fix: re-copy it from the template, or remove it to opt out.`,
      )
    }
  }

  if (errors.length) {
    logger.error(`ci-local-is-canonical: ${errors.length} finding(s):`)
    for (let i = 0, { length } = errors; i < length; i += 1) {
      logger.error(`  ${errors[i]!}`)
    }
    process.exitCode = 1
    return
  }

  logger.success('ci:local (and agent-ci Dockerfile, if present) is canonical.')
}

main().catch((e: unknown) => {
  logger.error(`check-ci-local-is-canonical failed: ${errorMessage(e)}`)
  process.exitCode = 1
})
