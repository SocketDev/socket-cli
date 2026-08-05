/*
 * @file What `--dry-run` MEANS for a release: build the artifact this repo
 *   would publish and validate its bytes — never a printed preview of the
 *   commands.
 *
 *   A preview proves nothing. The failures a dry run exists to catch live in
 *   the packed bytes: a hollow tarball whose manifest declares payload the
 *   build never produced, a `..` entry, a bin that lost its exec bit, a secret
 *   swept in by a too-wide `files` glob. None of that is visible from the
 *   command line that would have run.
 *
 *   WHERE IT STOPS. Packing is the last step that needs no registry. npm's
 *   staged publish needs an upload; crates.io is permanent on first push; a
 *   GitHub Release is public immediately. So the artifact is the terminus: for
 *   a direct publish (a `0.0.0` placeholder reservation, a crate) the pack IS
 *   the whole verifiable surface, and for a staged npm publish everything
 *   beyond it requires access a dry run must not have.
 *
 *   WHERE IT BUILDS. `os.tmpdir()`, always. Packing into the package's own
 *   directory drops a `.tgz` into a tracked tree and leaves cleanup to a
 *   happy-path delete; a killed run then strands an artifact that a later
 *   `files` glob can sweep into a real publish.
 */

import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The publish channels a dry run has to account for.
 *
 * The first four are the `build.from` / `secondaries[].from` literals in the
 * socket-wheelhouse schema. `brew-tap` is NOT a schema literal yet — it is
 * modelled here because a formula is a publish surface whether or not the
 * schema names it, and leaving it out is what makes a tap ship unverified.
 * Wiring detection needs the schema literal added; the strategy below is
 * complete and ready for it.
 */
export type PublishChannel =
  | 'brew-tap'
  | 'crates-registry'
  | 'github-release'
  | 'go-registry'
  | 'npm-registry'

/**
 * Why Homebrew is not handled here, recorded so the next reader does not have
 * to re-derive it. A tap/cask is not built and uploaded — the formula points at
 * an already-published artifact and carries its checksum, so the dry-run
 * equivalent is `brew audit --cask` plus a checksum match against the artifact
 * the OTHER channel already produced. That makes it a validator layered on a
 * sibling channel rather than a pack of its own, and it needs a schema channel
 * before any of it is reachable.
 */

/**
 * What KIND of proof a channel's dry run produces. The three are not
 * interchangeable, and collapsing them is how a channel ends up unverified:
 *
 * - `pack` — builds the exact artifact the registry receives. The bytes are the
 *   proof.
 * - `build` — the channel uploads nothing (Go publishes by pushing a tag and the
 *   proxy fetches the repo), so the proof is that the module resolves and
 *   compiles at the commit being tagged.
 * - `attest` — the channel ships a POINTER to someone else's artifact. A brew
 *   formula carries a URL and a sha256; the proof is that the formula parses
 *   and its checksum matches the artifact the sibling channel produced. There
 *   is nothing of its own to pack.
 */
export type DryRunKind = 'attest' | 'build' | 'pack'

/**
 * How one channel's artifact gets built for inspection.
 *
 * `command` runs in the subject directory with the artifact written to
 * `destination` under a fresh tmpdir. `packs: false` marks a channel that
 * produces no uploadable artifact, so a dry run verifies buildability instead.
 */
export interface DryPackCommand {
  readonly args: readonly string[]
  readonly cmd: string
}

export interface DryPackStrategy {
  readonly channel: PublishChannel
  // Run in order; the first non-zero exit fails the channel.
  readonly commands: readonly DryPackCommand[]
  // For an `attest` channel, the channel whose artifact the pointer references.
  // The sibling must run FIRST — its artifact is this channel's input.
  readonly dependsOn: PublishChannel | undefined
  // Flag that redirects the artifact out of the source tree, or undefined when
  // the channel writes nothing (`build`/`attest`) or the tool has no such flag.
  readonly destinationFlag: string | undefined
  readonly kind: DryRunKind
  readonly why: string
}

/**
 * The per-channel pack strategy. One table so a new channel is one entry, not
 * a new branch in every caller.
 */
