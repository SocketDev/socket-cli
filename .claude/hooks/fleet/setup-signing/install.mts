#!/usr/bin/env node
/*
 * @file Install-only entry point for commit-signing setup. Detects which
 *   signing method is locally available (SSH keys via 1Password / agent /
 *   ~/.ssh, GPG via gpg-agent, plain GPG key), and walks the user through `git
 *   config user.signingkey` + `git config commit.gpgsign true` + `git config
 *   gpg.format` (ssh|openpgp). Paired with the pre-commit signing-config gate
 *   and the pre-push signed-commits enforcement. Without signing set up, those
 *   hooks block commits / pushes; this helper makes the one-time setup
 *   mechanical. Usage: node .claude/hooks/fleet/setup-signing/install.mts node
 *   .claude/hooks/fleet/setup-signing/install.mts --check # report only node
 *   .claude/hooks/fleet/setup-signing/install.mts --force # overwrite existing
 *   config Auto-detection order, first hit wins:
 *
 *   1. 1Password SSH agent (SOCK at ~/Library/Group Containers/.../agent.sock). If
 *      present + has keys, recommend SSH signing routed through 1Password.
 *      Pros: keys never touch disk; biometric unlock on use.
 *   2. ssh-agent or running gpg-agent with loaded keys. SSH preferred over GPG
 *      when both exist, simpler keyring, no expiry headaches.
 *   3. ~/.ssh/id_ed25519.pub (or id_rsa.pub) on disk. Recommend SSH signing using
 *      that key.
 *   4. `gpg --list-secret-keys` produces output. Recommend GPG signing with the
 *      first secret key.
 *   5. Nothing found. Print the setup choices and exit. The helper NEVER generates
 *      new keys. Key creation is the user's call — the helper only configures
 *      git to USE keys the user already has.
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { isMainModule } from '../../../../scripts/fleet/_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface CliArgs {
  check: boolean
  force: boolean
}

export function parseArgs(argv: readonly string[]): CliArgs {
  return {
    check: argv.includes('--check'),
    force: argv.includes('--force'),
  }
}

export type SigningFormat = 'ssh' | 'openpgp'

export interface CurrentConfig {
  gpgsign: string
  signingkey: string
  format: string
}

export function readCurrentConfig(): CurrentConfig {
  const get = (key: string): string => {
    const r = spawnSync('git', ['config', '--global', '--get', key], {
      stdio: 'pipe',
      stdioString: true,
    })
    return r.status === 0 ? String(r.stdout ?? '').trim() : ''
  }
  return {
    gpgsign: get('commit.gpgsign'),
    signingkey: get('user.signingkey'),
    format: get('gpg.format') || 'openpgp', // git's default
  }
}

export interface DetectedSigner {
  format: SigningFormat
  // The literal `user.signingkey` value to set.
  key: string
  // Human-readable origin (1Password, ssh-agent, ~/.ssh/id_ed25519.pub, gpg).
  source: string
}

export function detect1PasswordSshAgent(): DetectedSigner | undefined {
  // macOS: ~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock
  // Linux: ~/.1password/agent.sock
  // Windows: \\\\.\\pipe\\openssh-ssh-agent, different mechanism, skip detection
  let sock: string | undefined
  if (os.platform() === 'darwin') {
    sock = path.join(
      os.homedir(),
      'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock',
    )
  } else if (os.platform() === 'linux') {
    sock = path.join(os.homedir(), '.1password/agent.sock')
  }
  if (!sock || !existsSync(sock)) {
    return undefined
  }
  // Ask the agent what keys it has. SSH_AUTH_SOCK pointed at 1Password's sock.
  const r = spawnSync('ssh-add', ['-L'], {
    stdio: 'pipe',
    stdioString: true,
    env: { ...process.env, SSH_AUTH_SOCK: sock },
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    return undefined
  }
  // First public-key line is the one to use.
  const line = String(r.stdout ?? '')
    .split('\n')
    .find(l => l.startsWith('ssh-') || l.startsWith('ecdsa-'))
  if (!line) {
    return undefined
  }
  return {
    format: 'ssh',
    // For SSH signing, user.signingkey is the public key string itself
    // (or a path to a .pub file). Inline is simpler.
    key: line.trim(),
    source: '1Password SSH agent',
  }
}

export function detectSshKeyOnDisk(): DetectedSigner | undefined {
  // Prefer ed25519 over rsa.
  const candidates = ['id_ed25519.pub', 'id_ecdsa.pub', 'id_rsa.pub']
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const name = candidates[i]!
    const p = path.join(os.homedir(), '.ssh', name)
    if (existsSync(p)) {
      return {
        format: 'ssh',
        // Pointing user.signingkey at the .pub file is the documented git
        // convention for SSH signing (git reads the public key from the
        // file at sign time).
        key: p,
        source: `~/.ssh/${name}`,
      }
    }
  }
  return undefined
}

export function detectGpgKey(): DetectedSigner | undefined {
  const r = spawnSync(
    'gpg',
    ['--list-secret-keys', '--keyid-format=long', '--with-colons'],
    {
      stdio: 'pipe',
      stdioString: true,
      timeout: spawnTimeoutMs(5000),
    },
  )
  if (r.status !== 0) {
    return undefined
  }
  // Parse `--with-colons` machine output. Lines starting with "sec:" are
  // secret keys; field 5 is the keygrip / long ID.
  const lines = String(r.stdout ?? '').split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('sec:')) {
      const fields = line.split(':')
      const keyId = fields[4]
      if (keyId) {
        return { format: 'openpgp', key: keyId, source: 'gpg secret key' }
      }
    }
  }
  return undefined
}

export function detectSigner(): DetectedSigner | undefined {
  return detect1PasswordSshAgent() ?? detectSshKeyOnDisk() ?? detectGpgKey()
}

export function configure(signer: DetectedSigner): void {
  const set = (key: string, value: string): void => {
    spawnSync('git', ['config', '--global', key, value], { stdio: 'inherit' })
  }
  set('commit.gpgsign', 'true')
  set('user.signingkey', signer.key)
  set('gpg.format', signer.format)
  if (signer.format === 'ssh' && signer.source === '1Password SSH agent') {
    // SSH signing additionally needs a program that can verify signatures
    // (op-ssh-sign for 1Password). git uses gpg.ssh.program for signing
    // operations.
    if (os.platform() === 'darwin') {
      const opSign = '/Applications/1Password.app/Contents/MacOS/op-ssh-sign'
      if (existsSync(opSign)) {
        set('gpg.ssh.program', opSign)
      }
    }
  }
}

export function reportConfigTo(
  sink: { log: (...args: unknown[]) => void },
  c: CurrentConfig,
): void {
  sink.log(`  commit.gpgsign:   ${c.gpgsign || '(unset)'}`)
  sink.log(`  user.signingkey:  ${c.signingkey || '(unset)'}`)
  sink.log(`  gpg.format:       ${c.format}`)
}

export function reportManualStepsTo(sink: {
  log: (...args: unknown[]) => void
}): void {
  sink.log('No usable signing key detected. Choose one:')
  sink.log('')
  sink.log('Option A — 1Password SSH signing (recommended)')
  sink.log('  1. Open 1Password → Settings → Developer → enable SSH agent')
  sink.log(
    '  2. Add SOCK to your shell: export SSH_AUTH_SOCK=~/Library/Group\\ Containers/2BUA8C4S2C.com.1password/t/agent.sock',
  )
  sink.log(
    '  3. Create or import an SSH key in 1Password → run this helper again',
  )
  sink.log('')
  sink.log('Option B — Existing SSH key on disk')
  sink.log('  1. Confirm ~/.ssh/id_ed25519.pub exists')
  sink.log('  2. Run this helper again')
  sink.log('')
  sink.log('Option C — GPG')
  sink.log(
    '  1. Generate: gpg --full-generate-key (RSA 4096 or Ed25519, no expiry preferred for personal use)',
  )
  sink.log('  2. Upload public key to GitHub → Settings → SSH and GPG keys')
  sink.log('  3. Run this helper again')
  sink.log('')
  sink.log('GitHub-side note: upload the corresponding PUBLIC key as a')
  sink.log(
    'Signing Key at https://github.com/settings/keys for "Verified" badges',
  )
  sink.log('on web-rendered commits.')
}

/**
 * Every process boundary this step touches, in one injectable bag: reading and
 * writing the global git config, probing the machine for a signer, and the log
 * sink. A test drives the whole flow in-process by faking these; before the
 * seam existed the only way to exercise any branch was spawning the entire
 * script per case, which cost 17-51s a test and timed out under load.
 */
