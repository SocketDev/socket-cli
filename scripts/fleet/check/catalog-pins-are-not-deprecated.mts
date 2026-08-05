#!/usr/bin/env node
/*
 * @file Release/CI gate: no `catalog:` pin resolves to a version npm marks
 *   DEPRECATED. This is the belt to the update tooling's braces — the
 *   catalog-drift fixer routes its choice through `chooseNpmUpgradeCandidate`
 *   (scripts/fleet/lib/npm-version-policy.mts), which refuses a deprecated
 *   version outright; this gate stops one landing by any OTHER route: a hand
 *   edit, a cascade that splices an older canonical value forward, a merge, an
 *   upstream that deprecates a version the fleet already pinned.
 *
 *   The shape it exists for: nock 15.0.0 was published by accident and npm
 *   marks it "released accidentally and is unstable", while the `latest`
 *   dist-tag still points at the 14.x line. A pin that lands on it installs a
 *   package the publisher has disowned, fleet-wide, with nothing but a comment
 *   asking people not to.
 *
 *   NETWORK DISCIPLINE. Offline-safe, never fails closed on connectivity. No
 *   network, a timeout, a 4xx/5xx, or an unparseable body all yield UNVERIFIED
 *   — reported as a notice, exit 0. Only a version the registry AFFIRMATIVELY
 *   marks deprecated fails, and the failure quotes the upstream's own message.
 *   Registered as a `releaseStep`, so the interactive `check --all` loop stays
 *   offline while CI and the pre-push gate carry it.
 *
 *   Exit: 0 — every pin clean, or unverifiable; 1 — a pin is deprecated.
 *   Usage: node scripts/fleet/check/catalog-pins-are-not-deprecated.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { httpJson } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { pEach } from '@socketsecurity/lib-stable/promises/iterate'
import { isValidVersion } from '@socketsecurity/lib-stable/versions/parse'

import { NPM_REGISTRY_URL } from '../constants/npm-registry.mts'
import { summarizeDeprecation } from '../lib/npm-version-policy.mts'
import { parseCatalogBlock } from '../lib/workspace-yaml.mts'
import {
  FLEET_CATALOG_YAML,
  PNPM_WORKSPACE_YAML,
  REPO_ROOT,
} from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// One version document is a few KB, but a fleet catalog carries well over a
// hundred pins — probe them a batch at a time so the gate finishes in seconds
// without opening a hundred sockets at the registry.
const PROBE_CONCURRENCY = 8

// Bounded per-request timeout: a slow registry downgrades a pin to UNVERIFIED
// rather than stalling the release gate.
const FETCH_TIMEOUT_MS = 10_000

/**
 * One catalog entry resolved to the package + version actually installed. An
 * alias entry (`'x-stable': 'npm:x@1.2.3'`) resolves to the ALIASED package,
 * which is the artifact npm would mark deprecated.
 */
export interface CatalogPin {
  readonly catalogName: string
  readonly name: string
  readonly source: string
  readonly version: string
}

/**
 * One pin's verdict. `unverified` carries its reason so a skip is never silent
 * — an operator can tell "npm says this is fine" from "the registry never
 * answered".
 */
export interface CatalogPinVerdict {
  readonly deprecation?: string | undefined
  readonly pin: CatalogPin
  readonly reason?: string | undefined
  readonly verdict: 'clean' | 'deprecated' | 'unverified'
}

/**
 * The subset of npm's single-version document this gate reads.
 */
export interface RawNpmVersionDocument {
  // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
  readonly deprecated?: unknown | undefined
}

/**
 * Resolve one `catalog:` entry to the package + version it installs, or
 * `undefined` when the entry is not an exact registry pin (a `workspace:*`
 * spec, a range, a `link:`/`file:` spec) — those have no registry version to
 * judge.
 *
 * Handles both entry shapes: a bare version (`'nock': 14.0.16`) and the alias
 * form every `-stable` entry uses (`'npm:@scope/pkg@6.5.1'`).
 */
export function resolveCatalogPin(
  catalogName: string,
  spec: string,
  source: string,
): CatalogPin | undefined {
  if (isValidVersion(spec)) {
    return { catalogName, name: catalogName, source, version: spec }
  }
  if (!spec.startsWith('npm:')) {
    return undefined
  }
  const rest = spec.slice('npm:'.length)
  const at = rest.lastIndexOf('@')
  if (at <= 0) {
    return undefined
  }
  const name = rest.slice(0, at)
  const version = rest.slice(at + 1)
  return isValidVersion(version)
    ? { catalogName, name, source, version }
    : undefined
}

/**
 * Every exact registry pin in the `catalog:` blocks of the given workspace
 * files, deduplicated by `<name>@<version>` (the live workspace and the
 * fleet-canonical catalog overlap heavily). Missing files are skipped — a
 * member repo without a fleet catalog is a vacuous pass, not an error.
 */
