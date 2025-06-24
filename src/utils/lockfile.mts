import { existsSync } from 'node:fs'

import { readFileUtf8 } from './fs.mts'

export async function readLockfile(
  lockfilePath: string,
): Promise<string | null> {
  return existsSync(lockfilePath) ? await readFileUtf8(lockfilePath) : null
}