export interface SigningInstallIo {
  configure: (signer: DetectedSigner) => void
  detectSigner: () => DetectedSigner | undefined
  logger: { log: (...args: unknown[]) => void }
  readCurrentConfig: () => CurrentConfig
}

/**
 * The real I/O bag: git config through spawnSync, detection through the
 * filesystem and ssh-add/gpg probes, output through the fleet logger.
 */
export function resolveSigningInstallIo(): SigningInstallIo {
  return {
    configure,
    detectSigner,
    logger,
    readCurrentConfig,
  }
}

/**
 * The whole step as a pure-ish flow returning its exit code: `0` configured or
 * already configured, `1` nothing detected or `--check` on an unconfigured
 * repo. Returning the code rather than calling `process.exit` is what makes the
 * branches assertable without a child process.
 */
export function runSigningInstall(config: {
  argv: readonly string[]
  io: SigningInstallIo
}): number {
  const cfg = { __proto__: null, ...config } as typeof config
  const { io } = cfg
  const args = parseArgs(cfg.argv)
  io.logger.log('Commit signing — install / verify')
  io.logger.log('')

  const before = io.readCurrentConfig()
  io.logger.log('Current git config:')
  reportConfigTo(io.logger, before)
  io.logger.log('')

  const alreadyConfigured =
    before.gpgsign.toLowerCase() === 'true' && Boolean(before.signingkey)
  if (alreadyConfigured && !args.force) {
    io.logger.log(
      'Signing is already configured. Pass --force to re-detect and overwrite.',
    )
    return 0
  }

  if (args.check) {
    io.logger.log('Signing is NOT configured (or partial).')
    return 1
  }

  const signer = io.detectSigner()
  if (!signer) {
    reportManualStepsTo(io.logger)
    return 1
  }

  io.logger.log(`Detected signer: ${signer.source} (${signer.format})`)
  io.logger.log(`Setting user.signingkey to:`)
  io.logger.log(`  ${signer.key}`)
  io.logger.log('')
  io.configure(signer)

  const after = io.readCurrentConfig()
  io.logger.log('Updated git config:')
  reportConfigTo(io.logger, after)
  io.logger.log('')
  io.logger.log(
    'Done. The next commit will be signed automatically. Pre-commit and',
  )
  io.logger.log('pre-push gates will accept it.')
  io.logger.log('')
  io.logger.log('GitHub-side: upload the public key as a Signing Key at')
  io.logger.log('  https://github.com/settings/keys')
  io.logger.log('so commits show as "Verified" in the GitHub UI.')
  return 0
}

/* c8 ignore start - process entrypoint: argv read + exit-code plumbing. */
if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = runSigningInstall({
      argv: process.argv.slice(2),
      io: resolveSigningInstallIo(),
    })
  } catch (e) {
    logger.error(errorMessage(e))
    process.exitCode = 1
  }
}
/* c8 ignore stop */
