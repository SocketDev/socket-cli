import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'

import type { ScriptMeta } from '../../fleet/process/run-main.mts'

export function checkFirewallBundle(manifest: {
  tools?: Record<string, unknown> | undefined
}): string[] {
  return manifest.tools && Object.hasOwn(manifest.tools, 'sfw')
    ? [
        'Socket Firewall must execute inside the CLI. Found an external sfw entry in packages/cli/bundle-tools.json. Remove that entry and use runFirewallCommand.',
      ]
    : []
}

export async function main(): Promise<void> {
  const filename = path.join(REPO_ROOT, 'packages', 'cli', 'bundle-tools.json')
  const findings = checkFirewallBundle(
    JSON.parse(await readFile(filename, 'utf8')),
  )
  if (process.argv.includes('--json')) {
    process.stdout.write(
      JSON.stringify({ ok: findings.length === 0, findings }) + '\n',
    )
  } else {
    for (const finding of findings) {
      process.stderr.write(`${finding}\n`)
    }
  }
  if (findings.length) {
    process.exitCode = 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'verifies that the CLI uses its embedded firewall instead of an external SFW binary',
  help: 'Usage: node scripts/repo/check/firewall-is-embedded.mts [--json]',
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
