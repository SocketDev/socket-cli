import type { CResult } from '../../types.mts'

export async function scanReachability(cwd: string): Promise<CResult<unknown>> {
  console.log('Scanning now... as soon as you implement me! From', cwd)

  return { ok: true, data: undefined }
}
