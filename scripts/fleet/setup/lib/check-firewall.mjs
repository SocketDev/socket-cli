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
 *   check-firewall.mjs <package-name> <version>
 */

import { argv, exit, stderr, stdout } from 'node:process'

const pkgName = argv[2]
const version = argv[3]
if (!pkgName || !version) {
  stderr.write('Usage: node check-firewall.mjs <package-name> <version>\n')
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
    // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- composite-action helper runs on the raw runner before setup-node; @socketsecurity/lib-stable not installed yet.
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
      for (const a of alerts.slice(0, 10)) {
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
    // oxlint-disable-next-line socket/prefer-error-message -- composite-action helper runs on the raw runner before setup-node; @socketsecurity/lib-stable/errors/message is not installed yet.
    const message = e instanceof Error ? e.message : String(e)
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
