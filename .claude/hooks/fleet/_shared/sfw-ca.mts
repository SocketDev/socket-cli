#!/usr/bin/env node
/**
 * @file The persistent Socket Firewall CA — one source of truth for its
 *   on-disk location, the env pair that points sfw at it, and the shell
 *   fragments every wrapper/rc surface embeds.
 *   Why this exists: sfw regenerates a CA into a FRESH temp dir on every
 *   invocation unless BOTH `SFW_CA_CERT_PATH` and `SFW_CA_KEY_PATH` point at
 *   files that already exist (firewall `src/lib/cli/cliCaKeyPair.ts`
 *   `getCaKeyPair`). An ephemeral CA can never be added to an OS trust store,
 *   so every client that carries its OWN TLS stack — pnpm's Rust tarball
 *   fetcher, cargo, uv, Go, git — fails `UnknownIssuer` on a fresh download.
 *   Node clients survive only because sfw also injects `NODE_EXTRA_CA_CERTS`.
 *   Pinning the pair to a stable per-user path makes the CA trustable ONCE.
 *   Deliberately NOT part of `FLEET_ENV` (fleet-env.mts): those knobs are
 *   static, universal, and REQUIRED in every CI workflow env by
 *   `workflow-envs-have-full-fleet-env`. The CA pair is machine-local and
 *   conditional — CI has no CA — so it ships as its own list, emitted behind an
 *   existence guard, and the CI gates stay honest.
 *   Listed alphabetically by name (fleet `socket/sort-*` convention).
 */

import path from 'node:path'
import process from 'node:process'

import { getSocketWheelhouseDir } from '@socketsecurity/lib-stable/paths/socket'

/**
 * The certificate's Common Name. Matches the firewall's own generator
 * (`src/lib/util/genCaKeyPair.ts` `CA_ATTRS`) so a cert this repo generates is
 * indistinguishable from one sfw would have produced — and so the macOS
 * already-trusted probe (`security find-certificate -c Socket`) finds it.
 */
export const SFW_CA_COMMON_NAME = 'Socket Security CA'

/**
 * The env-var names sfw reads to adopt an existing CA pair instead of
 * generating a throwaway one. Both must be set AND both files must exist, or
 * sfw falls back to the temp-dir pair.
 */
export const SFW_CA_ENV_NAMES = ['SFW_CA_CERT_PATH', 'SFW_CA_KEY_PATH'] as const

/**
 * The certificate's Organization. Pairs with `SFW_CA_COMMON_NAME` to form the
 * openssl `-subj` string.
 */
export const SFW_CA_ORGANIZATION = 'Socket Security'

/**
 * The basename both CA files share. Matches the firewall generator's
 * `baseFilename` default, so the paths read the same in its docs and ours.
 */
export const SFW_CA_BASENAME = 'socketFirewallCa'

/**
 * The openssl `-subj` string for the CA certificate.
 */
export const SFW_CA_SUBJECT = `/CN=${SFW_CA_COMMON_NAME}/O=${SFW_CA_ORGANIZATION}`

/**
 * The CA directory relative to the user's home, POSIX separators. The shell
 * fragments below need a HOME-relative form (one generated wrapper has to be
 * correct for whoever runs it), while the Node side resolves an absolute path
 * through `getSocketWheelhouseDir()`. `sfw-ca-env-is-wired` asserts the two
 * agree, so the layout can only move in one place.
 */
export const SFW_CA_HOME_RELATIVE_DIR = '.socket/_wheelhouse/ca'

/**
 * The CA cert path as a POSIX shell expression — `$HOME` expands at run time,
 * so the wrapper that embeds it is user-agnostic.
 */
export const SFW_CA_POSIX_CERT = `$HOME/${SFW_CA_HOME_RELATIVE_DIR}/${SFW_CA_BASENAME}.crt`

/**
 * The CA key path as a POSIX shell expression.
 */
export const SFW_CA_POSIX_KEY = `$HOME/${SFW_CA_HOME_RELATIVE_DIR}/${SFW_CA_BASENAME}.key`

/**
 * The CA cert path as a `cmd.exe` expression.
 */
export const SFW_CA_WINDOWS_CERT = `%USERPROFILE%\\${SFW_CA_HOME_RELATIVE_DIR.replace(/\//g, '\\')}\\${SFW_CA_BASENAME}.crt`

/**
 * The CA key path as a `cmd.exe` expression.
 */
