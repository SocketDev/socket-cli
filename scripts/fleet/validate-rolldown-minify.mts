#!/usr/bin/env node
/**
 * @file Validates that every rolldown build config keeps `output.minify` false
 *   by default. Minification breaks ESM/CJS interop and makes debugging harder,
 *   so the default (non-publish) build must emit readable output. Repos may
 *   still opt into minification for a publish artifact behind an env gate (e.g.
 *   `MINIFY=1` on a `*:prepublish` script); this validator only asserts the
 *   default, un-gated build stays unminified — it loads each config with the
 *   minify env var explicitly cleared. Config discovery (first match wins, in
 *   order):
 *
 *   1. The rolldown-validate manifest — `.config/repo/rolldown-validate.json`,
 *      then legacy top-level `.config/rolldown-validate.json` — an optional `{
 *      "configs": [...] }` array of repo-root-relative config paths. Repos
 *      whose configs are nested (monorepo packages) or non-standard-named list
 *      them here. Each listed path is validated.
 *   2. `.config/repo/rolldown.config.mts`, then legacy
 *      `.config/rolldown.config.mts`, then root `rolldown.config.mts` — the
 *      single-config fallback for simple single-package repos. If none resolves
 *      the repo has no rolldown build and the check is a no-op pass. Export
 *      shapes tolerated per config: a `default` export (single options object
 *      or array), named `buildConfig` / `configs` exports (object or array),
 *      and a named `getRolldownConfig(entry, out)` factory (probed with
 *      placeholder args). All discovered `output.minify` flags must be false or
 *      unset.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

const rootPath = REPO_ROOT

interface MinifyViolation {
  config: string
  value: unknown
  message: string
  location: string
}

// Read every `output.minify` reachable off a loaded config module, across the
// export shapes the fleet uses: `default` / named `buildConfig` / named
// `configs` (each a single options object or an array of them, each with a
// single `output` or array of outputs), plus a named
// `getRolldownConfig(entry, out)` factory probed with placeholder args.
export function collectMinifyFlags(
  imported: Record<string, unknown>,
): unknown[] {
  const flags: unknown[] = []
  const pushOutputs = (cfg: unknown): void => {
    const output = (cfg as { output?: unknown | undefined } | undefined)?.output
    const outputs = Array.isArray(output) ? output : [output]
    for (const out of outputs) {
      flags.push((out as { minify?: unknown | undefined } | undefined)?.minify)
    }
  }
  const pushConfigs = (value: unknown): void => {
    if (value === undefined) {
      return
    }
    for (const cfg of Array.isArray(value) ? value : [value]) {
      pushOutputs(cfg)
    }
  }

  pushConfigs(imported['default'])
  pushConfigs(imported['buildConfig'])
  pushConfigs(imported['configs'])

  const factory = imported['getRolldownConfig']
  if (typeof factory === 'function') {
    pushOutputs(
      (factory as (a: string, b: string) => unknown)('entry.js', 'out.js'),
    )
  }

  return flags
}

// All rolldown config paths to validate, absolute. The manifest list wins;
// otherwise the single repo-owned config under `.config/repo/`, then the
// legacy top-level `.config/` location, then a root config.
export function findRolldownConfigs(): string[] {
  const manifest = readConfigManifest()
  if (manifest) {
    return manifest
      .map(rel => path.resolve(rootPath, rel))
      .filter(p => existsSync(p))
  }
  const candidates = [
    path.join(rootPath, '.config', 'repo', 'rolldown.config.mts'),
    path.join(rootPath, '.config', 'rolldown.config.mts'),
    path.join(rootPath, 'rolldown.config.mts'),
  ]
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]!
    if (existsSync(candidate)) {
      return [candidate]
    }
  }
  return []
}

// Repo-root-relative config paths declared in the rolldown-validate manifest,
// or undefined when the file is absent / malformed (caller falls back to the
// single-config auto-discovery below). The manifest is repo-owned: prefer the
// `.config/repo/` location, fall back to the legacy top-level `.config/` path.
export function readConfigManifest(): string[] | undefined {
  const manifestPath = [
    path.join(rootPath, '.config', 'repo', 'rolldown-validate.json'),
    path.join(rootPath, '.config', 'rolldown-validate.json'),
  ].find(p => existsSync(p))
  if (!manifestPath) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    logger.error(
      `Failed to parse ${path.relative(rootPath, manifestPath)}: ${e instanceof Error ? e.message : String(e)}`,
    )
    process.exitCode = 1
    return undefined
  }
  const configs = (parsed as { configs?: unknown | undefined } | undefined)
    ?.configs
  if (!Array.isArray(configs) || configs.some(c => typeof c !== 'string')) {
    logger.error(
      `${path.relative(rootPath, manifestPath)} must have a "configs" array of string paths`,
    )
    process.exitCode = 1
    return undefined
  }
  return configs as string[]
}

/**
 * Validate every discovered rolldown config's default (MINIFY-unset) build has
 * minify false. Clears the `MINIFY` env gate before importing so a publish-only
 * minify path doesn't trip the check.
 */
export async function validateRolldownMinify(): Promise<MinifyViolation[]> {
  const configPaths = findRolldownConfigs()
  if (configPaths.length === 0) {
    // No rolldown build in this repo — nothing to validate.
    return []
  }

  // Clear the publish-time gate so we evaluate the default build path. Configs
  // read `process.env.MINIFY` at module-evaluation time, so this MUST happen
  // before the imports below — hence the dynamic import (a static import would
  // capture MINIFY at load time, defeating the clear).
  delete process.env['MINIFY']

  const violations: MinifyViolation[] = []
  for (const configPath of configPaths) {
    try {
      // oxlint-disable-next-line socket/no-dynamic-import-outside-bundle -- the config must load AFTER the MINIFY env gate is cleared (see above); a static top-level import would evaluate it too early.
      const imported = (await import(configPath)) as Record<string, unknown>
      const flags = collectMinifyFlags(imported)
      for (let i = 0, { length } = flags; i < length; i += 1) {
        const value = flags[i]
        if (value !== false && value !== undefined) {
          violations.push({
            config: `output[${i}]`,
            value,
            message: 'output.minify must be false (or unset) by default',
            location: configPath,
          })
        }
      }
    } catch (e) {
      logger.error(
        `Failed to load rolldown config ${configPath}: ${e instanceof Error ? e.message : String(e)}`,
      )
      process.exitCode = 1
      return []
    }
  }
  return violations
}

async function main(): Promise<void> {
  const violations = await validateRolldownMinify()

  if (violations.length === 0) {
    logger.success('rolldown minify validation passed')
    process.exitCode = 0
    return
  }

  logger.fail('rolldown minify validation failed')
  logger.error('')

  for (let i = 0, { length } = violations; i < length; i += 1) {
    const violation = violations[i]!
    logger.error(`  ${violation.message}`)
    logger.error(`  Found: minify: ${violation.value}`)
    logger.error('  Expected: minify: false')
    logger.error(`  Location: ${violation.location}`)
    logger.error('')
  }

  logger.error(
    'Minification breaks ESM/CJS interop and makes debugging harder.',
  )
  logger.error('')

  process.exitCode = 1
}

main().catch((e: unknown) => {
  logger.error('Validation failed:', e)
  process.exitCode = 1
})
