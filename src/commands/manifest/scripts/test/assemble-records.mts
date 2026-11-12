// Assemble a records file the way `socket manifest` does. The assembler throws on a resolved
// dependency no direct dependency of its project reaches, the manifest consumer's "orphaned
// component", but checks only the roots of known projects, so a root of any other project fails here.
import { readFileSync } from 'node:fs'

import { assembleFacts } from '../assemble.mts'
import { parseRecords } from '../records.mts'

const recordsFile = process.argv[2]
if (!recordsFile) {
  throw new Error('usage: assemble-records.mts <records.tsv>')
}
const parsed = parseRecords(readFileSync(recordsFile, 'utf8'))
for (const [rootId, root] of parsed.roots) {
  if (!parsed.projects.has(root.projectKey)) {
    throw new Error(
      `root ${rootId} belongs to ${root.projectKey}, which has no project record`,
    )
  }
}
assembleFacts(parsed, { fileExists: () => true })
console.log(`PASS (assembled): ${recordsFile}`)
