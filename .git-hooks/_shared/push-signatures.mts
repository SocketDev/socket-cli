// Pre-push commit-signature gate. Requires a verified signature on every commit
// pushed to a protected ref, default branch, and — when SSH signing is
// configured with an allowed_signers file — cross-checks each signing key
// against that allowlist.

import { existsSync, readFileSync } from 'node:fs'

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { git, gitLines } from './git.mts'

const logger = getDefaultLogger()

// Scans every commit in the range to require a verified signature
// when pushing to a protected ref, default branch. Block on `N`
// no signature, and `B` (bad/unverifiable) — but allow other
// markers like `G` (good GPG sig), `U` (good GPG sig, unknown trust),
// `E`, missing-key but otherwise valid, `X` (good signature on
// expired key), `Y`/`R` (revoked/expired key with good signature).
//
// Why pre-push and not just rely on GitHub branch protection? The
// fleet enforces branch protection too (lint-github-settings.mts
// audits `required_signatures: true`), but a local pre-push fail
// gives faster feedback (no round-trip to GitHub) and catches the
// case where branch protection is being set up but not yet active
// on a freshly-created fleet repo.

// Parse the SSH allowed_signers file referenced by
// `git config --get gpg.ssh.allowedSignersFile`. Returns the set of
// public-key BLOBS (the same format `git log --format=%GK` emits for
// SSH-signed commits — `<key-type> <base64-key>`).
//
// Returns an empty set if:
//   - gpg.format isn't 'ssh', allowed-signers only applies to SSH-format
//   - gpg.ssh.allowedSignersFile is unset
//   - the file doesn't exist or can't be read
// An empty set means "don't enforce" — the %G? marker check alone
// remains active. This degrades gracefully on first install before
// the user has set up allowed_signers.
export const readAllowedSignerKeys = (): Set<string> => {
  const out = new Set<string>()
  try {
    const fmt = git('config', '--get', 'gpg.format').trim()
    if (fmt !== 'ssh') {
      return out
    }
    const file = git('config', '--get', 'gpg.ssh.allowedSignersFile').trim()
    if (!file) {
      return out
    }
    const expanded = file.startsWith('~')
      ? file.replace(/^~/, process.env['HOME'] ?? '')
      : file
    if (!existsSync(expanded)) {
      return out
    }
    // allowed_signers file format: `<principal> [<options>] <key-type> <base64-key>`
    // %GK emits `<key-type> <base64-key>`, no principal. We extract
    // the last two whitespace-separated tokens of each line.
    const text = readFileSync(expanded, 'utf8')
    const rawLines = text.split('\n')
    for (let i = 0, { length } = rawLines; i < length; i += 1) {
      const rawLine = rawLines[i]!
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) {
        continue
      }
      const tokens = line.split(/\s+/)
      if (tokens.length < 3) {
        continue
      }
      const keyType = tokens[tokens.length - 2]!
      const keyBlob = tokens[tokens.length - 1]!
      out.add(`${keyType} ${keyBlob}`)
    }
  } catch {
    // best-effort; absence of allowed-signers shouldn't crash the hook
  }
  return out
}

export const scanSignedCommits = (range: string, remoteRef: string): number => {
  // Only enforce on default-branch refs (main / master). Feature
  // branches and topic branches can stay unsigned during development;
  // signing is required at the point of landing on the protected ref.
  const refBase = remoteRef.replace(/^refs\/heads\//, '')
  if (refBase !== 'main' && refBase !== 'master') {
    return 0
  }
  logger.info('Checking commit signatures…')
  // %G? — signature verification marker (G/U/E/X/Y/R/N/B).
  // %GK — signing key fingerprint, empty if unsigned.
  // %GS — signer name, from key user-id.
  // Cross-check %GK against gpg.ssh.allowedSignersFile when configured
  // and `gpg.format = ssh`. For gpg-format signatures, %G? alone
  // reflects the local keyring's trust, which is sufficient for our
  // threat model (the attacker would need to control the dev's
  // ~/.gnupg, at which point the local box is fully owned).
  const lines = gitLines('log', '--format=%H %G? %GK', range)
  const allowedSigners = readAllowedSignerKeys()
  let errors = 0
  const unsigned: string[] = []
  const unauthorized: string[] = []
  for (const line of lines) {
    const parts = line.split(' ')
    const sha = parts[0]
    const marker = parts[1]
    const signerKey = parts.slice(2).join(' ').trim()
    if (!sha || !marker) {
      continue
    }
    // `N` = no signature. `B` = bad signature. Both block.
    if (marker === 'B' || marker === 'N') {
      unsigned.push(sha)
      errors++
      continue
    }
    // Allowed-signers cross-check, SSH-signed commits only. `G`
    // means git verified the signature against SOME key it trusts —
    // but "any trusted key" includes attacker-controlled keys on a
    // compromised dev machine. The authorized-signer file pins down
    // which keys we accept for the protected branch.
    if (
      allowedSigners.size > 0 &&
      signerKey &&
      !allowedSigners.has(signerKey)
    ) {
      unauthorized.push(`${sha} (signed by ${signerKey.slice(0, 16)}…)`)
      errors++
    }
  }
  if (unauthorized.length > 0) {
    logger.error(
      `${unauthorized.length} commit(s) signed by a key NOT in gpg.ssh.allowedSignersFile:`,
    )
    for (let i = 0, { length } = unauthorized; i < length; i += 1) {
      const u = unauthorized[i]!
      logger.error(`  ${u}`)
    }
  }
  if (errors === 0) {
    return 0
  }
  logger.fail(`${errors} unsigned commit(s) being pushed to ${refBase}.`)
  const shaList = unsigned.slice(0, 5)
  for (let j = 0, { length: jlen } = shaList; j < jlen; j += 1) {
    const sha = shaList[j]!
    const oneline = git('log', '-1', '--oneline', sha)
    logger.info(`  - ${oneline}`)
  }
  if (unsigned.length > 5) {
    logger.info(`  ... and ${unsigned.length - 5} more`)
  }
  logger.info('')
  logger.info('Fix: rebase + re-sign the commits.')
  logger.info(`  git rebase --exec 'git commit --amend --no-edit -S' <base>`)
  return errors
}
