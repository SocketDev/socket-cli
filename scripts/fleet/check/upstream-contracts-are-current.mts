/**
 * @file Fleet-canonical CHECK over each repo's repo-local
 *   `scripts/repo/upstream-contracts.mts` DATA: every pinned upstream reference
 *   still satisfies its contract — the materialized submodule's HEAD matches
 *   `contract.revision`, and the contract's required in-submodule paths
 *   (`crate`/`addonCrate`) + repo-root `fixture` exist. Same split as the other
 *   fleet checks: the CHECK is cascaded, the CONTRACT is repo-local (a repo
 *   declares what it pins). The contract is tracked repo DATA under
 *   scripts/repo/ — never inside the git-ignored `upstream/` tree. No-ops when
 *   the repo has no `scripts/repo/upstream-contracts.mts` (most repos).
 *   FAIL-OPEN when an `upstream/<name>` checkout is absent or not a git tree —
 *   `upstream/` is git-ignored and materialized on demand, so a
 *   fresh/shallow/offline checkout that hasn't materialized it must not red;
 *   drift is only verifiable when the tree is present. A materialized tree
 *   whose HEAD ≠ the pin, or a missing required path/fixture, is a hard fail.
 *   See docs/agents.md/fleet/upstream-references.md.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface UpstreamContract {
  name: string
  revision: string
  crate?: string | undefined
  addonCrate?: string | undefined
  fixture?: string | undefined
}

export interface ContractCheckDeps {
  // Absolute-path existence probe (injected for tests).
  exists: (p: string) => boolean
  // Materialized submodule HEAD by contract name; undefined = not materialized
  // / not a git tree (→ skip the drift comparison, fail-open).
  heads: Readonly<Record<string, string | undefined>>
}

/**
 * Pure contract validation: returns the human-readable errors for `contracts`
 * rooted at `root`. HEADs are pre-resolved (async git lives in `runCheck`) so
 * this stays pure + unit-testable offline. A missing upstream checkout (no HEAD
 * entry / undefined) is SKIPPED (fail-open); a present HEAD that disagrees with
 * the pin, or a missing required path/fixture, is an error.
 */
export function collectContractErrors(
  contracts: readonly UpstreamContract[],
  root: string,
  deps: ContractCheckDeps,
): string[] {
  const errors: string[] = []
  for (let i = 0, { length } = contracts; i < length; i += 1) {
    const c = contracts[i]!
    const upstreamRoot = path.join(root, 'upstream', c.name)
    if (!deps.exists(upstreamRoot)) {
      // Not materialized — can't verify (git-ignored, on-demand). Fail-open.
      continue
    }
    const head = deps.heads[c.name]
    if (head && head !== c.revision) {
      errors.push(`${c.name}: submodule HEAD ${head} != pinned ${c.revision}`)
    }
    for (const rel of [c.crate, c.addonCrate]) {
      if (rel && !deps.exists(path.join(upstreamRoot, rel))) {
        errors.push(`${c.name}: missing required path ${rel}`)
      }
    }
    if (c.fixture && !deps.exists(path.join(root, c.fixture))) {
      errors.push(`${c.name}: missing fixture ${c.fixture}`)
    }
  }
  return errors
}

async function gitHead(dir: string): Promise<string | undefined> {
  try {
    const r = await spawn('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      stdioString: true,
    })
    return r.code === 0 ? String(r.stdout ?? '').trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * Locate `<repoRoot>/scripts/repo/upstream-contracts.mts`, dynamic-import its
 * `UPSTREAM_CONTRACTS`, resolve each materialized submodule's HEAD, and
 * validate. Returns the exit code (0 = no contracts file / all current, 1 =
 * drift or a malformed contracts file).
 */
export async function runCheck(repoRoot: string): Promise<number> {
  const contractsPath = path.join(
    repoRoot,
    'scripts',
    'repo',
    'upstream-contracts.mts',
  )
  if (!existsSync(contractsPath)) {
    return 0
  }
  let contracts: readonly UpstreamContract[]
  try {
    const mod = (await import(pathToFileURL(contractsPath).href)) as {
      UPSTREAM_CONTRACTS?: readonly UpstreamContract[] | undefined
    }
    if (!Array.isArray(mod.UPSTREAM_CONTRACTS)) {
      logger.fail(
        `[upstream-contracts-are-current] ${contractsPath} exports no UPSTREAM_CONTRACTS array.`,
      )
      return 1
    }
    contracts = mod.UPSTREAM_CONTRACTS
  } catch (e) {
    logger.fail(
      `[upstream-contracts-are-current] cannot load ${contractsPath}: ${e}`,
    )
    return 1
  }
  const heads: Record<string, string | undefined> = Object.create(null)
  for (let i = 0, { length } = contracts; i < length; i += 1) {
    const c = contracts[i]!
    const dir = path.join(repoRoot, 'upstream', c.name)
    if (existsSync(dir)) {
      heads[c.name] = await gitHead(dir)
    }
  }
  const errors = collectContractErrors(contracts, repoRoot, {
    exists: existsSync,
    heads,
  })
  if (errors.length === 0) {
    return 0
  }
  logger.fail(
    [
      '[upstream-contracts-are-current] Upstream contract drift.',
      '',
      ...errors.map(e => `    - ${e}`),
      '',
      '  A materialized upstream reference disagrees with its pin in',
      '  scripts/repo/upstream-contracts.mts (or a required path/fixture is missing). Fix:',
      '  re-checkout the submodule at its pinned revision, or advance the pin +',
      '  its fixture/proof together (never bump `revision` alone). See',
      '  docs/agents.md/fleet/upstream-references.md.',
      '',
    ].join('\n'),
  )
  return 1
}

if (isMainModule(import.meta.url)) {
  runCheck(REPO_ROOT).then(
    code => {
      process.exitCode = code
    },
    (e: unknown) => {
      logger.error(e)
      process.exitCode = 1
    },
  )
}
