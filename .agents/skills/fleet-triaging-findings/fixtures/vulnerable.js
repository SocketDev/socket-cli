// TRIAGE TEST FIXTURE — intentionally vulnerable. Not shipped, not imported,
// never executed. Used only by the triaging-findings smoke test so verifiers
// have real source to re-derive findings from. Two real bugs (command
// injection, SQL injection) and two scanner false positives (a non-security
// Math.random, an already-guarded deref). Line numbers are referenced by
// canary-findings.json; keep them stable or update the fixture in lock step.
//
// The shell/DB handles are local stubs so the fixture imports nothing — the
// vulnerable *shape* (untrusted input concatenated into a command / query) is
// what a verifier reads, without pulling in node:child_process for real.

const shell = { exec(command, callback) { callback(undefined, `ran: ${command}`) } }

// REAL: command injection — `host` is concatenated into a shell string.
export function runPing(host, callback) {
  shell.exec('ping -c 1 ' + host, callback)
}

// Pretend DB handle for the fixture.
const db = { query(sql, cb) { cb(undefined, [{ ran: sql }]) } }

// REAL: SQL injection — `username` is concatenated into the WHERE clause.
export function lookupUser(username, callback) {
  const sql = "SELECT * FROM users WHERE name = '" + username + "'"
  db.query(sql, callback)
}

const SAMPLE_WAVE = [0, 0.3, 0.6, 0.9, 0.6, 0.3]

// FALSE POSITIVE: Math.random picks a demo animation frame, not a token.
export function nextWaveSample() {
  const index = Math.floor(Math.random() * SAMPLE_WAVE.length)
  return SAMPLE_WAVE[index]
}

// FALSE POSITIVE: the deref the scanner flagged is already guarded above it.
export function getConfigValue(config) {
  if (!config) {
    return undefined
  }
  return config.value
}
