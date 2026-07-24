#!/usr/bin/env node
/*
 * @file Render a page (or a real Chrome extension popup) to a PNG so an agent
 *   can SEE it — open the PNG with the Read tool and the rendered pixels go
 *   into context, catching layout / color / empty-state / render-throw bugs
 *   that code-reading misses. Pairs with the fleet "verify rendered output
 *   before commit" discipline (docs/agents.md/fleet/judgment-and-self-evaluation.md)
 *   — it's the HOW behind that rule. Technique + caveats:
 *   `.claude/skills/fleet/_shared/visual-verify.md`.
 *
 *   Two modes:
 *
 *   1. Page mode (default) — render any URL or local file:
 *        node scripts/fleet/screenshot.mts <url|file> [--out p.png] [--width 580]
 *          [--height 0=full] [--theme dark|light] [--wait 2500] [--full]
 *
 *   2. Extension mode — load an unpacked MV3 extension with its REAL chrome.*
 *      powers (background service worker + content scripts + popup), then
 *      screenshot a page inside it (the popup by default):
 *        node scripts/fleet/screenshot.mts --extension <unpacked-dir> [--page popup.html]
 *          [--out p.png] [--width 580] [--wait 2500] [--theme dark|light]
 *      Uses `channel: 'chromium'` — the documented way to run extensions in
 *      headless Chromium (plain headless silently ignores --load-extension).
 *
 *   Browser: playwright-core's bundled Chromium (a wheelhouse devDep). If the
 *   browser binary is missing, run `node_modules/.bin/playwright install chromium`.
 *
 *   Exit codes: 0 — PNG written (path printed); 1 — render / launch failed.
 */

import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { chromium } from 'playwright-core'

const logger = getDefaultLogger()

// Normalize a target into a navigable URL: pass http(s)/chrome-extension
// through; treat anything else as a local path → file:// URL.
export function toUrl(target: string): string {
  // Matches http://, https://, file://, or chrome-extension:// URL schemes.
  if (/^(?:chrome-extension|file|https?):/.test(target)) {
    return target
  }
  return `file://${path.resolve(target)}`
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    options: {
      extension: { type: 'string' },
      full: { type: 'boolean', default: false },
      height: { type: 'string' },
      out: { type: 'string' },
      page: { type: 'string' },
      theme: { type: 'string' },
      wait: { type: 'string' },
      width: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  })

  const width = Number(values.width ?? 580)
  const height = Number(values.height ?? 0)
  const waitMs = Number(values.wait ?? 2500)
  const out = path.resolve(values.out ?? 'screenshot.png')
  const colorScheme = values.theme === 'light' ? 'light' : 'dark'
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'fleet-shot-'))

  // Extension mode: load the unpacked dir with real extension powers.
  if (values.extension) {
    const extDir = path.resolve(values.extension)
    const ctx = await chromium.launchPersistentContext(userDataDir, {
      // `chromium` channel is what lets extensions load in headless mode.
      channel: 'chromium',
      colorScheme,
      viewport: { width, height: height || 900 },
      args: [
        `--disable-extensions-except=${extDir}`,
        `--load-extension=${extDir}`,
      ],
    })
    try {
      let [sw] = ctx.serviceWorkers()
      if (!sw) {
        sw = await ctx
          .waitForEvent('serviceworker', { timeout: 12_000 })
          .catch(() => undefined)
      }
      if (!sw) {
        logger.error(
          'Extension did not register a background service worker — check the manifest (manifest_version 3, background.service_worker) and that dist/ is built.',
        )
        process.exitCode = 1
        return
      }
      const extId = sw.url().split('/')[2]!
      const pageRel = values.page ?? 'popup.html'
      const target = `chrome-extension://${extId}/${pageRel}`
      const page = await ctx.newPage()
      await page.goto(target, { waitUntil: 'load' })
      await page.waitForTimeout(waitMs)
      await page.screenshot({ path: out, fullPage: values.full })
      logger.success(`Wrote ${out} (extension ${extId}, page ${pageRel}).`)
    } finally {
      await ctx.close()
      await safeDelete(userDataDir)
    }
    return
  }

  // Page mode: render a URL / local file.
  const target = positionals[0]
  if (!target) {
    logger.error(
      'Usage: screenshot.mts <url|file> [--out p.png] [--width 580] [--theme dark|light] [--wait ms] [--full]',
    )
    logger.error(
      'or: screenshot.mts --extension <unpacked-dir> [--page popup.html] [...]',
    )
    process.exitCode = 1
    return
  }
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    colorScheme,
    viewport: { width, height: height || 900 },
  })
  try {
    const page = await ctx.newPage()
    await page.goto(toUrl(target), { waitUntil: 'load' })
    await page.waitForTimeout(waitMs)
    await page.screenshot({ path: out, fullPage: values.full || height === 0 })
    logger.success(`Wrote ${out}.`)
  } finally {
    await ctx.close()
    await safeDelete(userDataDir)
  }
}

main().catch((e: unknown) => {
  logger.error(`screenshot failed: ${errorMessage(e)}`)
  process.exitCode = 1
})
