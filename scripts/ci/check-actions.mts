import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parse } from 'yaml'

import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

export function externalActionReferences(document: unknown): string[] {
  if (Array.isArray(document)) {
    return document.flatMap(externalActionReferences)
  }
  if (document === null || typeof document !== 'object') {
    return []
  }
  const result: string[] = []
  for (const [key, value] of Object.entries(document)) {
    if (
      key === 'uses' &&
      typeof value === 'string' &&
      !value.startsWith('./')
    ) {
      result.push(value)
    } else {
      result.push(...externalActionReferences(value))
    }
  }
  return result
}

export function checkWorkflowActions(directory: string): string[] {
  const findings: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      findings.push(...checkWorkflowActions(filename))
    } else if (/\.ya?ml$/.test(entry.name)) {
      const references = externalActionReferences(
        parse(readFileSync(filename, 'utf8')),
      )
      findings.push(...references.map(reference => `${filename}: ${reference}`))
    }
  }
  return findings
}

if (isMainModule(import.meta.url)) {
  runMain(
    () => {
      const findings = checkWorkflowActions('.github')
      if (process.argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify({ findings })}\n`)
      } else if (findings.length) {
        process.stderr.write(
          `External actions found in workflow definitions: ${findings.join(', ')}. Use repository-owned steps.\n`,
        )
      }
      return findings.length ? 1 : 0
    },
    {
      describe:
        'Reject external actions in workflow and local action definitions',
      help: 'Usage: pnpm run check:actions [--json]',
    },
  )
}
