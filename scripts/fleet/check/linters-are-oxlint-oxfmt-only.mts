/**
 * @file Code-is-law check for the fleet "oxlint + oxfmt only" rule. Scans the
 *   COMMITTED state (git-tracked files) for foreign linter/formatter configs +
 *   package.json deps that the edit-time `no-other-linters-guard` hook blocks —
 *   so a config/dep that slipped in before the hook existed (or via
 *   --no-verify) is caught at `check --all` time. The hook is the edit-time
 *   block; this is the committed-state gate;
 *   `socket/no-eslint-biome-config-ref` reports source refs. Detection +
 *   the `fleet.hostTestDeps` host-test exemption (adapter packages
 *   integration-testing against a foreign host keep it in dev/peer deps with
 *   no script invoking it) live in the shared
 *   `.claude/hooks/fleet/_shared/foreign-linters.mts` classifier — one
 *   contract, both layers. Fails (exit 1) on: a tracked foreign config
 *   (biome.json(c) / .eslintrc* / eslint.config.* / .prettierrc* /
 *   prettier.config.* / .dprint.json*), or a tracked package.json whose
 *   foreign dep(s) fail the audit. EXEMPT: vendored upstream trees
 *   (upstream/, vendor/, third_party/, external/, a path segment ending
 *   `-upstream`). We never touch upstream files.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  auditForeignDeps,
  isForeignConfigFile,
  isTestFixture,
  isVendoredUpstream,
} from '../../../.claude/hooks/fleet/_shared/foreign-linters.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

function trackedFiles(): string[] {
  const result = spawnSync('git', ['ls-files'], { stdio: 'pipe' })
  const out = typeof result.stdout === 'string' ? result.stdout : ''
  return out.split('\n').filter(Boolean)
}

function main(): void {
  const failures: string[] = []
  for (const rel of trackedFiles()) {
    if (isVendoredUpstream(rel) || isTestFixture(rel)) {
      continue
    }
    const basename = path.basename(rel)
    if (isForeignConfigFile(basename)) {
      failures.push(`${rel}: foreign linter/formatter config file`)
      continue
    }
    if (basename === 'package.json') {
      let text: string
      try {
        text = readFileSync(path.join(REPO_ROOT, rel), 'utf8')
      } catch {
        continue
      }
      const { blocked } = auditForeignDeps(text)
      for (const finding of blocked) {
        failures.push(`${rel}: \`${finding.name}\` — ${finding.reason}`)
      }
    }
  }

  if (failures.length) {
    logger.error(
      `[only-oxlint-oxfmt] ${failures.length} foreign linter/formatter surface(s) — the fleet uses oxlint + oxfmt only:`,
    )
    for (let i = 0, { length } = failures; i < length; i += 1) {
      logger.error(`  ${failures[i]!}`)
    }
    logger.error(
      'Remove the config/dep, or — for an adapter package integration-testing against a foreign host — declare `"fleet": { "hostTestDeps": [...] }` and keep the dep in devDependencies/peerDependencies with no script invoking it. Vendored upstream (upstream/, vendor/, *-upstream) is exempt.',
    )
    process.exitCode = 1
    return
  }
  logger.success(
    '[only-oxlint-oxfmt] no foreign linters/formatters in tracked files.',
  )
}

main()
