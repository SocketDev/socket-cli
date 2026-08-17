/**
 * @file Emit the fleet no-phone-home env knobs as `NAME=value` lines for
 *   `$GITHUB_ENV`. The setup action's FIRST step pipes this into that file, so
 *   every later step in the composite and every later step in the job inherits
 *   the posture. That includes the composite's own `pnpm install`, which is the
 *   step `NO_UPDATE_NOTIFIER` exists for. Reads `fleet-env.json` beside this
 *   file, which is THE list. A workflow gets every knob by running setup,
 *   instead of hand-copying an `env:` block that drifts — the duplication that
 *   let `OTEL_SDK_DISABLED` reach ci.yml and miss github-release.yml.
 *   Dependency-free by requirement, not preference: this runs on the runner's
 *   system Node before any install, so it may use only `node:` builtins. That
 *   is also why the error text uses String(e) rather than importing the fleet
 *   errorMessage helper: that import would not resolve here. Fails LOUD. A
 *   silent empty emit would leave a runner with no posture at all while every
 *   step reported success, which is the exact shape the fail-closed rule exists
 *   to prevent.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Parse the knob list, rejecting anything that would emit a malformed line.
 */
export function parseKnobs(text, source) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new Error(
      `What: ${source} is not valid JSON.\nWhere: export-fleet-env.mjs.\nSaw: ${String(e)}\nFix: repair the file; it is the single source for the fleet env posture.`,
    )
  }
  const knobs = parsed?.knobs
  if (!Array.isArray(knobs) || knobs.length === 0) {
    throw new Error(
      `What: ${source} declares no env knobs.\nWhere: export-fleet-env.mjs.\nSaw: knobs=${JSON.stringify(knobs)} — wanted a non-empty array.\nFix: an empty list would leave the runner with no no-phone-home posture, so this refuses rather than exporting nothing.`,
    )
  }
  for (const knob of knobs) {
    // A newline in either field would forge extra $GITHUB_ENV entries.
    if (
      typeof knob?.name !== 'string' ||
      typeof knob?.value !== 'string' ||
      knob.name.length === 0 ||
      /[\r\n=]/.test(knob.name) ||
      /[\r\n]/.test(knob.value)
    ) {
      throw new Error(
        `What: a knob entry is unusable.\nWhere: ${source}.\nSaw: ${JSON.stringify(knob)} — wanted string name and value, no newline, no "=" in the name.\nFix: correct the entry; a newline here would forge extra $GITHUB_ENV lines.`,
      )
    }
  }
  return knobs
}

/**
 * The `NAME=value` lines, in file order.
 */
export function renderGithubEnv(knobs) {
  return knobs.map(knob => `${knob.name}=${knob.value}`)
}

export function main() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const source = path.join(here, 'fleet-env.json')
  const knobs = parseKnobs(readFileSync(source, 'utf8'), source)
  process.stdout.write(`${renderGithubEnv(knobs).join('\n')}\n`)
}

// Only the direct invocation emits; importing this in a test must stay silent.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main()
}