export const SFW_CA_WINDOWS_KEY = `%USERPROFILE%\\${SFW_CA_HOME_RELATIVE_DIR.replace(/\//g, '\\')}\\${SFW_CA_BASENAME}.key`

/**
 * The directory holding the persistent CA pair. Lives under the wheelhouse
 * umbrella (`~/.socket/_wheelhouse/ca`), NOT `~/.socket/sfw` — that path is
 * `LEGACY_SFW_DIR` in `scripts/fleet/install-sfw.mts`, which
 * `ensureWheelhouseLayout()` renames to the umbrella on any machine that has
 * not migrated yet. A CA parked there would move out from under the trust
 * store the operator just populated.
 */
export function getSfwCaDir(): string {
  return path.join(getSocketWheelhouseDir(), 'ca')
}

/**
 * The racked sfw binary the wrappers hand off to — the one whose behavior
 * decides whether the persistent pair is honored or ignored.
 */
export function getSfwBinaryPath(): string {
  return path.join(
    getSocketWheelhouseDir(),
    'bin',
    process.platform === 'win32' ? 'sfw.exe' : 'sfw',
  )
}

/**
 * Absolute path of the persistent CA certificate (world-readable, 0644 — it is
 * the public half and every client must read it).
 */
export function getSfwCaCertPath(): string {
  return path.join(getSfwCaDir(), `${SFW_CA_BASENAME}.crt`)
}

/**
 * Absolute path of the persistent CA private key (owner-only, 0600 — anyone
 * holding it can impersonate the proxy).
 */
export function getSfwCaKeyPath(): string {
  return path.join(getSfwCaDir(), `${SFW_CA_BASENAME}.key`)
}

/**
 * The POSIX-shell fragment that exports the CA pair, guarded so it is inert on
 * a machine that has not run `setup:sfw-ca`. The guard is evaluated at RUN
 * time, in the shell — not at generation time — so one generated wrapper is
 * correct both before and after the CA is created, and no regeneration is
 * needed when it appears.
 *
 * Embedded verbatim by the sfw wrapper generator
 * (`scripts/fleet/setup/tools-sfw.mjs`) and the shell-rc bridge
 * (`.claude/hooks/fleet/setup-security-tools/lib/shell-rc-bridge.mts`);
 * `sfw-ca-env-is-wired` asserts both still carry it.
 */
export function sfwCaPosixExportLines(): string[] {
  const certPath = SFW_CA_POSIX_CERT
  const keyPath = SFW_CA_POSIX_KEY
  return [
    '# Socket Firewall persistent CA — point sfw at a STABLE pair so the cert',
    '# can live in the OS trust store. Without it sfw mints a throwaway CA per',
    "# invocation and every non-Node client (pnpm's Rust tarball fetcher,",
    '# cargo, uv, go, git) fails TLS with UnknownIssuer. Guarded: a machine',
    '# that has not run `pnpm run setup:sfw-ca` is left exactly as it was.',
    `if [ -r "${certPath}" ] && [ -r "${keyPath}" ]; then`,
    `  export ${SFW_CA_ENV_NAMES[0]}="${certPath}"`,
    `  export ${SFW_CA_ENV_NAMES[1]}="${keyPath}"`,
    'fi',
  ]
}

/**
 * The `cmd.exe` counterpart of `sfwCaPosixExportLines`. Batch has no `&&`
 * short-circuit over `if exist`, so the guard is a skip-label: any missing half
 * jumps past both `set` lines. The label is unique within the generated shim.
 */
export function sfwCaWindowsExportLines(): string[] {
  const certPath = SFW_CA_WINDOWS_CERT
  const keyPath = SFW_CA_WINDOWS_KEY
  return [
    'rem Socket Firewall persistent CA — see sfwCaPosixExportLines for why.',
    `if not exist "${certPath}" goto :sfwcadone`,
    `if not exist "${keyPath}" goto :sfwcadone`,
    `set "${SFW_CA_ENV_NAMES[0]}=${certPath}"`,
    `set "${SFW_CA_ENV_NAMES[1]}=${keyPath}"`,
    ':sfwcadone',
  ]
}

/**
 * The command that adds the CA to the OS trust store, for `platform`. Printed
 * for the operator — NEVER run: every variant needs root, and silently taking
 * sudo on someone's machine to install a root CA is not a setup script's call.
 * Sourced from the firewall's `docs/Client-Setup.md`.
 */
