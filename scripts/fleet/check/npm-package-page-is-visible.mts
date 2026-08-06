/**
 * @file Detect an npm publish-time review hold on this repo's published
 *   package. Since 2026-07-28, npm scans every publish before it goes fully
 *   live (github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning
 *   -and-dual-use-metadata): a package can be published normally, HELD for
 *   manual review, or blocked. A HELD package is a split-brain state that
 *   cost a real diagnosis session (@socketsecurity/odai@0.1.0, 2026-07-31):
 *   the registry serves it — dist-tags resolve, the tarball 200s,
 *   `npm install` works — while the npmjs.com package page answers 403, so
 *   humans browsing npm see "not published" and agents chase phantom causes
 *   (repo privacy, provenance, "setup was messed up").
 *   REPORT-MODE by design: a hold is npm-side and not repo-fixable, so a red
 *   check would sit red for days over something no commit can change. The
 *   check prints the exact state and the next moves instead. What IS
 *   repo-fixable is prevention: Socket ships dual-use security tooling, and
 *   npm's scanner wants that declared — a `contentPolicy` field in
 *   package.json and a text DISCLOSURE file describing the legitimate use.
 *   Usage: node scripts/fleet/check/npm-package-page-is-visible.mts [--quiet]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export type PageVisibility =
  | 'held-for-review'
  | 'not-published'
  | 'private-package'
  | 'unreadable'
  | 'visible'

/**
 * Classify the split between the registry's answer and the website's. Pure
 * over the two observations so tests never touch the network.
 */
export function classifyPageVisibility(observed: {
  pageStatus: number
  registryHasPackage: boolean
}): PageVisibility {
  const o = { __proto__: null, ...observed } as typeof observed
  if (!o.registryHasPackage) {
    return 'not-published'
  }
  if (o.pageStatus === 200) {
    return 'visible'
  }
  if (o.pageStatus === 403 || o.pageStatus === 404) {
    // Registry live + page withheld is the publish-time review hold. 404 is
    // included: npm has served both codes for withheld pages.
    return 'held-for-review'
  }
  return 'unreadable'
}

export async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const pkg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
  ) as { name?: string | undefined; private?: boolean | undefined }
  if (!pkg.name || pkg.private) {
    if (!quiet) {
      logger.log(
        'npm-package-page-is-visible: private or nameless package — nothing published to probe.',
      )
    }
    return
  }
  const encoded = pkg.name.replaceAll('/', '%2f')
  let registryHasPackage = false
  try {
    const reg = await httpRequest(`https://registry.npmjs.org/${encoded}`, {
      method: 'GET',
    })
    registryHasPackage = reg.ok
  } catch {
    logger.warn(
      `npm-package-page-is-visible: registry unreachable — NOT VERIFIED (an unread source is never a pass).`,
    )
    return
  }
  let pageStatus = 0
  try {
    const page = await httpRequest(
      `https://www.npmjs.com/package/${pkg.name}`,
      { method: 'GET' },
    )
    pageStatus = page.status
  } catch {
    pageStatus = 0
  }
  const state = classifyPageVisibility({ pageStatus, registryHasPackage })
  switch (state) {
    case 'held-for-review':
      logger.warn(
        [
          `${pkg.name}: PUBLISH-TIME REVIEW HOLD — the registry serves the package (installable) but npmjs.com withholds its page (HTTP ${pageStatus}).`,
          '  What: npm scans every publish since 2026-07-28; suspicious-but-inconclusive findings hold the page for manual review while installs keep working.',
          '  Not repo-fixable: the hold clears on npm review, or a support ticket from the org account expedites it.',
          '  Prevent on future publishes: declare dual-use security capabilities — a `contentPolicy` field in package.json + a text DISCLOSURE file describing the legitimate use.',
          '  Reference: github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata',
        ].join('\n'),
      )
      return
    case 'not-published':
      if (!quiet) {
        logger.log(
          `npm-package-page-is-visible: ${pkg.name} is not on the registry — nothing to probe.`,
        )
      }
      return
    case 'unreadable':
      logger.warn(
        `npm-package-page-is-visible: page probe inconclusive (HTTP ${pageStatus}) — NOT VERIFIED.`,
      )
      return
    default:
      if (!quiet) {
        logger.success(`${pkg.name}: package page is publicly visible.`)
      }
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "checks the published package's npmjs.com page is visible — detects a publish-time review hold",
  help: `Usage: node scripts/fleet/check/npm-package-page-is-visible.mts [flags]

  --quiet  silent on clean / nothing to probe`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
