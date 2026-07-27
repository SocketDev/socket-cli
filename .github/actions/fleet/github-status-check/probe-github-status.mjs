/**
 * @file GitHub platform-health probe for the fleet github-status-check
 *   action. Probes githubstatus.com/api/v2/components.json and emits a
 *   warning annotation when Actions, Git Operations, or API Requests are
 *   degraded — the job continues regardless, degraded != down, unless
 *   FAIL_ON_INCIDENT=true and a monitored component reports partial_outage
 *   or worse. Branch shape, unchanged from the inline bash `run:` block
 *   this was extracted from:
 *
 *   - probe failure — transport error, HTTP error, empty body — reports
 *     status=unknown with a warning annotation and exits 0; a status-page
 *     outage must never fail CI on its own.
 *   - only monitored components count; anything else in the payload is ignored,
 *     and a monitored component ABSENT from the payload simply contributes
 *     nothing.
 *   - worst-status fold: the highest severity_rank among monitored components
 *     wins; every non-operational monitored component lands in the space-joined
 *     summary.
 *   - shape drift — unparseable body, non-list components, a component missing
 *     id/status — TRUNCATES at the first bad component and reports from the
 *     prefix, exit 0. That is what the old step did: its python one-liner
 *     crashed mid-stream, the while-loop consumed the lines already printed,
 *     and `set -e` never saw the process-substitution exit. The diagnostic goes
 *     to stderr, standing in for the traceback. Co-located with the action and
 *     invoked via $GITHUB_ACTION_PATH so it travels when a member consumes the
 *     action — same shape as github-release-app-token's minter. Dependency-free
 *     on purpose: the action runs it on the runner's system Node BEFORE any
 *     install exists, so only `node:` builtins are used — same constraint as
 *     scripts/fleet/registry-liveness-gate.mjs. Node fetch stands in for the
 *     old `curl -sf --max-time 8`: same URL, same pass/fail mapping, transport
 *     errors swallowed the way `2>/dev/null || true` swallowed curl's. Pure
 *     decision functions are exported for the wheelhouse unit suite; the thin
 *     CLI shell at the bottom reads FAIL_ON_INCIDENT from the env, appends step
 *     outputs to GITHUB_OUTPUT, and exits non-zero only on the fail-on-incident
 *     path. Usage: FAIL_ON_INCIDENT=false node probe-github-status.mjs
 */

