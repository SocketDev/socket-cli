import { readFileSync } from 'node:fs'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { loadSocketWheelhouseConfig, PACKAGE_JSON } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'
import { cliReleaseSource } from '../bump.mts'
import {
  checkCliPackageShape,
  checkCliReleaseVersion,
} from './cli-package-is-single.mts'

export async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
  const release = loadSocketWheelhouseConfig()?.value['release'] as
    | { publishedPackages?: string[] | undefined }
    | undefined
  const source = await cliReleaseSource(manifest.version)
  const findings = [
    ...checkCliPackageShape(manifest, release?.publishedPackages ?? []),
    ...checkCliReleaseVersion({
      date: source.date.replaceAll('-', ''),
      distTag: getEnvValue('DIST_TAG') ?? manifest.publishConfig?.tag ?? '',
      sha: source.sha,
      version: process.argv.includes('--reserved')
        ? manifest.version
        : source.version,
    }),
  ]
  if (findings.length) {
    throw new Error(
      `Socket CLI publish contract failed. Where: release package. Saw ${findings.join(' ')} Fix: publish a source-bound 2.x prerelease with the prerelease tag.`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe: 'validates the Socket CLI npm release contract',
    help: 'Usage: pnpm run prepublish:check [--reserved]',
  })
}
