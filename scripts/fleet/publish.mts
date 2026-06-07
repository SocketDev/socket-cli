/**
 * @file Fleet-canonical publish runner. Three modes: --staged Upload this
 *   package's tarball to npm staging via `pnpm stage publish`. Designed to run
 *   in CI under the OIDC trusted-publisher token. Nothing publicly visible
 *   until --approve runs. Adds `--provenance` automatically when GITHUB_ACTIONS
 *   is set. THIS IS THE DEFAULT path — staging gives `pnpm stage reject` a
 *   server-side rescue for botched uploads (wrong file, wrong checksum, wrong
 *   version) before anything goes public. --approve Interactive multi-select
 *   over the user's currently-staged packages, then batch `pnpm stage approve
 *   <id>` with a single shared 2FA OTP. Designed to run locally. OTP resolution
 *   order:
 *
 *   1. `--otp <code>` flag (CI / scripted use).
 *   2. Interactive `password` prompt (lib/stdio/prompts).
 *   3. Empty prompt input → pnpm's per-call web-OTP flow (registry challenge opens
 *      a browser window to npmjs.com per approve call). --direct Classic
 *      single-step `pnpm publish` — uploads + makes public in one call, no
 *      stage/approve. Escape hatch for environments where the stage endpoint is
 *      unreachable (e.g. an SFW build without the `/-/stage/*` endpoint
 *      allowlist). Same provenance + OIDC token shape as --staged when
 *      GITHUB_ACTIONS is set. Trades server-side rejectability for fewer hops;
 *      only use when the stage path can't reach npm. Prefer --staged whenever
 *      the network allows it. --dry-run Forwarded to the underlying pnpm
 *      command. Used to preview the tarball + manifest without registry writes.
 *      The staged/approve split is a hard requirement of npm's staged-publish
 *      flow: the stage upload uses an OIDC token from CI; the approve step
 *      requires human 2FA. Combining them in one mode would either leak the OTP
 *      into CI logs or require a human at the CI keyboard. Repos with bespoke
 *      publish pipelines (socket-addon's 9-package OIDC + .node verification,
 *      socket-registry's monorepo package-npm-publish delegation, etc.) keep
 *      their own publish.mts and don't adopt this canonical version. Repos with
 *      simple single-package publishing consume this one byte-identical via the
 *      sync-scaffolding cascade.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { checkbox, password } from '@socketsecurity/lib/stdio/prompts'

import { REPO_ROOT } from './paths.mts'
import {
  extractFirstJson,
  fetchVersionTrustInfo,
  isAlreadyPublished,
  runCapture,
  runInherit,
} from './publish-shared.mts'

const logger = getDefaultLogger()
const rootPath = REPO_ROOT
interface StageListEntry {
  name?: string | undefined
  version?: string | undefined
  stageId?: string | undefined
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      approve: { default: false, type: 'boolean' },
      direct: { default: false, type: 'boolean' },
      'dry-run': { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      otp: { type: 'string' },
      staged: { default: false, type: 'boolean' },
      tag: { default: 'latest', type: 'string' },
    },
    allowPositionals: false,
    strict: false,
  })

  if (
    values['help'] ||
    (!values['staged'] && !values['approve'] && !values['direct'])
  ) {
    logger.log(
      'Usage: pnpm publish --staged | --approve | --direct [--dry-run] [--otp <code>]',
    )
    logger.log('')
    logger.log(
      '  --staged             CI: upload to npm staging via OIDC (recommended)',
    )
    logger.log('  --approve            local: multi-select + 2FA promote')
    logger.log(
      '  --direct             classic `pnpm publish` — public in one step,',
    )
    logger.log(
      '                       no stage/approve. Escape hatch when the stage',
    )
    logger.log(
      '                       endpoint is unreachable (errors if staging is',
    )
    logger.log('                       available — use --staged instead).')
    logger.log('  --dry-run            simulate; no registry writes')
    logger.log(
      '  --otp <code>         pre-supply 2FA (skips OTP prompt on --approve)',
    )
    logger.log('  --tag <tag>          dist-tag for --staged (default: latest)')
    process.exitCode = values['help'] ? 0 : 1
    return
  }

  const modes = [values['staged'], values['approve'], values['direct']].filter(
    Boolean,
  ).length
  if (modes > 1) {
    logger.fail('Pass exactly one of --staged / --approve / --direct.')
    process.exitCode = 1
    return
  }

  const dryRun = !!values['dry-run']
  const otpFromFlag =
    typeof values['otp'] === 'string' ? values['otp'] : undefined
  if (values['staged']) {
    await runStaged(String(values['tag']), dryRun)
  } else if (values['direct']) {
    await runDirect(String(values['tag']), dryRun)
  } else {
    await runApprove(dryRun, otpFromFlag)
  }
}

/**
 * Detect whether this package has previously been published via the staged
 * path. Returns true when ANY published version of `pkg.name` carries the
 * registry packument's `_npmUser.approver` field — the signal pnpm uses for its
 * `stagedPublish` trust-evidence tier (see github.com/pnpm/pnpm pull 12056). A
 * package with an approver in its history has chosen the strongest trust path
 * available; downgrading to --direct for a new version would erase that signal
 * in the package's trust chain.
 *
 * Used by --direct to refuse running when the package's prior versions used
 * staging: we want that trade-off to be a deliberate choice, not an accident.
 * First-publish packages (no prior versions) get a pass — they have no staged
 * history to preserve.
 */
