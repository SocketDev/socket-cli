/**
 * @fileoverview Output organization dependencies in various formats.
 */

import { simpleTable } from '../../utils/simple-output.mts'

import type { DependenciesResult } from './fetch-dependencies.mts'
import type { OutputKind } from '../../types.mts'

/**
 * Output organization dependencies in the specified format.
 */
export function outputDependencies(
  result: DependenciesResult,
  outputKind: OutputKind,
): void {
  if (outputKind === 'json') {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (outputKind === 'markdown') {
    console.log('## Organization Dependencies\n')
    if (result.dependencies.length === 0) {
      console.log('No dependencies found.\n')
      return
    }
    console.log('| Package | Version | Ecosystem | Direct |')
    console.log('|---------|---------|-----------|--------|')
    for (const dep of result.dependencies) {
      console.log(
        `| ${dep.name} | ${dep.version} | ${dep.ecosystem} | ${dep.directDependency ? 'Yes' : 'No'} |`
      )
    }
    return
  }

  // Default table output
  if (result.dependencies.length === 0) {
    console.log('No dependencies found.')
    return
  }

  const table = simpleTable({
    headers: ['Package', 'Version', 'Ecosystem', 'Direct'],
    rows: result.dependencies.map(dep => [
      dep.name,
      dep.version,
      dep.ecosystem,
      dep.directDependency ? 'Yes' : 'No',
    ]),
  })

  console.log(table)
}