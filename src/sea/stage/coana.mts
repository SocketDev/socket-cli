import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { x as extractTar } from 'tar'

import { getDefaultOrgSlug } from '../../commands/ci/fetch-default-org-slug.mts'
import { COANA_CLI_VERSION } from '../../constants.mts'
import { apiFetch, sendApiRequest } from '../../utils/api.mts'
import { envAsBoolean } from '../../utils/env.mts'
import { errorMessage } from '../../utils/errors.mts'
import { SEA_COANA_VFS_PATHS, seaCoanaPaths } from '../paths/coana.mts'

const COMPONENTS = ['analyzers', 'cli'] as const
const MAX_COMPONENT_BYTES = 512 * 1024 * 1024
const MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024
const SUPPORTED_TARGETS = new Set(['darwin-arm64', 'linux-arm64', 'linux-x64'])

type Component = {
  sha256: string
  size: number
  url: string
}

type CoanaArtifacts = {
  components: Record<string, Component>
  version: string
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isComponent(value: unknown): value is Component {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const component = value as Record<string, unknown>
  return (
    typeof component['sha256'] === 'string' &&
    /^[a-f0-9]{64}$/u.test(component['sha256']) &&
    typeof component['size'] === 'number' &&
    Number.isSafeInteger(component['size']) &&
    component['size'] > 0 &&
    component['size'] <= MAX_COMPONENT_BYTES &&
    typeof component['url'] === 'string' &&
    URL.canParse(component['url']) &&
    new URL(component['url']).protocol === 'https:'
  )
}

function parseArtifacts(value: unknown): CoanaArtifacts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('the API returned an invalid response')
  }
  const response = value as Record<string, unknown>
  const components = response['components']
  if (
    response['version'] !== COANA_CLI_VERSION ||
    !components ||
    typeof components !== 'object' ||
    Array.isArray(components)
  ) {
    throw new Error(
      `the API did not return the pinned Coana version ${COANA_CLI_VERSION}`,
    )
  }
  const parsed = components as Record<string, unknown>
  for (const name of COMPONENTS) {
    if (!isComponent(parsed[name])) {
      throw new Error(`the API returned invalid ${name} download metadata`)
    }
  }
  return {
    version: COANA_CLI_VERSION,
    components: Object.fromEntries(
      COMPONENTS.map(name => [name, parsed[name] as Component]),
    ),
  }
}

async function fetchArtifacts(org: string): Promise<CoanaArtifacts> {
  const result = await sendApiRequest<unknown>(
    `orgs/${encodeURIComponent(org)}/coana-cli/artifacts`,
    {
      body: { components: [...COMPONENTS], version: COANA_CLI_VERSION },
      method: 'POST',
    },
  )
  if (!result.ok) {
    throw new Error(
      result.cause ? `${result.message} (${result.cause})` : result.message,
    )
  }
  return parseArtifacts(result.data)
}

async function downloadComponent(
  component: Component,
  destination: string,
  name: string,
): Promise<void> {
  const response = await apiFetch(component.url, { timeout: 300_000 })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error(`${name} download returned HTTP ${response.status}`)
  }
  const hash = createHash('sha256')
  let received = 0
  await pipeline(
    Readable.from(response.body),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > component.size) {
          callback(new Error(`${name} exceeded its declared size`))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      },
      flush(callback) {
        if (received !== component.size) {
          callback(
            new Error(
              `${name} size mismatch: expected ${component.size} bytes, received ${received}`,
            ),
          )
        } else if (hash.digest('hex') !== component.sha256) {
          callback(new Error(`${name} failed SHA-256 verification`))
        } else {
          callback()
        }
      },
    }),
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  )
}

async function extractComponent(
  archive: string,
  destination: string,
): Promise<void> {
  let expandedBytes = 0
  await extractTar({
    cwd: destination,
    file: archive,
    strict: true,
    preserveOwner: false,
    filter(name, entry) {
      const normalized = name.replaceAll('\\', '/')
      if (
        normalized.startsWith('/') ||
        /^[a-zA-Z]:/u.test(normalized) ||
        normalized.split('/').some(part => part === '..')
      ) {
        throw new Error(`Coana archive contains an unsafe path: ${name}`)
      }
      if ('type' in entry && entry.type === 'Directory') {
        return true
      }
      if (!('type' in entry) || entry.type !== 'File') {
        throw new Error(`Coana archive contains an unsupported entry: ${name}`)
      }
      expandedBytes += entry.size
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new Error('Coana archive exceeds the expanded-size limit')
      }
      return true
    },
  })
}

