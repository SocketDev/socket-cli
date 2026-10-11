import crypto from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import {
  BASE_ASSET_SHA256,
  BASE_ASSETS_MIRROR_OWNER,
  BASE_ASSETS_MIRROR_REPO,
} from '../constants/sea-assets.mts'
import { SEA_BUILD_DIR } from './paths.mts'

export function verifySeaAsset(bytes: Uint8Array, expected: string): boolean {
  return crypto.createHash('sha256').update(bytes).digest('hex') === expected
}

export async function fetchSeaAsset(
  tag: keyof typeof BASE_ASSET_SHA256,
  name: string,
): Promise<string> {
  const pins = BASE_ASSET_SHA256[tag]
  const expected =
    pins && Object.hasOwn(pins, name) ? Reflect.get(pins, name) : undefined
  if (typeof expected !== 'string' || !expected) {
    throw new Error(
      `Unpinned SEA asset ${tag}/${name}. Add its verified SHA256 before building.`,
    )
  }
  const file = path.join(SEA_BUILD_DIR, name)
  let bytes: Uint8Array | undefined
  try {
    bytes = await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  if (!bytes || !verifySeaAsset(bytes, expected)) {
    const response = await httpRequest(
      `https://github.com/${BASE_ASSETS_MIRROR_OWNER}/${BASE_ASSETS_MIRROR_REPO}/releases/download/base-assets-${tag}/${name}`,
    )
    if (!response.ok) {
      throw new Error(
        `SEA download failed for ${name}: HTTP ${response.status}. Check GitHub availability.`,
      )
    }
    bytes = new Uint8Array(response.arrayBuffer())
    if (!verifySeaAsset(bytes, expected)) {
      throw new Error(
        `SEA asset digest mismatch for ${name}. Refusing unverified executable.`,
      )
    }
    await writeFile(file, bytes)
  }
  await chmod(file, 0o755)
  return file
}
