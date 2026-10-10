import { existsSync, readdirSync, readFileSync } from 'node:fs'
import process from 'node:process'

import type { ReleaseAssetEntry } from './release-asset.mts'

export type PlatformEntry = ReleaseAssetEntry & { readonly asset: string }

interface GoOsArch {
  readonly arch: string
  readonly os: string
}

type PlatformKey = `${string}-${string}`

interface GoManifestFile {
  readonly arch?: string | undefined
  readonly filename?: string | undefined
  readonly kind?: string | undefined
  readonly os?: string | undefined
  readonly sha256?: string | undefined
}

interface GoManifestRelease {
  readonly files?: readonly GoManifestFile[] | undefined
  readonly stable?: boolean | undefined
  readonly version?: string | undefined
}

// Canonical → Go os/arch. Go ships no musl tarball — the glibc archive is
// statically linked and runs on musl too, so musl keys map to the glibc
// os/arch. Exported so the resolver and tests can assert the mapping.
export const GO_OS_ARCH = {
  __proto__: null,
  'darwin-arm64': { os: 'darwin', arch: 'arm64' },
  'darwin-x64': { os: 'darwin', arch: 'amd64' },
  'linux-arm64': { os: 'linux', arch: 'arm64' },
  'linux-arm64-musl': { os: 'linux', arch: 'arm64' },
  'linux-x64': { os: 'linux', arch: 'amd64' },
  'linux-x64-musl': { os: 'linux', arch: 'amd64' },
  'win32-arm64': { os: 'windows', arch: 'arm64' },
  'win32-x64': { os: 'windows', arch: 'amd64' },
} as unknown as Readonly<Partial<Record<PlatformKey, GoOsArch>>>

// Return the canonical Socket platform key for this runner.
export function canonicalPlatformKey(): string {
  const archMap = {
    __proto__: null,
    arm64: 'arm64',
    x64: 'x64',
  } as unknown as Readonly<Record<string, string>>
  const arch = archMap[process.arch]
  if (!arch) {
    throw new Error(`unsupported arch: ${process.arch}`)
  }
  let platform
  if (process.platform === 'darwin') {
    platform = 'darwin'
  } else if (process.platform === 'linux') {
    platform = 'linux'
  } else if (process.platform === 'win32') {
    platform = 'win32'
  } else {
    throw new Error(`unsupported platform: ${process.platform}`)
  }
  let suffix = ''
  if (platform === 'linux') {
    const report = process.report?.getReport?.() as
      | {
          readonly header?:
            | { readonly glibcVersionRuntime?: unknown | undefined }
            | undefined
        }
      | undefined
    const libc = report?.header?.glibcVersionRuntime
    if (libc === 'musl') {
      suffix = '-musl'
    } else if (!libc) {
      const isMusl = ['/lib', '/lib64'].some(directory => {
        if (!existsSync(directory)) {
          return false
        }
        try {
          return readdirSync(directory).some(file =>
            file.startsWith('ld-musl-'),
          )
        } catch {
          return false
        }
      })
      if (isMusl) {
        suffix = '-musl'
      }
    }
  }
  return `${platform}-${arch}${suffix}`
}

export function resolvePlatformEntry(
  platforms: Readonly<Partial<Record<PlatformKey, PlatformEntry>>>,
  canonicalKey: string,
): {
  readonly entry: PlatformEntry | undefined
  readonly fallbackKey: string | undefined
} {
  const entry = platforms[canonicalKey as PlatformKey]
  if (entry) {
    return { __proto__: null, entry, fallbackKey: undefined } as {
      readonly entry: PlatformEntry | undefined
      readonly fallbackKey: string | undefined
    }
  }
  if (canonicalKey.endsWith('-musl')) {
    const glibcKey = canonicalKey.slice(0, -5)
    const fallback = platforms[glibcKey as PlatformKey]
    if (fallback) {
      return { __proto__: null, entry: fallback, fallbackKey: glibcKey } as {
        readonly entry: PlatformEntry | undefined
        readonly fallbackKey: string | undefined
      }
    }
  }
  return { __proto__: null, entry: undefined, fallbackKey: undefined } as {
    readonly entry: PlatformEntry | undefined
    readonly fallbackKey: string | undefined
  }
}

export function readVersionFromFile(file: string): string {
  if (!file || !existsSync(file)) {
    return ''
  }
  const src = readFileSync(file, 'utf8')
  // oxlint-disable-next-line socket/require-regex-comment -- go.mod directive
  const match = /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(src)
  return match?.[1] ?? ''
}

export function resolveGoAssetFromManifest(
  manifest: unknown,
  version: string,
  canonicalKey: string,
): {
  readonly asset: string
  readonly integrity: string
  readonly version: string
} {
  const goOsArch = GO_OS_ARCH[canonicalKey as PlatformKey]
  if (!goOsArch) {
    throw new Error(`go: no os/arch mapping for ${canonicalKey}`)
  }
  const want = `go${version}`
  const release = Array.isArray(manifest)
    ? (manifest as readonly GoManifestRelease[]).find(
        item => item.version === want && item.stable,
      )
    : undefined
  if (!release) {
    throw new Error(
      `go.dev manifest has no stable release '${want}' (resolved version ${version})`,
    )
  }
  const file = Array.isArray(release.files)
    ? release.files.find(
        item =>
          item.os === goOsArch.os &&
          item.arch === goOsArch.arch &&
          item.kind === 'archive',
      )
    : undefined
  if (!file || !file.sha256 || !file.filename) {
    throw new Error(
      `go.dev release ${want} has no archive for ${goOsArch.os}-${goOsArch.arch}`,
    )
  }
  return {
    __proto__: null,
    asset: `https://go.dev/dl/${file.filename}`,
    integrity: `sha256-${file.sha256}`,
    version: String(version),
  } as {
    readonly asset: string
    readonly integrity: string
    readonly version: string
  }
}