export async function isStagingExpected(pkgName: string): Promise<boolean> {
  try {
    const versions = await fetchVersionTrustInfo(pkgName, 'full')
    for (const v of Object.values(versions)) {
      if (v.approver !== undefined) {
        return true
      }
    }
  } catch {
    // Network failure / 404 / unparseable packument — treat as
    // "unknown" and don't block the --direct path on it.
  }
  return false
}

/**
 * `--staged` mode: stage this package's tarball.
 *
 * Reads the local package.json for name + version, refuses to stage an
 * already-published version (npm rejects republishes outright; we surface the
 * error before the network call). Runs `pnpm stage publish` with --provenance
 * when GITHUB_ACTIONS is set so the OIDC token gets embedded into the
 * provenance attestation.
 */
async function runStaged(tag: string, dryRun: boolean): Promise<void> {
  const pkg = readPackageJson()
  logger.log(
    `Staging ${pkg.name}@${pkg.version} (tag=${tag})${dryRun ? ' [dry-run]' : ''}`,
  )

  if (await isAlreadyPublished(pkg.name, pkg.version, rootPath)) {
    logger.fail(
      `${pkg.name}@${pkg.version} is already published. Bump the version and try again.`,
    )
    process.exitCode = 1
    return
  }

  const args = [
    'stage',
    'publish',
    '--access',
    'public',
    '--tag',
    tag,
    '--no-git-checks',
    '--ignore-scripts',
  ]
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    args.push('--provenance')
  }
  if (dryRun) {
    // pnpm stage publish --dry-run does everything except the actual
    // upload; surfaces packing errors + manifest validation without
    // touching the registry.
    args.push('--dry-run')
  }
  const code = await runInherit('pnpm', args, rootPath)
  if (code !== 0) {
    logger.fail(`pnpm stage publish exited ${code}`)
    process.exitCode = code
    return
  }
  if (dryRun) {
    logger.success(
      `Dry-run complete for ${pkg.name}@${pkg.version}. Re-run without --dry-run to upload.`,
    )
  } else {
    logger.success(
      `Staged ${pkg.name}@${pkg.version}. Run \`pnpm run publish -- --approve\` locally to promote.`,
    )
  }
}

/**
 * `--direct` mode: classic single-step `pnpm publish` — upload + make public in
 * one call, no stage/approve. Escape hatch for environments where the stage
 * endpoint is unreachable. Adds `--provenance` automatically when
 * GITHUB_ACTIONS is set so the OIDC token still embeds into the provenance
 * attestation.
 *
 * Refuses to run when the package's prior versions used staging (per the
 * packument's `_npmUser.approver` signal). Downgrading erases the trust signal
 * from the package's history. Operators who hit the refusal should either use
 * `--staged` (preferred) or accept the trust regression by removing the prior
 * staged-published versions from the registry first.
 */