export const DRY_PACK_STRATEGIES: Readonly<
  Record<PublishChannel, DryPackStrategy>
> = {
  'brew-tap': {
    channel: 'brew-tap',
    // `--cask` style-checks the formula; `fetch --cask` downloads the URL the
    // formula names and verifies its declared sha256. That second command is
    // the one that matters: a formula whose checksum drifted from the artifact
    // installs nothing, and the failure only shows up on a user's machine.
    commands: [
      { args: ['audit', '--cask'], cmd: 'brew' },
      { args: ['fetch', '--cask'], cmd: 'brew' },
    ],
    dependsOn: 'github-release',
    destinationFlag: undefined,
    kind: 'attest',
    why: 'a formula ships a URL + sha256 pointing at another channel\u2019s artifact, so the proof is that the pointer resolves and the checksum matches',
  },
  'crates-registry': {
    channel: 'crates-registry',
    // `--locked` refuses to silently re-resolve the lockfile, so the inspected
    // crate matches what a real publish would upload.
    commands: [{ args: ['package', '--locked'], cmd: 'cargo' }],
    dependsOn: undefined,
    destinationFlag: '--target-dir',
    kind: 'pack',
    why: 'crates.io is permanent on first publish, so the .crate is the last reversible checkpoint',
  },
  'github-release': {
    channel: 'github-release',
    // The wheelhouse bundle the thin members fetch. `--tar` produces the same
    // .tar.gz the release attaches.
    commands: [
      { args: ['scripts/repo/make-release-bundle.mts', '--tar'], cmd: 'node' },
    ],
    dependsOn: undefined,
    destinationFlag: '--out-dir',
    kind: 'pack',
    why: 'a Release is public the moment it is cut, so the bundle is verified before it exists',
  },
  'go-registry': {
    channel: 'go-registry',
    // Three separate failure modes, none of which the others catch:
    // 1. `go mod verify` — a dependency's bytes no longer match go.sum. The
    //    proxy serves what the tag points at, so a bad sum breaks consumers.
    // 2. `go build ./...` — the tag must compile. There is no publish step
    //    that would have failed first; a broken tag is simply live.
    // 3. `go vet ./...` — the module path in go.mod has to match the repo URL
    //    or `go get` cannot resolve it, and nothing else in the fleet checks
    //    that a tag will actually be fetchable.
    commands: [
      { args: ['mod', 'verify'], cmd: 'go' },
      { args: ['build', './...'], cmd: 'go' },
      { args: ['vet', './...'], cmd: 'go' },
    ],
    dependsOn: undefined,
    destinationFlag: undefined,
    kind: 'build',
    why: 'a Go module is published by pushing a tag \u2014 there is no artifact and no upload step to fail, so a tag that does not resolve or compile is already public',
  },
  'npm-registry': {
    channel: 'npm-registry',
    // `ignore-scripts` keeps a prepublish hook from mutating the tree during
    // what is supposed to be a read-only rehearsal.
    commands: [{ args: ['pack', '--config.ignore-scripts=true'], cmd: 'pnpm' }],
    dependsOn: undefined,
    destinationFlag: '--pack-destination',
    kind: 'pack',
    why: 'the packed tarball is the exact byte set npm would receive',
  },
}

/**
 * The strategies a repo's declared channels call for, in a stable order so two
 * runs report identically. Unknown channel strings are dropped rather than
 * throwing — a member on a newer schema must not break an older cascade.
 */
export function planDryPack(channels: readonly string[]): DryPackStrategy[] {
  const seen = new Set<PublishChannel>()
  const out: DryPackStrategy[] = []
  // `github-release` precedes `brew-tap` because a formula attests against the
  // Release artifact — running the tap first would check a checksum for
  // something that does not exist yet.
  const ordered: PublishChannel[] = [
    'npm-registry',
    'crates-registry',
    'github-release',
    'brew-tap',
    'go-registry',
  ]
  for (let i = 0, { length } = ordered; i < length; i += 1) {
    const channel = ordered[i]!
    if (channels.includes(channel) && !seen.has(channel)) {
      seen.add(channel)
      out.push(DRY_PACK_STRATEGIES[channel])
    }
  }
  return out
}

