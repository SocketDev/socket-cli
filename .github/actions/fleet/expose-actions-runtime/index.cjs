// Bridge the runner-injected cache-service credentials into the job env so a
// composite's `run:` steps (the fleet cache CLIs) can reach the v2 cache
// service. Zero dependencies on purpose: a JS action runs from committed
// source with no install step. Values land via the GITHUB_ENV heredoc form,
// and the token is masked first.
'use strict'

const { appendFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')

function main() {
  const url = process.env.ACTIONS_RESULTS_URL ?? ''
  const token = process.env.ACTIONS_RUNTIME_TOKEN ?? ''
  const envFile = process.env.GITHUB_ENV ?? ''
  if (!url || !token || !envFile) {
    // Fail soft: outside a real Actions job there is nothing to expose, and
    // the cache CLIs already treat a missing service as a warned no-op.
    process.stdout.write(
      '::warning::expose-actions-runtime: runner did not inject ACTIONS_RESULTS_URL/ACTIONS_RUNTIME_TOKEN — cache steps will run cold\n',
    )
    return
  }
  process.stdout.write(`::add-mask::${token}\n`)
  const lines = []
  for (const [name, value] of [
    ['ACTIONS_RESULTS_URL', url],
    ['ACTIONS_RUNTIME_TOKEN', token],
  ]) {
    const delimiter = `ghadelimiter_${randomUUID()}`
    lines.push(`${name}<<${delimiter}`, value, delimiter)
  }
  appendFileSync(envFile, `${lines.join('\n')}\n`)
}

main()
