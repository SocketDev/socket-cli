#!/usr/bin/env node
/*
 * @file CI gate: the cascaded prebake manifest (.config/fleet/docker-prebakes.json)
 *   is internally consistent. Validates the DATA only (it runs in every member,
 *   which carries the cascaded JSON but NOT the wheelhouse-only Dockerfiles):
 *
 *     - registry + required per-layer fields (name/from/installs/purpose/status);
 *     - every `from` resolves to another layer OR an external `<image>:<tag>`;
 *     - no dependency cycle;
 *     - layers are TOOLCHAIN-named, never OUTPUT-named (no `elf`/`macho`/`pe`/
 *       `wasm` segment — those are build outputs, not bases).
 *
 *   Dockerfile existence + the actual build are validated wheelhouse-side by
 *   scripts/repo/build-prebakes.mts (the recipes aren't cascaded).
 *
 *   Fails-open (exit 0) when the manifest is absent (a repo that opted out).
 *   Exit codes: 0 — valid / absent; 1 — a manifest problem (printed).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// An external base ref like `ubuntu:24.04` or `ghcr.io/org/img:tag`. Single
// character class (no nested quantifier) so the match stays linear.
const EXTERNAL_FROM = /^[a-z0-9][a-z0-9._/-]*:[a-z0-9._-]+$/

// Output formats that must never name a base (bases are named by toolchain).
const OUTPUT_SEGMENTS = new Set(['elf', 'macho', 'pe', 'wasm'])

interface PrebakeEntry {
  readonly from?: unknown | undefined
  readonly installs?: unknown | undefined
  readonly name?: unknown | undefined
  readonly purpose?: unknown | undefined
  readonly status?: unknown | undefined
}

interface PrebakeManifest {
  readonly prebakes?: unknown | undefined
  readonly registry?: unknown | undefined
}

export function collectProblems(manifest: PrebakeManifest): readonly string[] {
  const problems: string[] = []
  if (typeof manifest.registry !== 'string' || !manifest.registry) {
    problems.push('missing registry')
  }
  const prebakes = Array.isArray(manifest.prebakes) ? manifest.prebakes : []
  if (!prebakes.length) {
    problems.push('no prebakes listed')
    return problems
  }
  const names = new Set<string>()
  for (const raw of prebakes) {
    const entry = raw as PrebakeEntry
    const name = typeof entry.name === 'string' ? entry.name : ''
    if (!name) {
      problems.push('a prebake has no name')
      continue
    }
    names.add(name)
    if (typeof entry.from !== 'string' || !entry.from) {
      problems.push(`"${name}" has no from`)
    }
    if (!Array.isArray(entry.installs)) {
      problems.push(`"${name}" installs must be an array`)
    }
    if (typeof entry.purpose !== 'string' || !entry.purpose) {
      problems.push(`"${name}" has no purpose`)
    }
    if (typeof entry.status !== 'string') {
      problems.push(`"${name}" has no status`)
    }
    for (const seg of name.split('-')) {
      if (OUTPUT_SEGMENTS.has(seg)) {
        problems.push(
          `"${name}" is output-named ("${seg}") — name bases by toolchain, not output`,
        )
      }
    }
  }
  // from-chain resolves + no cycle.
  const byName = new Map(
    prebakes.map(raw => [
      (raw as PrebakeEntry).name as string,
      raw as PrebakeEntry,
    ]),
  )
  const state = new Map<string, number>()
  function walk(name: string): boolean {
    const seen = state.get(name)
    if (seen === 2) {
      return true
    }
    if (seen === 1) {
      problems.push(`dependency cycle through "${name}"`)
      return false
    }
    state.set(name, 1)
    const entry = byName.get(name)!
    const from = typeof entry.from === 'string' ? entry.from : ''
    if (from && byName.has(from)) {
      if (!walk(from)) {
        return false
      }
    } else if (from && !EXTERNAL_FROM.test(from)) {
      problems.push(
        `"${name}" from="${from}" is neither a known layer nor an external <image>:<tag>`,
      )
    }
    state.set(name, 2)
    return true
  }
  for (const name of names) {
    walk(name)
  }
  return problems
}

function main(): void {
  const manifestPath = path.join(
    REPO_ROOT,
    '.config/fleet/docker-prebakes.json',
  )
  if (!existsSync(manifestPath)) {
    return
  }
  let manifest: PrebakeManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PrebakeManifest
  } catch (e) {
    logger.fail(`docker-prebakes.json is not valid JSON: ${errorMessage(e)}`)
    process.exitCode = 1
    return
  }
  const problems = collectProblems(manifest)
  if (problems.length) {
    logger.fail('docker-prebakes.json problems:')
    logger.group()
    for (const p of problems) {
      logger.error(p)
    }
    logger.groupEnd()
    process.exitCode = 1
    return
  }
  if (!process.argv.includes('--quiet')) {
    logger.success('docker-prebakes.json is valid')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