async function normalizeTimes(directory: string): Promise<void> {
  const timestamp = new Date('1980-01-01T00:00:00.000Z')
  await Promise.all(
    (await fs.readdir(directory, { withFileTypes: true })).map(async entry => {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await normalizeTimes(filename)
      } else if (!entry.isFile()) {
        throw new Error(`Unsupported Coana payload entry: ${filename}`)
      }
      await fs.utimes(filename, timestamp, timestamp)
    }),
  )
  await fs.utimes(directory, timestamp, timestamp)
}

export type StagedCoana = {
  version: string
  cliSha256: string
  cliSize: number
  analyzersSha256: string
  analyzersSize: number
  nodeSha256: string
  nodeSize: number
  directory: string
  vfsDirectory: string
}

/** Download, verify, and stage the pinned Coana release for supported SEA targets. */
export async function stageCoana(
  stageRoot: string,
  platform: string,
  arch: string,
  nodeExecutable: string,
): Promise<StagedCoana | undefined> {
  const target = `${platform}-${arch}`
  if (!SUPPORTED_TARGETS.has(target)) {
    return undefined
  }
  const required = envAsBoolean(process.env['SOCKET_CLI_COANA_REQUIRED'])
  if (!required) {
    return undefined
  }

  const org = await getDefaultOrgSlug()
  if (!org.ok) {
    throw new Error(
      `Coana ${COANA_CLI_VERSION} download failed. Where: organization lookup. Saw: ${org.message}${org.cause ? ` (${org.cause})` : ''}; wanted: a default organization with Coana reachability access. Fix: check the build token and its organization access.`,
    )
  }
  let artifacts: CoanaArtifacts
  try {
    artifacts = await fetchArtifacts(org.data)
  } catch (error) {
    throw new Error(
      `Could not fetch Coana ${COANA_CLI_VERSION} artifacts for ${org.data}: ${errorMessage(error)}. Check that the build token can access Coana artifacts for this organization.`,
      { cause: error },
    )
  }

  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'socket-coana-build-'),
  )
  const paths = seaCoanaPaths(stageRoot)
  try {
    await fs.mkdir(paths.root, { recursive: true })
    const componentEntries = await Promise.all(
      COMPONENTS.map(async name => {
        const component = artifacts.components[name]!
        const archive = path.join(temporaryDirectory, `${name}.tar.gz`)
        const destination = name === 'cli' ? paths.cli : paths.analyzers
        await downloadComponent(component, archive, `Coana ${name}`)
        await fs.mkdir(destination, { recursive: true })
        await extractComponent(archive, destination)
        return [
          name,
          { sha256: component.sha256, size: component.size },
        ] as const
      }),
    )
    const componentDigests = Object.fromEntries(componentEntries)

    const cli = await fs.stat(paths.cliWrapper).catch(() => undefined)
    const repos = await fs.stat(paths.repos).catch(() => undefined)
    if (!cli?.isFile() || !repos?.isDirectory()) {
      throw new Error(
        'Coana archives do not contain cli-wrapper.mjs and analyzer repos/',
      )
    }

    await fs.copyFile(nodeExecutable, paths.node)
    await fs.chmod(paths.node, 0o755)
    const nodeBytes = await fs.readFile(paths.node)
    const nodeSha256 = sha256(nodeBytes)
    await fs.writeFile(paths.nodeDigest, `${nodeSha256}\n`)
    await fs.writeFile(
      paths.manifest,
      `${JSON.stringify(
        {
          version: artifacts.version,
          components: componentDigests,
          nodeSha256,
        },
        null,
        2,
      )}\n`,
    )
    await normalizeTimes(paths.root)
    return {
      version: artifacts.version,
      cliSha256: componentDigests['cli']!.sha256,
      cliSize: componentDigests['cli']!.size,
      analyzersSha256: componentDigests['analyzers']!.sha256,
      analyzersSize: componentDigests['analyzers']!.size,
      nodeSha256,
      nodeSize: nodeBytes.length,
      directory: paths.root,
      vfsDirectory: SEA_COANA_VFS_PATHS.root,
    }
  } catch (error) {
    await fs.rm(paths.root, { recursive: true, force: true })
    throw error
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
}
