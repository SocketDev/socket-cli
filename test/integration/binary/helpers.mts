import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

export const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
export const logger = getDefaultLogger()

export interface BinaryConfig {
  name: string
  path: string
  buildCommand: undefined
  enabled: boolean
}

export async function prepareBinary(binary: BinaryConfig): Promise<boolean> {
  if (!existsSync(binary.path)) {
    throw new Error(
      `CLI artifact missing at ${binary.path}. Expected the built JavaScript CLI. Run pnpm run build before integration tests.`,
    )
  }
  return true
}
