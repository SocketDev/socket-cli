#!/usr/bin/env node
/*
 * @file `check --all` gate: DISCLOSURE files state only what the manifest can
 *   prove. npm's dual-use policy (https://docs.npmjs.com/policies/dual-use)
 *   asks for free-form text describing the dual-use functionality and its
 *   intended legitimate use — and npm Trust & Safety reads it when reviewing
 *   the package, so an inaccurate disclosure is a legal exposure, not a docs
 *   nit. The completeness twin (dual-use-declarations-are-complete.mts)
 *   proves the declaration EXISTS; this check proves its content is GROUNDED
 *   in the manifest next to it:
 *
 *     - BIN-GROUNDED     — every `bin` key of the declaring manifest appears
 *                          verbatim in the DISCLOSURE. A disclosure that
 *                          omits an executable understates the interception
 *                          surface (a real first draft named three of a
 *                          manifest's five commands).
 *     - NAME-GROUNDED    — the manifest's package name appears in the
 *                          DISCLOSURE, so the file cannot drift to describing
 *                          a different package.
 *     - REPO-GROUNDED    — when the manifest declares a repository, the
 *                          DISCLOSURE carries its https URL, so reviewers can
 *                          check every claim against public source.
 *     - SENTRY-GROUNDED  — a declaring manifest that depends on a Sentry
 *                          package must say so: error/crash telemetry is
 *                          network transmission the "sends only scan data"
 *                          phrasing silently contradicts.
 *     - SECTIONS         — the two topics the policy mandates are present:
 *                          the dual-use functionality and the intended
 *                          legitimate use.
 *
 *   Prose quality (junior-dev sentences, no unprovable absolutes) is owned by
 *   the writing-disclosures skill; this check holds the mechanically provable
 *   floor. Repos with no dual-use declaration pass untouched. STRICT: any
 *   finding exits 1. Pure classification (`auditDisclosureContent`) is
 *   exported for unit tests.
 *
 *   Usage: node scripts/fleet/check/disclosure-content-is-grounded.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { declaredRoots } from './dual-use-declarations-are-complete.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface DisclosureManifestShape {
  bin?: Record<string, string> | string | undefined
  dependencies?: Record<string, string> | undefined
  name?: string | undefined
  optionalDependencies?: Record<string, string> | undefined
  repository?: { url?: string | undefined } | string | undefined
}

/**
 * The https form of a manifest repository field, or undefined when the
 * manifest has none. Accepts the string and object forms and the
 * `git+https://…//.git` decorations npm allows.
 */
export function repositoryHttpsUrl(
  manifest: DisclosureManifestShape,
): string | undefined {
  const raw =
    typeof manifest.repository === 'string'
      ? manifest.repository
      : manifest.repository?.url
  if (!raw) {
    return undefined
  }
  return raw
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
}

/**
 * Audit one DISCLOSURE against the manifest that declares it. Returns the
 * issue list — empty when every mechanically provable claim is grounded.
 */
export function auditDisclosureContent(
  manifest: DisclosureManifestShape,
  disclosure: string,
): string[] {
  const issues: string[] = []
  const binKeys =
    typeof manifest.bin === 'string'
      ? [manifest.name ?? '']
      : Object.keys(manifest.bin ?? {})
  for (let i = 0, { length } = binKeys; i < length; i += 1) {
    const key = binKeys[i]
    if (key && !disclosure.includes(key)) {
      issues.push(
        `BIN-GROUNDED — the manifest ships the \`${key}\` executable and ` +
          `the DISCLOSURE never names it; every installed command must be ` +
          `disclosed.`,
      )
    }
  }
  if (manifest.name && !disclosure.includes(manifest.name)) {
    issues.push(
      `NAME-GROUNDED — the DISCLOSURE never names the package ` +
        `(\`${manifest.name}\`); the file must describe THIS package.`,
    )
  }
  const repoUrl = repositoryHttpsUrl(manifest)
  if (repoUrl && !disclosure.includes(repoUrl)) {
    issues.push(
      `REPO-GROUNDED — the DISCLOSURE must carry the source URL ` +
        `(${repoUrl}) so reviewers can verify every claim against public ` +
        `source.`,
    )
  }
  const deps = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  }
  const sentryDeps = Object.keys(deps).filter(name => /sentry/i.test(name))
  if (sentryDeps.length && !/sentry/i.test(disclosure)) {
    issues.push(
      `SENTRY-GROUNDED — the manifest depends on ${sentryDeps.join(', ')} ` +
        `and the DISCLOSURE never mentions the error/crash reporting that ` +
        `implies; telemetry is network transmission and must be disclosed.`,
    )
  }
  if (!/dual-use/i.test(disclosure)) {
    issues.push(
      `SECTIONS — the DISCLOSURE never states the dual-use content policy ` +
        `class the manifest declares.`,
    )
  }
  if (!/intended legitimate use/i.test(disclosure)) {
    issues.push(
      `SECTIONS — the DISCLOSURE has no "Intended legitimate use" section; ` +
        `the policy mandates describing the legitimate use, not only the ` +
        `dual-use behavior.`,
    )
  }
  return issues
}

export async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet')
  const roots = declaredRoots(REPO_ROOT)
  const findings: Array<{ root: string; issues: string[] }> = []
  for (let i = 0, { length } = roots; i < length; i += 1) {
    const root = roots[i]
    if (!root) {
      continue
    }
    const manifestPath = path.join(REPO_ROOT, root, 'package.json')
    const disclosurePath = path.join(REPO_ROOT, root, 'DISCLOSURE')
    if (!existsSync(manifestPath) || !existsSync(disclosurePath)) {
      // Presence gaps belong to dual-use-declarations-are-complete.mts.
      continue
    }
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as DisclosureManifestShape
    const disclosure = readFileSync(disclosurePath, 'utf8')
    const issues = auditDisclosureContent(manifest, disclosure)
    if (issues.length) {
      findings.push({ root, issues })
    }
  }
  if (!findings.length) {
    if (!quiet) {
      logger.success(
        '[disclosure-content-is-grounded] every DISCLOSURE states only what ' +
          'its manifest can prove.',
      )
    }
    return 0
  }
  logger.fail(
    `[disclosure-content-is-grounded] ${findings.length} DISCLOSURE file(s) ` +
      'carry claims the manifest cannot back:',
  )
  logger.group()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]
    if (!finding) {
      continue
    }
    logger.fail(finding.root)
    logger.group()
    for (let j = 0, jLength = finding.issues.length; j < jLength; j += 1) {
      logger.fail(finding.issues[j] ?? '')
    }
    logger.groupEnd()
  }
  logger.groupEnd()
  logger.log(
    'Fix: rewrite the DISCLOSURE with the writing-disclosures skill — every ' +
      'sentence needs a receipt in the tree, every executable and network ' +
      'destination must be named, and unprovable absolutes stay out.',
  )
  process.exitCode = 1
  return 1
}

if (isMainModule(import.meta.url)) {
  void main()
}
