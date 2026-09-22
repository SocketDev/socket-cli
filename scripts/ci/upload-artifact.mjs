import { execFile as execFileCallback } from 'node:child_process'
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, lstat, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const ARTIFACT_SERVICE = 'github.actions.results.api.v1.ArtifactService'
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024 * 1024

export class ArtifactUploadError extends Error {
  constructor(code) {
    super(
      `Artifact upload failed. Where: release artifact service. Saw: ${code}; wanted three verified tarballs stored successfully. Fix: inspect the release inputs and retry the job.`,
    )
    this.code = code
  }
}

export function readArtifactBackendIds(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !/^[\w-]+$/.test(parts[1])) {
      throw new Error('invalid token')
    }
    const { scp } = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    const scopes = scp
      .trim()
      .split(/\s+/)
      .filter(scope => scope.startsWith('Actions.Results:'))
    const fields = scopes[0]?.split(':')
    if (
      scopes.length !== 1 ||
      fields?.length !== 3 ||
      fields.slice(1).some(field => !/^[\da-z-]{1,128}$/i.test(field))
    ) {
      throw new Error('invalid scope')
    }
    return {
      workflow_run_backend_id: fields[1],
      workflow_job_run_backend_id: fields[2],
    }
  } catch {
    throw new ArtifactUploadError('INVALID_RUNTIME_SCOPE')
  }
}

export function readArtifactId(value) {
  const id =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value
  if (
    typeof id !== 'string' ||
    !/^[1-9]\d{0,19}$/.test(id) ||
    BigInt(id) > 18_446_744_073_709_551_615n
  ) {
    throw new ArtifactUploadError('INVALID_ARTIFACT_ID')
  }
  return id
}

export function artifactExpiration(maximum, now = Date.now()) {
  const cap = maximum === undefined || maximum === '' ? 30 : Number(maximum)
  if (!Number.isInteger(cap) || cap < 1 || cap > 400) {
    throw new ArtifactUploadError('INVALID_RETENTION_DAYS')
  }
  return new Date(now + Math.min(30, cap) * 86_400_000).toISOString()
}

function artifactHttpsUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error('invalid URL')
    }
    return url
  } catch {
    throw new ArtifactUploadError('INVALID_SERVICE_URL')
  }
}

export async function readReleaseTarballs(directory) {
  try {
    if (!(await lstat(directory)).isDirectory()) {
      throw new Error('invalid directory')
    }
    const names = (await readdir(directory)).sort()
    if (
      names.length !== 3 ||
      names.some(name => !/^[\da-z][\w.+-]*\.tgz$/i.test(name))
    ) {
      throw new Error('invalid tarballs')
    }
    const entries = await Promise.all(
      names.map(name => lstat(path.join(directory, name))),
    )
    if (entries.some(entry => !entry.isFile() || entry.size === 0)) {
      throw new Error('invalid tarball file')
    }
    return names
  } catch {
    throw new ArtifactUploadError('INVALID_RELEASE_TARBALLS')
  }
}

export async function hashArtifactArchive(filename) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function artifactRpc(fetcher, baseUrl, token, method, body) {
  try {
    const response = await fetcher(
      new URL(`/twirp/${ARTIFACT_SERVICE}/${method}`, baseUrl),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    )
    if (!response.ok) {
      throw new Error('service response failed')
    }
    const text = await response.text()
    if (text.length > 1024 * 1024) {
      throw new Error('oversized response')
    }
    const result = JSON.parse(text)
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('invalid response')
    }
    return result
  } catch {
    throw new ArtifactUploadError(`FAILED_${method.toUpperCase()}`)
  }
}

export async function uploadReleaseArtifact(config, dependencies = {}) {
  const fetcher = dependencies.fetch ?? fetch
  const execute = dependencies.execFile ?? execFile
  const env = config.env ?? process.env
  const directory = path.resolve(config.directory)
  const name = config.name ?? 'npm-release-tarballs'
  if (!/^[\da-z][\w.-]{0,127}$/i.test(name)) {
    throw new ArtifactUploadError('INVALID_ARTIFACT_NAME')
  }
  const token = env.ACTIONS_RUNTIME_TOKEN
  const ids = readArtifactBackendIds(token)
  const baseUrl = artifactHttpsUrl(env.ACTIONS_RESULTS_URL)
  const expiresAt = artifactExpiration(env.GITHUB_RETENTION_DAYS)
  const names = await readReleaseTarballs(directory)
  const scratch = await mkdtemp(
    path.join(env.RUNNER_TEMP ?? os.tmpdir(), 'release-artifact-'),
  )
  try {
    const archive = path.join(scratch, 'artifact.zip')
    try {
      await execute('zip', ['-q', '-0', archive, ...names], {
        cwd: directory,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      })
    } catch {
      throw new ArtifactUploadError('ARCHIVE_CREATION_FAILED')
    }
    const { size } = await stat(archive)
    if (size === 0 || size > MAX_ARCHIVE_BYTES) {
      throw new ArtifactUploadError('INVALID_ARCHIVE_SIZE')
    }
    const digest = await hashArtifactArchive(archive)
    const created = await artifactRpc(
      fetcher,
      baseUrl,
      token,
      'CreateArtifact',
      {
        ...ids,
        name,
        version: 7,
        mime_type: 'application/zip',
        expires_at: expiresAt,
      },
    )
    if (created.ok !== true) {
      throw new ArtifactUploadError('CREATE_NOT_ACKNOWLEDGED')
    }
    const uploadUrl = artifactHttpsUrl(
      created.signed_upload_url ?? created.signedUploadUrl,
    )
    const stream = createReadStream(archive)
    try {
      const response = await fetcher(uploadUrl, {
        method: 'PUT',
        headers: {
          'content-length': String(size),
          'content-type': 'application/zip',
          'x-ms-blob-type': 'BlockBlob',
        },
        body: stream,
        duplex: 'half',
        redirect: 'error',
        signal: AbortSignal.timeout(10 * 60_000),
      })
      if (!response.ok) {
        throw new Error('upload response failed')
      }
      await response.body?.cancel()
    } catch {
      throw new ArtifactUploadError('ARCHIVE_TRANSFER_FAILED')
    } finally {
      stream.destroy()
    }
    const finalized = await artifactRpc(
      fetcher,
      baseUrl,
      token,
      'FinalizeArtifact',
      {
        ...ids,
        name,
        size: String(size),
        hash: `sha256:${digest}`,
      },
    )
    if (finalized.ok !== true) {
      throw new ArtifactUploadError('FINALIZE_NOT_ACKNOWLEDGED')
    }
    return {
      artifactId: readArtifactId(finalized.artifact_id ?? finalized.artifactId),
      artifactDigest: digest,
    }
  } finally {
    await rm(scratch, { force: true, recursive: true })
  }
}

export async function runArtifactUploadAction(
  env = process.env,
  dependencies = {},
) {
  if (!env.GITHUB_OUTPUT || !env.INPUT_PATH) {
    throw new ArtifactUploadError('MISSING_ACTION_INPUT')
  }
  const result = await uploadReleaseArtifact(
    {
      directory: env.INPUT_PATH,
      env,
      name: env.INPUT_NAME || 'npm-release-tarballs',
    },
    dependencies,
  )
  await appendFile(
    env.GITHUB_OUTPUT,
    `artifact-id=${result.artifactId}\nartifact-digest=${result.artifactDigest}\n`,
  )
  return result
}