/**
 * Argv for one strategy, with the artifact redirected into `destDir`.
 *
 * A strategy whose tool has no destination flag returns its command unchanged —
 * the caller is then responsible for running it somewhere disposable, because
 * the tool WILL write into the source tree.
 */
export function dryPackArgs(
  command: DryPackCommand,
  strategy: DryPackStrategy,
  destDir: string,
): string[] {
  const args = [...command.args]
  if (strategy.destinationFlag !== undefined) {
    args.push(strategy.destinationFlag, destDir)
  }
  return args
}

/**
 * True when the caller must stage a copy because the tool cannot be redirected.
 */
export function needsStagedCopy(strategy: DryPackStrategy): boolean {
  return strategy.kind === 'pack' && strategy.destinationFlag === undefined
}

// One prefix so a stranded directory is identifiable as this tool's, and a
// sweep can find every one of them.
export const DRY_PACK_TMP_PREFIX = 'socket-dry-pack-'

/**
 * A fresh tmpdir for one dry-pack run.
 *
 * Separate from the run so tests can assert the prefix and the caller can
 * delete it in a `finally` — the artifact exists only to be inspected.
 */
export function makeDryPackDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), DRY_PACK_TMP_PREFIX))
}

/**
 * Runs one command for a dry run. Injected so every path below is testable
 * without a registry, a toolchain, or a network — the house seam shape (see
 * `GitExec` in `../backup-branches/prune.mts`).
 */
export type DryExec = (
  cmd: string,
  args: readonly string[],
  cwd: string,
) => Promise<{ code: number; stdout: string }>

/**
 * Lists the artifacts a pack command produced. Injected for the same reason.
 */
export type ArtifactLister = (dir: string) => readonly string[]

export interface DryRunResult {
  readonly channel: PublishChannel
  readonly detail: string
  readonly kind: DryRunKind
  readonly ok: boolean
}

/**
 * Whether a channel's dry run has to leave an artifact behind.
 *
 * Only `pack` does. Asserting it is what separates "the command exited 0" from
 * "the bytes exist": a pack tool that silently produced nothing still exits 0,
 * and without this check the dry run reports success for an empty publish.
 */
export function expectsArtifact(strategy: DryPackStrategy): boolean {
  return strategy.kind === 'pack'
}

/**
 * Run one channel's dry run: its commands in order, then the kind's proof.
 *
 * Fails at the FIRST non-zero exit and names the command, because a later
 * failure caused by an earlier one reads as two problems instead of one.
 */
export interface DryRunConfig {
  readonly destDir: string
  readonly exec: DryExec
  readonly listArtifacts: ArtifactLister
  readonly repoDir: string
}

export async function runChannelDryRun(
  strategy: DryPackStrategy,
  config: DryRunConfig,
): Promise<DryRunResult> {
  const cfg = { __proto__: null, ...config } as DryRunConfig
  const { channel, kind } = strategy
  for (let i = 0, { length } = strategy.commands; i < length; i += 1) {
    const command = strategy.commands[i]!
    const args = dryPackArgs(command, strategy, cfg.destDir)
    // oxlint-disable-next-line no-await-in-loop -- ordered by design: a later command's failure is usually caused by an earlier one
    const r = await cfg.exec(command.cmd, args, cfg.repoDir)
    if (r.code !== 0) {
      return {
        channel,
        detail: `\`${command.cmd} ${args.join(' ')}\` exited ${String(r.code)}`,
        kind,
        ok: false,
      }
    }
  }
  if (!expectsArtifact(strategy)) {
    return { channel, detail: `${kind} proof passed`, kind, ok: true }
  }
  const artifacts = cfg.listArtifacts(cfg.destDir)
  if (artifacts.length === 0) {
    return {
      channel,
      detail: `commands exited 0 but produced no artifact in ${cfg.destDir}`,
      kind,
      ok: false,
    }
  }
  return {
    channel,
    detail: `packed ${artifacts.join(', ')}`,
    kind,
    ok: true,
  }
}
