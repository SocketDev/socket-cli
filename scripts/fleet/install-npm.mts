#!/usr/bin/env node
/*
 * @file Install a pinned, SRI-verified npm WITHOUT self-update.
 *   Models npmjs.com/install.sh (download the registry tarball, then drive the
 *   DOWNLOADED `node bin/npm-cli.js install -gf` — never `npm install -g npm`,
 *   so npm never updates itself) but adds the fleet supply-chain gate:
 *
 *   1. node first — npm rides on node; error early if node is absent.
 *   2. PINNED version + STORED integrity — read from the canonical
 *      scripts/fleet/setup/external-tools.json `tools.npm` (version +
 *      `sha512-…` integrity, captured once at pin time + checked against the
 *      registry dist.integrity). The download is verified against that stored
 *      value via the socket-lib downloadBinary helper (fails on mismatch).
 *   3. SOAK honored — a version inside the 7-day minimumReleaseAge window is
 *      refused unless a dated `soakBypass` (auto-disarms at `removable`) still
 *      covers it OR `--soak-bypass` is passed (the CLI form of the soakBypass
 *      annotation). Freshpub npm typosquats are the threat the soak targets; a
 *      publisher-trusted bump rides the bypass.
 *      Bootstrap order: node (.node-version) → npm (this script) → the Socket
 *      packages — all downloaded + installed through the socket-lib helpers.
 *      Usage: node scripts/fleet/install-npm.mts [--force] [--quiet]
 *      [--soak-bypass]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { extractTarGz } from '@socketsecurity/lib-stable/archives/tar'
import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

// The canonical fleet tool list (node → npm → Socket pkgs bootstrap). The pin +
// its stored SRI live under tools.npm.
const SETUP_EXTERNAL_TOOLS = path.join(
  REPO_ROOT,
  'scripts',
  'fleet',
  'setup',
  'external-tools.json',
)

const NPM_REGISTRY = 'https://registry.npmjs.org'

interface SoakBypass {
  readonly version: string
  readonly published: string
  readonly removable: string
}

interface NpmToolEntry {
  readonly version: string
  readonly integrity: string
  readonly soakBypass?: SoakBypass | undefined
}

// Read tools.npm from the canonical setup external-tools.json. Throws with a
// What/Where/Saw/Fix message when the pin is missing or malformed — the install
// can't proceed without a version + a stored integrity to verify against.
export function readNpmPin(
  toolsPath: string = SETUP_EXTERNAL_TOOLS,
): NpmToolEntry {
  if (!existsSync(toolsPath)) {
    throw new Error(
      `npm pin source not found.\n` +
        `  Where: ${toolsPath}\n` +
        `  Fix: run from a fleet checkout that has scripts/fleet/setup/external-tools.json.`,
    )
  }
  const parsed = JSON.parse(readFileSync(toolsPath, 'utf8')) as {
    tools?: Record<string, NpmToolEntry> | undefined
  }
  const entry = parsed.tools?.['npm']
  if (!entry?.version || !entry.integrity) {
    throw new Error(
      `tools.npm is missing version + integrity.\n` +
        `  Where: ${toolsPath} -> tools.npm\n` +
        `  Saw: ${entry ? JSON.stringify(entry) : '(no tools.npm entry)'}\n` +
        `  Fix: pin npm with { version, integrity: "sha512-…" } (capture the integrity from ${NPM_REGISTRY}/npm/<version> dist.integrity).`,
    )
  }
  if (!entry.integrity.startsWith('sha512-')) {
    throw new Error(
      `tools.npm.integrity must be a sha512 SRI string.\n` +
        `  Where: ${toolsPath} -> tools.npm.integrity\n` +
        `  Saw: ${entry.integrity}\n` +
        `  Fix: use the registry dist.integrity form, e.g. "sha512-<base64>".`,
    )
  }
  return entry
}

// True when the pin is still inside its 7-day soak and no dated soakBypass
// covers it. `today` is injectable for tests; production reads the clock.
export function isUnderSoak(entry: NpmToolEntry, today: string): boolean {
  const bypass = entry.soakBypass
  if (bypass && bypass.version === entry.version && today < bypass.removable) {
    // A dated bypass still covers this exact pin — soak waived.
    return false
  }
  // No active bypass. The pin is "under soak" only if a bypass EXISTS and has
  // expired (a freshpub whose window we must re-confirm) — a pin with no
  // soakBypass at all is treated as past-soak (the routine steady state).
  return bypass !== undefined && today >= bypass.removable
}

export async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      force: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      'soak-bypass': { type: 'boolean', default: false },
    },
    strict: false,
  })
  const quiet = Boolean(values['quiet'])

  // 1. node first — npm can't install without it.
  const nodeBin = process.execPath
  if (!nodeBin || !existsSync(nodeBin)) {
    throw new Error(
      `node is required to install npm.\n` +
        `  Fix: install Node (see .node-version) first, then re-run.`,
    )
  }

  const entry = readNpmPin()
  const { integrity, version } = entry

  // 2. soak gate (code is law) — refuse an expired-bypass pin unless waived.
  const today = new Date().toISOString().slice(0, 10)
  if (isUnderSoak(entry, today) && !values['soak-bypass']) {
    throw new Error(
      `npm@${version} is inside the minimumReleaseAge soak and its soakBypass ` +
        `has expired.\n` +
        `  Where: scripts/fleet/setup/external-tools.json -> tools.npm.soakBypass\n` +
        `  Fix: refresh the soakBypass (published/removable) for the current ` +
        `pin, or pass --soak-bypass to waive the soak for this install.`,
    )
  }

  // 3. download the EXACT pinned tarball + verify the stored SRI integrity.
  const url = `${NPM_REGISTRY}/npm/-/npm-${version}.tgz`
  if (!quiet) {
    logger.info(`Downloading npm@${version} (SRI-verified) from ${url}`)
  }
  const { binaryPath: tarball } = await downloadBinary({
    url,
    name: `npm-${version}.tgz`,
    integrity,
    force: Boolean(values['force']),
    quiet,
  })

  // 4. extract + drive the DOWNLOADED npm-cli.js to install itself globally —
  // never `npm install -g npm`, so the currently-installed npm is never the
  // thing performing its own update (the no-self-update property).
  const extractDir = path.join(path.dirname(tarball), `npm-${version}-unpacked`)
  if (existsSync(extractDir)) {
    await safeDelete(extractDir)
  }
  await extractTarGz(tarball, extractDir)
  const npmCli = path.join(extractDir, 'package', 'bin', 'npm-cli.js')
  if (!existsSync(npmCli)) {
    throw new Error(
      `extracted npm tarball is missing bin/npm-cli.js.\n` +
        `  Where: ${npmCli}\n` +
        `  Fix: the tarball may be corrupt despite the SRI match — re-run with --force.`,
    )
  }
  if (!quiet) {
    logger.info(`Installing npm@${version} via the downloaded npm-cli.js`)
  }
  // -g global, -f force over the bundled npm. Run the DOWNLOADED cli against the
  // tarball — no dependency on the resident npm. Array-arg spawnSync (no shell)
  // per the fleet prefer-spawn rule.
  const result = spawnSync(nodeBin, [npmCli, 'install', '-gf', tarball], {
    stdio: quiet ? 'ignore' : 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(
      `the downloaded npm-cli.js failed to install npm@${version}.\n` +
        `  Where: ${npmCli} install -gf ${tarball}\n` +
        `  Saw: exit status ${result.status}\n` +
        `  Fix: re-run with --force; if it persists the global prefix may not be writable.`,
    )
  }
  await safeDelete(extractDir)
  if (!quiet) {
    logger.success(`Installed npm@${version} (no self-update path).`)
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
