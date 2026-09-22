#!/usr/bin/env node

import process from 'node:process'

import { assertReleaseVersionsAvailable } from './registry.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

import type { ScriptMeta } from '../lib/run-main.mts'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const versionIndex = argv.indexOf('--version')
  const version = versionIndex === -1 ? '' : (argv[versionIndex + 1] ?? '')
  const result = await assertReleaseVersionsAvailable(version)
  process.stdout.write(
    argv.includes('--json')
      ? `${JSON.stringify(result)}\n`
      : `[release] ${result.version} is unpublished for all ${result.packages.length} packages.\n`,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'confirms the exact release version is unpublished for all three CLI packages',
  help: `Usage: pnpm run release:preflight --version <version> [--json]

  --version <version>  exact stable version produced by the bump step
  --json               print the confirmed version and package names as JSON

  Only HTTP 404 confirms an absent version. Registry failures stop the release.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