async function runDirect(tag: string, dryRun: boolean): Promise<void> {
  const pkg = readPackageJson()
  logger.log(
    `Direct-publishing ${pkg.name}@${pkg.version} (tag=${tag})${dryRun ? ' [dry-run]' : ''}`,
  )

  if (await isAlreadyPublished(pkg.name, pkg.version, rootPath)) {
    logger.fail(
      `${pkg.name}@${pkg.version} is already published. Bump the version and try again.`,
    )
    process.exitCode = 1
    return
  }

  // Trust-downgrade refusal: if any prior version of this package was
  // staged-published (carries `_npmUser.approver`), --direct would erase
  // that trust signal. Force the operator to use --staged or make the
  // downgrade explicit. Skips on first-publish packages (no prior
  // versions) and on network failure (which we treat as "unknown").
  if (await isStagingExpected(pkg.name)) {
    logger.fail(
      `${pkg.name} has prior staged-published versions (per registry _npmUser.approver). ` +
        `--direct would downgrade the trust signal. Use --staged instead, or ` +
        `(rare) remove the prior staged-published versions first.`,
    )
    process.exitCode = 1
    return
  }

  const args = [
    'publish',
    '--access',
    'public',
    '--tag',
    tag,
    '--no-git-checks',
    '--ignore-scripts',
  ]
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    args.push('--provenance')
  }
  if (dryRun) {
    args.push('--dry-run')
  }
  const code = await runInherit('pnpm', args, rootPath)
  if (code !== 0) {
    logger.fail(`pnpm publish exited ${code}`)
    process.exitCode = code
    return
  }
  if (dryRun) {
    logger.success(
      `Dry-run complete for ${pkg.name}@${pkg.version}. Re-run without --dry-run to publish.`,
    )
  } else {
    logger.success(`Published ${pkg.name}@${pkg.version} directly.`)
  }
}

/**
 * `--approve` mode: list the user's staged packages, multi-select, batch
 * approve with one OTP.
 *
 * Filters out any staged entries whose name@version is already public (e.g. a
 * re-stage after a partial approve). Empty selection is a no-op. The OTP is
 * read via a hidden-character prompt; a single OTP value is reused across all
 * approve calls in the same batch — npm accepts the same TOTP within its ~30s
 * validity window.
 */
