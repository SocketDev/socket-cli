#!/usr/bin/env node
/*
 * @file Enforce the six-skill interface-design cluster's routing graph.
 *
 * Skills are operational documentation, but a handoff only exists when its
 * link resolves. The design authority and each focused companion therefore
 * link directly to every other cluster member. This keeps discovery and
 * escalation available from whichever interface task an agent starts with.
 *
 * Exit 0: every cluster skill links to every peer. Exit 1: a link is absent.
 * Usage: node scripts/fleet/check/design-skill-cluster-is-connected.mts
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export const DESIGN_SKILL_CLUSTER = [
  'designing-interfaces',
  'extracting-design-systems',
  'improving-web-interfaces',
  'reviewing-web-interfaces',
  'optimizing-react-interfaces',
  'testing-web-interfaces',
] as const

export interface MissingDesignSkillLink {
  source: string
  target: string
}

/**
 * Find absent direct SKILL.md links in a supplied cluster source map. Pure so
 * the routing contract is unit-testable without a checkout.
 */
export function findMissingDesignSkillLinks(
  sources: Readonly<Record<string, string>>,
  cluster: readonly string[] = DESIGN_SKILL_CLUSTER,
): MissingDesignSkillLink[] {
  const missing: MissingDesignSkillLink[] = []
  for (const source of cluster) {
    const content = sources[source]
    for (const target of cluster) {
      if (source === target) {
        continue
      }
      const link = `../${target}/SKILL.md`
      if (!content?.includes(link)) {
        missing.push({ source, target })
      }
    }
  }
  return missing
}

function loadClusterSources(repoRoot: string): Record<string, string> {
  const skillsDir = path.join(repoRoot, '.claude/skills/fleet')
  return Object.fromEntries(
    DESIGN_SKILL_CLUSTER.map(name => {
      const file = path.join(skillsDir, name, 'SKILL.md')
      return [name, existsSync(file) ? readFileSync(file, 'utf8') : '']
    }),
  )
}

async function main(): Promise<void> {
  const missing = findMissingDesignSkillLinks(loadClusterSources(REPO_ROOT))
  if (missing.length === 0) {
    logger.success('interface-design skill cluster is fully connected.')
    return
  }
  logger.error('interface-design skill cluster has missing companion links:')
  for (const finding of missing) {
    logger.error(
      `  ${finding.source} → ${finding.target}: add ../${finding.target}/SKILL.md`,
    )
  }
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    logger.error(`design-skill-cluster-is-connected failed: ${String(error)}`)
    process.exitCode = 1
  })
}