import { appendFileSync, realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const COMPONENTS_URL =
  'https://www.githubstatus.com/api/v2/components.json'

// curl carried `--max-time 8` so a slow status page doesn't stall CI.
export const PROBE_TIMEOUT_MS = 8000

/**
 * Human-readable name for a monitored component id, '' when the component
 * is not monitored — the same case-table the bash step used. Stable IDs
 * from the components API; names are output-only.
 */
export function monitoredName(id) {
  switch (id) {
    case 'br0l2tvcx85d':
      return 'Actions'
    case '8l4ygp009s5s':
      return 'Git Operations'
    case 'brv1bkgrwx7q':
      return 'API Requests'
    default:
      return ''
  }
}

/**
 * Severity rank, worst → best. Unknown status → 0, same as operational.
 */
export function severityRank(status) {
  switch (status) {
    case 'major_outage':
      return 4
    case 'partial_outage':
      return 3
    case 'degraded_performance':
      return 2
    case 'under_maintenance':
      return 1
    default:
      return 0
  }
}

/**
 * The `id|status` extraction the old step piped through python. Faithful to
 * the crash-mid-stream semantics of `[print(c["id"]+"|"+c["status"]) for c
 * in json.load(sys.stdin).get("components",[])]`: a missing `components`
 * key is an EMPTY list, not an error, while an unparseable body, a
 * non-object root, a non-list `components`, or a component without string
 * id + status stops extraction at that point — `entries` keeps the prefix
 * already extracted and `error` carries the diagnostic the traceback used
 * to carry. Callers report from the prefix and exit 0, exactly like the
 * old step, where `set -e` never saw the process-substitution exit.
 */
export function parseComponents(body) {
  const entries = []
  let root
  try {
    root = JSON.parse(body)
  } catch (error) {
    return {
      entries,
      error: `components.json did not parse — ${String(error)}`,
    }
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    return {
      entries,
      error: 'components.json root is not an object — cannot read components',
    }
  }
  const components = 'components' in root ? root.components : []
  if (!Array.isArray(components)) {
    return {
      entries,
      error: 'components.json "components" is not a list — cannot iterate',
    }
  }
  for (const component of components) {
    if (
      component === null ||
      typeof component !== 'object' ||
      typeof component.id !== 'string' ||
      typeof component.status !== 'string'
    ) {
      return {
        entries,
        error: `components.json entry ${entries.length} lacks a string id/status — reporting from the ${entries.length} component(s) before it`,
      }
    }
    entries.push({ id: component.id, status: component.status })
  }
  return { entries }
}

/**
 * The worst-status fold over extracted components. Unmonitored components
 * are skipped; the highest severity among monitored ones wins the status;
 * every non-operational monitored component is appended to the
 * space-joined message string — including unranked statuses, which message
 * but never outrank operational, exactly like the bash fold where
 * severity_rank's `*)` arm returned 0.
 */
export function assessComponents(entries) {
  let worstSeverity = 0
  let worstStatus = 'operational'
  const messages = []
  for (const { id, status } of entries) {
    const name = monitoredName(id)
    if (name === '') {
      continue
    }
    const severity = severityRank(status)
    if (severity > worstSeverity) {
      worstSeverity = severity
      worstStatus = status
    }
    if (status !== 'operational') {
      messages.push(`${name}: ${status}`)
    }
  }
  return { messages: messages.join(' '), worstSeverity, worstStatus }
}

/**
 * The report for a failed probe — transport error, HTTP error, or an empty
 * body, the exact cases where `curl -sf … || true` left RESPONSE empty.
 * Warn and continue: a status-page outage must never fail CI on its own.
 */
export function planUnreachable() {
  return {
    exitCode: 0,
    lines: [
      '::warning title=GitHub Status::githubstatus.com unreachable; CI results may be unreliable',
    ],
    outputs: {
      status: 'unknown',
      summary:
        '⚠️  githubstatus.com unreachable — cannot confirm GitHub health',
    },
  }
}

/**
 * The report for an assessed payload: step outputs, stdout lines —
 * annotations included — and the process exit code. Exit 1 only when
 * failOnIncident is set and the worst monitored severity is partial_outage
 * or worse.
 */
export function planReport(assessment, failOnIncident) {
  const { messages, worstSeverity, worstStatus } = assessment
  if (messages === '') {
    const summary = 'All monitored GitHub components operational'
    return {
      exitCode: 0,
      lines: [`ℹ️  ${summary}`],
      outputs: { status: 'operational', summary },
    }
  }
  const summary = `⚠️  ${messages}`
  const lines = [
    `::warning title=GitHub Status::${summary} — CI failures may be related to upstream degradation`,
  ]
  let exitCode = 0
  if (failOnIncident && worstSeverity >= severityRank('partial_outage')) {
    lines.push(
      `::error title=GitHub Status::${summary} — aborting due to fail-on-incident=true`,
    )
    exitCode = 1
  }
  return { exitCode, lines, outputs: { status: worstStatus, summary } }
}

// The default output sink: the step-scoped GITHUB_OUTPUT file, the
// destination of the old step's `echo "key=value" >> "$GITHUB_OUTPUT"`.
// A missing GITHUB_OUTPUT throws — outside Actions that is a caller bug,
// and the step's `set -e` treats the non-zero exit the way it treated the
// old step's `set -u` abort on the unbound variable.
function defaultAppendOutput(line) {
  const githubOutput = process.env.GITHUB_OUTPUT
  if (!githubOutput) {
    throw new Error(
      'GITHUB_OUTPUT is not set — the github-status-check probe writes step outputs. Fix: run via the fleet github-status-check action, which provides it.',
    )
  }
  appendFileSync(githubOutput, `${line}\n`)
}

/**
 * The whole probe: fetch the components payload, extract, assess, emit.
 * Injectable fetch + sinks keep it drivable end-to-end by the unit suite
 * with the network closed. Returns the process exit code.
 */
export async function runCheck({
  appendOutput = defaultAppendOutput,
  failOnIncident = process.env.FAIL_ON_INCIDENT === 'true',
  fetchImpl = fetch,
  log = console.log,
  logError = console.error,
} = {}) {
  let body = ''
  try {
    const response = await fetchImpl(COMPONENTS_URL, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (response.ok) {
      body = await response.text()
    }
  } catch {
    // Transport failure or timeout — the old `curl -sf … 2>/dev/null ||
    // true` swallowed these the same way; the unreachable report below is
    // the user-visible signal.
  }
  let report
  if (body === '') {
    report = planUnreachable()
  } else {
    const { entries, error } = parseComponents(body)
    if (error !== undefined) {
      // Stderr stand-in for the python traceback the old step leaked on
      // shape drift; stdout + outputs + exit code stay identical.
      logError(`⚠️  github-status-check: ${error}`)
    }
    report = planReport(assessComponents(entries), failOnIncident)
  }
  appendOutput(`status=${report.outputs.status}`)
  appendOutput(`summary=${report.outputs.summary}`)
  for (const line of report.lines) {
    log(line)
  }
  return report.exitCode
}

async function main() {
  process.exitCode = await runCheck()
}

// Realpath both sides — the naive argv[1] comparison is symlink-fragile, the
// same pitfall scripts/fleet/_shared/is-main-module.mts documents; that
// helper is .mts and this script must stay importless-runnable on system
// Node, so the comparison is inlined.
function isEntrypoint(invokedPath) {
  if (!invokedPath) {
    return false
  }
  try {
    return (
      realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
}

if (isEntrypoint(process.argv[1])) {
  void main()
}