export function sfwCaTrustCommandLines(
  platform: NodeJS.Platform,
  certPath: string,
): string[] {
  if (platform === 'darwin') {
    return [
      `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${certPath}`,
    ]
  }
  if (platform === 'linux') {
    return [
      '# Debian / Ubuntu:',
      `sudo cp ${certPath} /usr/local/share/ca-certificates/${SFW_CA_BASENAME}.crt`,
      'sudo update-ca-certificates',
      '',
      '# RHEL / CentOS / Fedora:',
      `sudo cp ${certPath} /etc/pki/ca-trust/source/anchors/${SFW_CA_BASENAME}.crt`,
      'sudo update-ca-trust',
    ]
  }
  if (platform === 'win32') {
    return [
      '# PowerShell, elevated:',
      `Import-Certificate -FilePath "${certPath}" -CertStoreLocation Cert:\\LocalMachine\\Root`,
    ]
  }
  return [
    `# No OS trust-store recipe for ${platform}; add ${certPath} as a trusted root manually.`,
  ]
}

/**
 * What CA a wrapped child actually receives.
 *
 * `persistent` — sfw handed the child the stable pair; the wiring is live and
 * the OS-trust step is worth taking.
 * `ephemeral` — sfw minted a throwaway CA anyway. The env wiring is INERT.
 * `unknown` — no sfw binary, or the probe could not be read.
 */
export type SfwCaDelivery = 'ephemeral' | 'persistent' | 'unknown'

/**
 * Why a persistent CA can be present, correctly exported, and still unused.
 *
 * The shipped free build hardcodes an EMPTY external config at the CA call site
 * (`src/sfw-free/cli.ts` → `getCaKeyPair(tmpdir, false, {})`), so
 * `SFW_CA_CERT_PATH` is not read at all in wrapper mode — it is then
 * OVERWRITTEN in the child env with the throwaway path sfw just minted. The
 * enterprise entrypoint passes the real external config, so this is a build
 * property, not a configuration mistake on the operator's side.
 *
 * Until a firewall build that honors the pair is racked, generating and
 * trusting a persistent CA changes nothing at runtime.
 */
export const SFW_CA_INERT_REASON =
  'the shipped sfw build ignores SFW_CA_CERT_PATH in wrapper mode — its free ' +
  'entrypoint calls getCaKeyPair(tmpdir, false, {}) with an empty external ' +
  'config, mints a throwaway CA, and overwrites the env pair in the child'

/**
 * The argv that asks a wrapped child which CA it was handed. Run as
 * `<sfwBin> <...sfwCaChildProbeArgs(nodeBin)>`; the child prints one line whose
 * value is the cert path sfw injected, or an empty string.
 */
export function sfwCaChildProbeArgs(nodeBin: string): string[] {
  return [
    nodeBin,
    '-e',
    `process.stdout.write("${SFW_CA_PROBE_PREFIX}" + (process.env.SSL_CERT_FILE ?? ""))`,
  ]
}

/**
 * The marker the probe child prints before the cert path, so the value can be
 * lifted out of sfw's own banner output.
 */
export const SFW_CA_PROBE_PREFIX = 'sfw-ca-child-cert='

/**
 * The cert path a probe child reported, or `undefined` when the marker is
 * absent (sfw failed, or printed nothing).
 */
export function parseSfwCaProbeOutput(stdout: string): string | undefined {
  const at = stdout.lastIndexOf(SFW_CA_PROBE_PREFIX)
  if (at === -1) {
    return undefined
  }
  const value = stdout.slice(at + SFW_CA_PROBE_PREFIX.length).split('\n')[0]!
  return value.trim() === '' ? undefined : value.trim()
}

/**
 * Classify what the child actually got. An empty or unreadable probe is
 * `unknown` — never `persistent`, because an unverified mechanism must not
 * report itself working.
 */
export function classifySfwCaDelivery(
  childCertPath: string | undefined,
  persistentCertPath: string,
): SfwCaDelivery {
  if (!childCertPath) {
    return 'unknown'
  }
  return childCertPath === persistentCertPath ? 'persistent' : 'ephemeral'
}

/**
 * The read-only probe that reports whether the CA is already in the OS trust
 * store, or `undefined` where no scriptable probe exists. Exit status 0 with
 * non-empty stdout means trusted.
 */
export function sfwCaTrustProbe(
  platform: NodeJS.Platform,
): { args: string[]; command: string } | undefined {
  if (platform === 'darwin') {
    return {
      args: [
        'find-certificate',
        '-c',
        SFW_CA_COMMON_NAME,
        '/Library/Keychains/System.keychain',
      ],
      command: 'security',
    }
  }
  return undefined
}