export function collectCatalogPins(files: readonly string[]): CatalogPin[] {
  const seen = new Set<string>()
  const pins: CatalogPin[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (!existsSync(file)) {
      continue
    }
    let content: string
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const source = path.relative(REPO_ROOT, file)
    const entries = Object.entries(parseCatalogBlock(content))
    for (let j = 0, { length: jl } = entries; j < jl; j += 1) {
      const [catalogName, spec] = entries[j]!
      const pin = resolveCatalogPin(catalogName, spec, source)
      if (!pin) {
        continue
      }
      const key = `${pin.name}@${pin.version}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      pins.push(pin)
    }
  }
  return pins
}

/**
 * Judge one pin against npm's version document. Pure — the whole verdict rule
 * in one testable function.
 *
 * An absent document means the registry never answered (or the version is not
 * there to read), which is UNVERIFIED, never a pass and never a failure. A
 * non-empty `deprecated` string is the only way to fail.
 */
export function judgeCatalogPinDeprecation(
  pin: CatalogPin,
  doc: RawNpmVersionDocument | undefined,
): CatalogPinVerdict {
  if (!doc) {
    return {
      pin,
      reason: 'the registry returned no document for this version',
      verdict: 'unverified',
    }
  }
  const { deprecated } = doc
  if (typeof deprecated === 'string' && deprecated.trim() !== '') {
    return {
      deprecation: summarizeDeprecation(deprecated),
      pin,
      verdict: 'deprecated',
    }
  }
  return { pin, verdict: 'clean' }
}

/**
 * Read one `<name>@<version>` document from the canonical registry. Fail-open:
 * any failure yields `undefined`, which `judgeCatalogPinDeprecation` reports
 * as UNVERIFIED.
 */
export async function fetchNpmVersionDocument(
  name: string,
  version: string,
): Promise<RawNpmVersionDocument | undefined> {
  const encoded = encodeURIComponent(name).replaceAll('%40', '@')
  const url = `${NPM_REGISTRY_URL}/${encoded}/${encodeURIComponent(version)}`
  try {
    return await httpJson<RawNpmVersionDocument>(url, {
      headers: { accept: 'application/json' },
      timeout: FETCH_TIMEOUT_MS,
    })
  } catch {
    return undefined
  }
}

/**
 * Probe every pin, batched. Injectable fetch seam so the unit tests drive the
 * whole flow with canned documents and no network.
 */
export async function probeCatalogPins(
  pins: readonly CatalogPin[],
  fetchDocument: (
    name: string,
    version: string,
  ) => Promise<RawNpmVersionDocument | undefined> = fetchNpmVersionDocument,
): Promise<CatalogPinVerdict[]> {
  const verdicts: CatalogPinVerdict[] = []
  await pEach(
    [...pins],
    async pin => {
      verdicts.push(
        judgeCatalogPinDeprecation(
          pin,
          await fetchDocument(pin.name, pin.version),
        ),
      )
    },
    PROBE_CONCURRENCY,
  )
  return verdicts
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const pins = collectCatalogPins([PNPM_WORKSPACE_YAML, FLEET_CATALOG_YAML])
  if (pins.length === 0) {
    if (!quiet) {
      logger.log(
        'catalog-pins-are-not-deprecated: no exact catalog pins to check.',
      )
    }
    process.exitCode = 0
    return
  }
  const verdicts = await probeCatalogPins(pins)
  const deprecated = verdicts.filter(v => v.verdict === 'deprecated')
  const unverified = verdicts.filter(v => v.verdict === 'unverified')
  if (unverified.length) {
    logger.warn(
      `catalog-pins-are-not-deprecated: UNVERIFIED ${unverified.length} pin(s) — the registry did not answer for them, so they were NOT checked this run.`,
    )
    for (let i = 0, { length } = unverified; i < length; i += 1) {
      const v = unverified[i]!
      logger.warn(
        `  ${v.pin.name}@${v.pin.version} (${v.pin.source}) — ${v.reason ?? 'no evidence'}`,
      )
    }
  }
  if (deprecated.length === 0) {
    if (!quiet) {
      logger.log(
        `catalog-pins-are-not-deprecated: ${verdicts.length - unverified.length} pin(s) confirmed live on the registry.`,
      )
    }
    process.exitCode = 0
    return
  }
  logger.fail(
    `catalog-pins-are-not-deprecated: ${deprecated.length} catalog pin(s) resolve to a DEPRECATED version:`,
  )
  for (let i = 0, { length } = deprecated; i < length; i += 1) {
    const v = deprecated[i]!
    logger.fail(
      `  ${v.pin.catalogName} → ${v.pin.name}@${v.pin.version} (${v.pin.source}): ${v.deprecation ?? 'deprecated'}`,
    )
  }
  logger.fail(
    '  What:  a `catalog:` pin installs a version the publisher has deprecated.\n' +
      '  Where: the catalog entries above.\n' +
      '  Saw:   npm marks that exact version deprecated; wanted: every pin on a\n' +
      "         version the publisher still stands behind (the `latest` dist-tag's\n" +
      '         line is the safe default).\n' +
      '  Fix:   move the pin to a non-deprecated version — `npm view <name> dist-tags`\n' +
      '         names the current one — in pnpm-workspace.yaml AND\n' +
      '         .config/fleet/pnpm-workspace.fleet.yaml, then `pnpm install`. If the\n' +
      '         update tooling proposed it, fix the policy in\n' +
      '         scripts/fleet/lib/npm-version-policy.mts rather than hand-holding\n' +
      '         the pin.',
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks that no catalog: pin resolves to a version npm marks deprecated',
  help: `Usage: node scripts/fleet/check/catalog-pins-are-not-deprecated.mts [--quiet]

  --quiet  suppress the success line`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
