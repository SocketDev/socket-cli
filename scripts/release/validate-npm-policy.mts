#!/usr/bin/env node
import { appendFileSync } from 'node:fs'

import {
  type ReleasePolicy,
  matchesReleasePolicy,
  readReleasePolicy,
} from '../../src/sea/version.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

const STABLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u
const DIST_TAG = /^[A-Za-z][A-Za-z0-9._-]*$/u

export function validateNpmPolicy(
  version: string,
  distTag: string,
  policy: ReleasePolicy,
): void {
  if (!DIST_TAG.test(distTag)) {
    throw new Error('npm dist-tag is invalid.')
  }
  if (policy.mode === 'stable-from-hint') {
    if (!matchesReleasePolicy(version, policy)) {
      throw new Error(
        'Stable release policy does not allow a prerelease version.',
      )
    }
    if (distTag !== policy.distTag) {
      throw new Error(`Release policy requires the ${policy.distTag} dist-tag.`)
    }
    return
  }
  const policyMajor = Number(policy.versionHint.split('.')[0])
  const releaseMajor = Number(version.split('.')[0])
  if (releaseMajor === policyMajor) {
    if (!matchesReleasePolicy(version, policy)) {
      throw new Error(
        `Version must stay on the ${policy.versionHint}-${policy.identifier}.N prerelease track.`,
      )
    }
    if (distTag !== policy.distTag) {
      throw new Error(`Release policy requires the ${policy.distTag} dist-tag.`)
    }
    return
  }
  if (
    releaseMajor !== 1 ||
    !STABLE_VERSION.test(version) ||
    distTag !== 'latest'
  ) {
    throw new Error(
      'Only the configured prerelease track or a stable v1.x release on the latest dist-tag may be published.',
    )
  }
}

export function npmDistTagForRelease(
  version: string,
  policy: ReleasePolicy,
): string {
  if (policy.mode === 'stable-from-hint') {
    if (!matchesReleasePolicy(version, policy)) {
      throw new Error(
        'Stable release policy does not allow a prerelease version.',
      )
    }
    return policy.distTag
  }
  const policyMajor = Number(policy.versionHint.split('.')[0])
  if (Number(version.split('.')[0]) === policyMajor) {
    if (!matchesReleasePolicy(version, policy)) {
      throw new Error(
        `Version must stay on the ${policy.versionHint}-${policy.identifier}.N prerelease track.`,
      )
    }
    return policy.distTag
  }
  if (version.startsWith('1.') && STABLE_VERSION.test(version)) {
    return 'latest'
  }
  throw new Error(
    'Only the configured prerelease track or a stable v1.x release may be published.',
  )
}

function main(): void {
  const version = process.argv[2]
  if (!version) {
    throw new Error(
      'Usage: node scripts/release/validate-npm-policy.mts <version>',
    )
  }
  const policy = readReleasePolicy()
  const distTag = npmDistTagForRelease(version, policy)
  validateNpmPolicy(version, distTag, policy)
  const outputPath = process.env['GITHUB_OUTPUT']
  if (outputPath) {
    appendFileSync(outputPath, `dist-tag=${distTag}\n`)
  }
  process.stdout.write(`Validated ${version} for npm dist-tag ${distTag}.\n`)
}

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe: 'Validates the npm version and dist-tag against release policy.',
    help: 'Usage: node scripts/release/validate-npm-policy.mts <version> <dist-tag>',
  })
}
