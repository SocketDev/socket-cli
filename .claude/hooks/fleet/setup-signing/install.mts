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
 *   config Auto-detection order (first hit wins):
 *
 *   1. 1Password SSH agent (SOCK at ~/Library/Group Containers/.../agent.sock). If
 *      present + has keys, recommend SSH signing routed through 1Password.
 *      Pros: keys never touch disk; biometric unlock on use.
 *   2. ssh-agent or running gpg-agent with loaded keys. SSH preferred over GPG
 *      when both exist (simpler keyring, no expiry headaches).
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

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

const logger = getDefaultLogger()

interface CliArgs {
  check: boolean
  force: boolean
}

function parseArgs(argv: readonly string[]): CliArgs {
  return {
    check: argv.includes('--check'),
    force: argv.includes('--force'),
  }
}

type SigningFormat = 'ssh' | 'openpgp'

interface CurrentConfig {
  gpgsign: string
  signingkey: string
  format: string
}

function readCurrentConfig(): CurrentConfig {
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

interface DetectedSigner {
  format: SigningFormat
  // The literal `user.signingkey` value to set.
  key: string
  // Human-readable origin (1Password, ssh-agent, ~/.ssh/id_ed25519.pub, gpg).
  source: string
}

function detect1PasswordSshAgent(): DetectedSigner | undefined {
  // macOS: ~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock
  // Linux: ~/.1password/agent.sock
  // Windows: \\\\.\\pipe\\openssh-ssh-agent (different mechanism, skip detection)
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

function detectSshKeyOnDisk(): DetectedSigner | undefined {
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

function detectGpgKey(): DetectedSigner | undefined {
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

function detectSigner(): DetectedSigner | undefined {
  return detect1PasswordSshAgent() ?? detectSshKeyOnDisk() ?? detectGpgKey()
}

function configure(signer: DetectedSigner): void {
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

function reportConfig(c: CurrentConfig): void {
  logger.log(`  commit.gpgsign:   ${c.gpgsign || '(unset)'}`)
  logger.log(`  user.signingkey:  ${c.signingkey || '(unset)'}`)
  logger.log(`  gpg.format:       ${c.format}`)
}

function reportManualSteps(): void {
  logger.log('No usable signing key detected. Choose one:')
  logger.log('')
  logger.log('Option A — 1Password SSH signing (recommended)')
  logger.log('  1. Open 1Password → Settings → Developer → enable SSH agent')
  logger.log(
    '  2. Add SOCK to your shell: export SSH_AUTH_SOCK=~/Library/Group\\ Containers/2BUA8C4S2C.com.1password/t/agent.sock',
  )
  logger.log(
    '  3. Create or import an SSH key in 1Password → run this helper again',
  )
  logger.log('')
  logger.log('Option B — Existing SSH key on disk')
  logger.log('  1. Confirm ~/.ssh/id_ed25519.pub exists')
  logger.log('  2. Run this helper again')
  logger.log('')
  logger.log('Option C — GPG')
  logger.log(
    '  1. Generate: gpg --full-generate-key (RSA 4096 or Ed25519, no expiry preferred for personal use)',
  )
  logger.log('  2. Upload public key to GitHub → Settings → SSH and GPG keys')
  logger.log('  3. Run this helper again')
  logger.log('')
  logger.log('GitHub-side note: upload the corresponding PUBLIC key as a')
  logger.log(
    'Signing Key at https://github.com/settings/keys for "Verified" badges',
  )
  logger.log('on web-rendered commits.')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  logger.log('Commit signing — install / verify')
  logger.log('')

  const before = readCurrentConfig()
  logger.log('Current git config:')
  reportConfig(before)
  logger.log('')

  const alreadyConfigured =
    before.gpgsign.toLowerCase() === 'true' && Boolean(before.signingkey)
  if (alreadyConfigured && !args.force) {
    logger.log(
      'Signing is already configured. Pass --force to re-detect and overwrite.',
    )
    if (args.check) {
      process.exit(0)
    }
    process.exit(0)
  }

  if (args.check) {
    logger.log('Signing is NOT configured (or partial).')
    process.exit(1)
  }

  const signer = detectSigner()
  if (!signer) {
    reportManualSteps()
    process.exit(1)
  }

  logger.log(`Detected signer: ${signer.source} (${signer.format})`)
  logger.log(`Setting user.signingkey to:`)
  logger.log(`  ${signer.key}`)
  logger.log('')
  configure(signer)

  const after = readCurrentConfig()
  logger.log('Updated git config:')
  reportConfig(after)
  logger.log('')
  logger.log(
    'Done. The next commit will be signed automatically. Pre-commit and',
  )
  logger.log('pre-push gates will accept it.')
  logger.log('')
  logger.log('GitHub-side: upload the public key as a Signing Key at')
  logger.log('  https://github.com/settings/keys')
  logger.log('so commits show as "Verified" in the GitHub UI.')
}

main().catch(err => {
  logger.error(String(err?.message ?? err))
  process.exit(1)
})
