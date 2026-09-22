import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parse } from 'yaml'

import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

export function disallowedActionReferences(document: unknown): string[] {
  if (Array.isArray(document)) {
    return document.flatMap(disallowedActionReferences)
  }
  if (document === null || typeof document !== 'object') {
    return []
  }
  const result: string[] = []
  for (const [key, value] of Object.entries(document)) {
    if (
      key === 'uses' &&
      typeof value === 'string' &&
      !/^\.\/\.github\/actions\/repo\/[\da-z][\w.-]*(?:\/[\da-z][\w.-]*)*$/i.test(
        value,
      )
    ) {
      result.push(value)
    } else {
      result.push(...disallowedActionReferences(value))
    }
  }
  return result
}

export function checkWorkflowActions(directory: string): string[] {
  if (lstatSync(directory).isSymbolicLink()) {
    return [`${directory}: symbolic links are not permitted`]
  }
  const findings: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      findings.push(`${filename}: symbolic links are not permitted`)
    } else if (entry.isDirectory()) {
      findings.push(...checkWorkflowActions(filename))
    } else if (/\.ya?ml$/.test(entry.name)) {
      const references = disallowedActionReferences(
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
          `Disallowed actions or symbolic links found: ${findings.join(', ')}. Use steps under ./.github/actions/repo/ without traversal or symbolic links.\n`,
        )
      }
      return findings.length ? 1 : 0
    },
    {
      describe:
        'Reject actions outside the repository action directory and symbolic links',
      help: 'Usage: pnpm run check:actions [--json]',
    },
  )
}