async function runApprove(
  dryRun: boolean,
  otpFromFlag: string | undefined,
): Promise<void> {
  const staged = await listStagedPackages()
  if (staged.length === 0) {
    logger.log('No packages currently staged.')
    return
  }

  // Filter out already-published versions. If a stage upload was
  // approved earlier but the entry lingers in stage list (registry
  // quirk), don't offer it for re-approval.
  const eligible: StageListEntry[] = []
  for (const entry of staged) {
    // eslint-disable-next-line no-await-in-loop
    if (
      entry.name &&
      entry.version &&
      !(await isAlreadyPublished(entry.name, entry.version, rootPath))
    ) {
      eligible.push(entry)
    }
  }
  if (eligible.length === 0) {
    logger.log('All staged entries are already published; nothing to approve.')
    return
  }

  // Fetch prior-version provenance for each unique package name so the
  // approver can spot regressions (last public version had provenance
  // but the staged one's parent name has lost trust metadata between
  // versions — a workflow drift signal). Cheap: one fetch per unique
  // name, abbreviated packument (no _npmUser needed; we only check
  // attestations presence as a proxy for "this name is OIDC-published").
  const priorProvenance = await fetchPriorProvenanceMap(eligible)

  const choices = eligible.map(e => ({
    name: `${e.name}@${e.version}${formatPriorProvenance(priorProvenance.get(e.name!))}`,
    value: e.stageId!,
    checked: true,
  }))
  const selected = (await checkbox({
    message: 'Select staged packages to approve:',
    choices,
  })) as string[] | undefined
  if (!selected || selected.length === 0) {
    logger.log('Nothing selected; exiting.')
    return
  }

  if (dryRun) {
    logger.log('[dry-run] would approve:')
    for (const stageId of selected) {
      const entry = eligible.find(e => e.stageId === stageId)
      logger.log(`  ${entry?.name}@${entry?.version} (id: ${stageId})`)
    }
    logger.success(
      `Dry-run complete. Re-run without --dry-run to prompt for OTP and promote.`,
    )
    return
  }

  // OTP resolution order:
  //   1. --otp <code> flag (CI / scripted use).
  //   2. Interactive prompt; entering a TOTP code uses it for all
  //      approvals; entering nothing falls through to pnpm's per-call
  //      web-OTP flow (the registry challenges and pnpm opens a browser
  //      window to npmjs.com for each approve call).
  // Passing the same TOTP to every approve in a batch is fine: npm
  // accepts the same code for the duration of its ~30s validity window.
  let otp = otpFromFlag
  if (!otp) {
    const entered = (await password({
      message:
        '2FA OTP (TOTP code for batch; leave blank for browser web-OTP):',
      mask: '*',
    })) as string | undefined
    if (entered) {
      otp = entered
    }
  }

  let approved = 0
  let failed = 0
  for (const stageId of selected) {
    const args = ['stage', 'approve', stageId]
    if (otp) {
      args.push('--otp', otp)
    }
    // eslint-disable-next-line no-await-in-loop
    const code = await runInherit('pnpm', args, rootPath)
    if (code === 0) {
      approved += 1
    } else {
      failed += 1
      logger.fail(`Approve ${stageId} exited ${code}`)
    }
  }
  if (failed > 0) {
    logger.fail(`${failed}/${selected.length} failed; ${approved} approved`)
    process.exitCode = 1
    return
  }
  logger.success(`Approved ${approved} package${approved === 1 ? '' : 's'}`)
}

function readPackageJson(): { name: string; version: string } {
  const raw = readFileSync(path.join(rootPath, 'package.json'), 'utf8')
  return JSON.parse(raw) as { name: string; version: string }
}

/**
 * Resolve all currently-staged packages by parsing `pnpm stage list --json`.
 * The output's first balanced JSON object is the keyed map `<name>@<version>` →
 * entry; we flatten the values and drop entries without a stageId (defensive).
 */
async function listStagedPackages(): Promise<StageListEntry[]> {
  const { stdout } = await runCapture(
    'pnpm',
    ['stage', 'list', '--json'],
    rootPath,
  )
  const json = extractFirstJson(stdout)
  if (!json) {
    return []
  }
  try {
    const parsed = JSON.parse(json) as Record<
      string,
      StageListEntry | undefined
    >
    const result: StageListEntry[] = []
    for (const entry of Object.values(parsed)) {
      if (entry?.stageId) {
        result.push(entry)
      }
    }
    return result
  } catch {
    return []
  }
}

/**
 * For each unique package name in `entries`, fetch the latest version's trust
 * info from the registry. Used to annotate the approve multi- select with a
 * "this package's last public version had provenance" hint — helps the approver
 * spot if their staged upload is a regression (parent name has provenance
 * history; staged version's workflow may have lost OIDC).
 *
 * One registry GET per unique name; abbreviated packument (saves ~80KB per
 * popular package, omits `_npmUser` which we don't need here).
 */
async function fetchPriorProvenanceMap(
  entries: StageListEntry[],
): Promise<Map<string, boolean>> {
  const uniqueNames = new Set<string>()
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const e = entries[i]!
    if (e.name) {
      uniqueNames.add(e.name)
    }
  }
  const result = new Map<string, boolean>()
  await Promise.all(
    [...uniqueNames].map(async name => {
      const versions = await fetchVersionTrustInfo(name, 'abbreviated')
      const hasAnyAttestation = Object.values(versions).some(
        v => !!v.attestations,
      )
      result.set(name, hasAnyAttestation)
    }),
  )
  return result
}

function formatPriorProvenance(
  hasPriorProvenance: boolean | undefined,
): string {
  if (hasPriorProvenance === undefined) {
    return ''
  }
  return hasPriorProvenance
    ? '  [prior: ✓ provenance]'
    : '  [prior: ✗ no provenance]'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
