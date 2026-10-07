/**
 * @file Check a Socket package against the firewall API before downloading its
 *   tarball directly from the npm registry. Endpoint: GET
 *   https://firewall-api.socket.dev/purl/<encoded-purl> Response: { alerts?: [{
 *   severity?, type?, key? }, ...] } Socket Firewall is a malware detector. The
 *   API returns alerts only when a package is flagged as malicious — there's no
 *   "minor severity informational alert" tier. ANY alert in the response means
 *   malware, regardless of severity / type / key fields. Block unconditionally.
 *   Exits 0 if the firewall returned no alerts, OR if the firewall is
 *   unreachable / non-2xx (non-fatal so a network blip doesn't break a fresh
 *   clone). Exits 1 if the firewall returned any alert at all. Usage: node
 *   check/sfw.mjs <package-name> <version>
 */

import { argv, exit, stderr, stdout } from 'node:process'

import { errorMessage } from '../error-message.mjs'

const pkgName = argv[2]
const version = argv[3]
if (!pkgName || !version) {
  stderr.write('Usage: node check/sfw.mjs <package-name> <version>\n')
  exit(2)
}

const FIREWALL_API_URL = 'https://firewall-api.socket.dev/purl'
const FIREWALL_TIMEOUT_MS = 10_000

const purl = `pkg:npm/${pkgName}@${version}`
const url = `${FIREWALL_API_URL}/${encodeURIComponent(purl)}`

async function main() {
  const controller = new AbortController()
  // unref so the timer doesn't keep the event loop alive past
  // main() resolution.
  const timer = setTimeout(() => controller.abort(), FIREWALL_TIMEOUT_MS)
  timer.unref?.()
  try {
    // Composite-action helper runs on the raw runner before setup-node, so
    // @socketsecurity/lib-stable is not installed yet.
    // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- dep-0
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'socket-registry-setup-action/1.0',
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      stderr.write(
        `firewall-api: HTTP ${res.status} for ${purl} — proceeding anyway (non-fatal)\n`,
      )
      return 0
    }
    const data = await res.json()
    const alerts = data.alerts ?? []
    if (alerts.length > 0) {
      // Any alert from the firewall means malware. Block unconditionally;
      // do not branch on severity / type / key.
      stderr.write(
        `\n✗ Socket Firewall flagged ${pkgName}@${version} as malware (${alerts.length} alert(s)):\n`,
      )
      const shown = alerts.slice(0, 10)
      for (let i = 0, { length } = shown; i < length; i += 1) {
        const a = shown[i]
        stderr.write(
          `    ${a.type ?? a.key ?? 'malware'}${a.severity ? ` (${a.severity})` : ''}\n`,
        )
      }
      stderr.write(
        '\nFix: bump the pinned version in pnpm-workspace.yaml or package.json to a known-good release.\n',
      )
      return 1
    }
    stdout.write(`✓ ${pkgName}@${version} cleared by Socket Firewall\n`)
    return 0
  } catch (e) {
    clearTimeout(timer)
    // Firewall errors are non-fatal — allow bootstrap to proceed.
    // Network blips or registry-down shouldn't break a fresh clone.
    const message = errorMessage(e)
    stderr.write(`firewall-api: ${message} — proceeding anyway (non-fatal)\n`)
    return 0
  }
}

// Use exitCode + natural drain instead of process.exit() so libuv
// can finish closing the fetch handles cleanly. process.exit() while
// async handles are mid-shutdown trips an `Assertion failed:
// !(handle->flags & UV_HANDLE_CLOSING)` abort on Node 24 + Windows.
main().then(code => {
  process.exitCode = code
})
