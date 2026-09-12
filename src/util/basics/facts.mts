import { promises as fs } from 'node:fs'
import { debugNs } from '@socketsecurity/lib-stable/debug/output'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

export async function parseSocketFacts(factsPath: string): Promise<{
  containers?: number | undefined
  error?: string | undefined
  sast?: number | undefined
  secrets?: number | undefined
}> {
  try {
    const factsContent = await fs.readFile(factsPath, 'utf8')

    if (!factsContent || factsContent.trim() === '') {
      debugNs('error', 'Socket facts file is empty')
      return {
        error: 'Facts file is empty',
      }
    }

    let facts: {
      findings?:
        | {
            containers?: unknown[] | undefined
            sast?: unknown[] | undefined
            secrets?: unknown[] | undefined
          }
        | undefined
    }
    try {
      facts = JSON.parse(factsContent)
    } catch (parseError) {
      debugNs('error', 'Failed to parse socket facts JSON:', parseError)
      return {
        error: `Invalid JSON: ${errorMessage(parseError)}`,
      }
    }

    // Extract finding counts from socket-basics output format.
    // The exact structure depends on socket-basics implementation.
    return {
      containers: facts.findings?.containers?.length || 0,
      sast: facts.findings?.sast?.length || 0,
      secrets: facts.findings?.secrets?.length || 0,
    }
  } catch (e) {
    debugNs('error', 'Failed to read socket facts file:', e)
    return {
      error: `File read error: ${errorMessage(e)}`,
    }
  }
}
