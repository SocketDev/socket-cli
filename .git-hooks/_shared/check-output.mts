import { readFileSync } from 'node:fs'
import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'

import { isDebugNs } from '@socketsecurity/lib-stable/debug/namespace'
import { debugNs } from '@socketsecurity/lib-stable/debug/output'

import { isMainModule } from '../../scripts/fleet/process/is-main-module.mts'

export const CHECK_DEBUG_NS = '*'

export function debugCheck(...args: unknown[]): void {
  if (isDebugNs(CHECK_DEBUG_NS)) {
    debugNs(CHECK_DEBUG_NS, ...args)
  }
}

export function showCheckOutput(status: number | null, output: string): void {
  if (!output) {
    return
  }
  if (
    status !== 0 ||
    // Keep incomplete gates, Node warning classes, and tool warning labels.
    /(?:NOT a pass|Warning:|\bwarn(?:ing)?s?\b)/i.test(
      stripVTControlCharacters(output).replace(/\b0 warnings?\b/gi, ''),
    )
  ) {
    process.stderr.write(output)
  } else if (isDebugNs(CHECK_DEBUG_NS)) {
    debugCheck(output.trimEnd())
  }
}

export function showCheckResult(result: {
  status: number | null
  stdout: string | Buffer | null
  stderr: string | Buffer | null
}): void {
  showCheckOutput(result.status, `${result.stdout ?? ''}${result.stderr ?? ''}`)
}

if (isMainModule(import.meta.url)) {
  showCheckOutput(
    Number(process.argv[2]),
    readFileSync(process.argv[3]!, 'utf8'),
  )
}
