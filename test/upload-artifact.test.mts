import crypto from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

interface ArtifactDependencies {
  execFile?: (
    command: string,
    args: string[],
    options: { cwd: string },
  ) => Promise<void>
  fetch?: typeof fetch
}

interface ArtifactResult {
  artifactDigest: string
  artifactId: string
}

interface ArtifactModule {
  artifactExpiration(maximum: string | undefined, now?: number): string
  hashArtifactArchive(filename: string): Promise<string>
  readArtifactBackendIds(token: string): Record<string, string>
  readArtifactId(value: unknown): string
  readReleaseTarballs(directory: string): Promise<string[]>
  runArtifactUploadAction(
    env: Record<string, string>,
    dependencies: ArtifactDependencies,
  ): Promise<ArtifactResult>
}

const moduleUrl = new URL('../scripts/ci/upload-artifact.mjs', import.meta.url)
  .href
const artifact = (await import(moduleUrl)) as ArtifactModule
const directories: string[] = []
const archiveBytes = Buffer.from('verified archive fixture')
const archiveDigest = crypto
  .createHash('sha256')
  .update(archiveBytes)
  .digest('hex')

function runtimeToken(
  scope = 'Actions.Results:run-fixture:job-fixture',
): string {
  return `header.${Buffer.from(JSON.stringify({ scp: scope })).toString('base64url')}.signature`
}

async function createUploadFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-artifact-test-'))
  directories.push(root)
  const files = [
    'socket-1.1.177.tgz',
    'socketsecurity-cli-1.1.177.tgz',
    'socketsecurity-cli-with-sentry-1.1.177.tgz',
  ]
  const directory = path.join(root, 'tarballs')
  await mkdir(directory)
  await Promise.all(
    files.map(name =>
      writeFile(path.join(directory, name), 'verified tarball'),
    ),
  )
  const output = path.join(root, 'outputs')
  const env = {
    ACTIONS_RESULTS_URL: 'https://results.example.com/',
    ACTIONS_RUNTIME_TOKEN: runtimeToken(),
    GITHUB_OUTPUT: output,
    GITHUB_RETENTION_DAYS: '7',
    INPUT_NAME: 'npm-release-tarballs',
    INPUT_PATH: directory,
    RUNNER_TEMP: root,
  }
  const execute = vi.fn(
    async (command: string, args: string[], options: { cwd: string }) => {
      expect(command).toBe('zip')
      expect(args.slice(0, 2)).toEqual(['-q', '-0'])
      expect(args.slice(3)).toEqual([...files].sort())
      expect(options).toMatchObject({ cwd: directory, timeout: 120_000 })
      await writeFile(args[2]!, archiveBytes)
    },
  )
  return { directory, env, execute, files, output, root }
}

function uploadFetch(artifactId: unknown = '12345') {
  return vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/CreateArtifact')) {
      return Response.json({
        ok: true,
        signed_upload_url:
          'https://storage.example.com/archive?signature=fixture',
      })
    }
    if (options?.method === 'PUT') {
      const chunks: Uint8Array[] = []
      for await (const chunk of options.body as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(chunk)
      }
      expect(Buffer.concat(chunks)).toEqual(archiveBytes)
      return new Response(null, { status: 201 })
    }
    return Response.json({ ok: true, artifact_id: artifactId })
  })
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true })),
  )
})

describe('release artifact protocol', () => {
  it('hashes the uploaded bytes and emits outputs only after finalization', async () => {
    const fixture = await createUploadFixture()
    const fetcher = uploadFetch('9007199254740993')
    const result = await artifact.runArtifactUploadAction(fixture.env, {
      execFile: fixture.execute,
      fetch: fetcher,
    })
    expect(result).toEqual({
      artifactDigest: archiveDigest,
      artifactId: '9007199254740993',
    })
    expect(await readFile(fixture.output, 'utf8')).toBe(
      `artifact-id=9007199254740993\nartifact-digest=${archiveDigest}\n`,
    )
    expect(fetcher).toHaveBeenCalledTimes(3)
    const create = fetcher.mock.calls[0]![1]!
    expect(JSON.parse(String(create.body))).toMatchObject({
      workflow_run_backend_id: 'run-fixture',
      workflow_job_run_backend_id: 'job-fixture',
      name: 'npm-release-tarballs',
      version: 7,
      mime_type: 'application/zip',
    })
    const expiration = JSON.parse(String(create.body)).expires_at as string
    expect(Date.parse(expiration) - Date.now()).toBeGreaterThan(6 * 86_400_000)
    expect(Date.parse(expiration) - Date.now()).toBeLessThanOrEqual(
      7 * 86_400_000,
    )
    expect(create).toMatchObject({
      method: 'POST',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    })
    const upload = fetcher.mock.calls[1]![1]!
    expect(upload.headers).toEqual({
      'content-length': String(archiveBytes.length),
      'content-type': 'application/zip',
      'x-ms-blob-type': 'BlockBlob',
    })
    expect(JSON.parse(String(fetcher.mock.calls[2]![1]!.body))).toEqual({
      workflow_run_backend_id: 'run-fixture',
      workflow_job_run_backend_id: 'job-fixture',
      name: 'npm-release-tarballs',
      size: String(archiveBytes.length),
      hash: `sha256:${archiveDigest}`,
    })
    expect((await readdir(fixture.root)).sort()).toEqual([
      'outputs',
      'tarballs',
    ])
  })

  it('stops after a failed transfer without finalization or outputs', async () => {
    const fixture = await createUploadFixture()
    const fetcher = uploadFetch()
    fetcher.mockImplementationOnce(async () =>
      Response.json({
        ok: true,
        signed_upload_url: 'https://storage.example.com/archive',
      }),
    )
    fetcher.mockImplementationOnce(
      async () => new Response('private upstream body', { status: 503 }),
    )
    await expect(
      artifact.runArtifactUploadAction(fixture.env, {
        execFile: fixture.execute,
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ code: 'ARCHIVE_TRANSFER_FAILED' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await readdir(fixture.root)).toEqual(['tarballs'])
  })

  it('stops before the service when zip fails', async () => {
    const fixture = await createUploadFixture()
    fixture.execute.mockRejectedValueOnce(new Error('fixture zip failure'))
    const fetcher = uploadFetch()
    await expect(
      artifact.runArtifactUploadAction(fixture.env, {
        execFile: fixture.execute,
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ code: 'ARCHIVE_CREATION_FAILED' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(await readdir(fixture.root)).toEqual(['tarballs'])
  })

  it('does not emit outputs when finalization fails', async () => {
    const fixture = await createUploadFixture()
    const fetcher = uploadFetch()
    const implementation = fetcher.getMockImplementation()!
    fetcher.mockImplementation(async (url, options) =>
      String(url).endsWith('/FinalizeArtifact')
        ? Response.json({ ok: false })
        : await implementation(url, options),
    )
    await expect(
      artifact.runArtifactUploadAction(fixture.env, {
        execFile: fixture.execute,
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ code: 'FINALIZE_NOT_ACKNOWLEDGED' })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(await readdir(fixture.root)).toEqual(['tarballs'])
  })

  it.each([
    0,
    -1,
    '1suffix',
    '1\nother=value',
    '18446744073709551616',
    1.5,
    {},
  ])('rejects an invalid final artifact ID: %j', async id => {
    const fixture = await createUploadFixture()
    await expect(
      artifact.runArtifactUploadAction(fixture.env, {
        execFile: fixture.execute,
        fetch: uploadFetch(id),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARTIFACT_ID' })
    expect(await readdir(fixture.root)).toEqual(['tarballs'])
  })

  it.each([
    new Response('private response', { status: 403 }),
    new Response('invalid JSON'),
  ])('stops on a failed create response', async response => {
    const fixture = await createUploadFixture()
    const fetcher = vi.fn<typeof fetch>(async () => response)
    await expect(
      artifact.runArtifactUploadAction(fixture.env, {
        execFile: fixture.execute,
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ code: 'FAILED_CREATEARTIFACT' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(await readdir(fixture.root)).toEqual(['tarballs'])
  })
})

describe('release artifact inputs', () => {
  it.each([
    'invalid',
    runtimeToken('unrelated'),
    runtimeToken('Actions.Results::job-fixture'),
    runtimeToken('Actions.Results:run-fixture:job-fixture:extra'),
    runtimeToken('Actions.Results:run:job Actions.Results:other:job'),
  ])('refuses malformed runtime scopes', token => {
    expect(() => artifact.readArtifactBackendIds(token)).toThrow(
      expect.objectContaining({ code: 'INVALID_RUNTIME_SCOPE' }),
    )
  })

  it('decodes exactly one results scope among other scopes', () => {
    expect(
      artifact.readArtifactBackendIds(
        runtimeToken('other Actions.Results:run-fixture:job-fixture more'),
      ),
    ).toEqual({
      workflow_run_backend_id: 'run-fixture',
      workflow_job_run_backend_id: 'job-fixture',
    })
  })

  it('caps retention at repository policy and requests 30 days otherwise', () => {
    expect(artifact.artifactExpiration('7', 0)).toBe('1970-01-08T00:00:00.000Z')
    expect(artifact.artifactExpiration(undefined, 0)).toBe(
      '1970-01-31T00:00:00.000Z',
    )
    expect(artifact.artifactExpiration('90', 0)).toBe(
      '1970-01-31T00:00:00.000Z',
    )
    expect(() => artifact.artifactExpiration('invalid')).toThrow(
      expect.objectContaining({ code: 'INVALID_RETENTION_DAYS' }),
    )
  })

  it('hashes archive contents with SHA-256', async () => {
    const fixture = await createUploadFixture()
    const file = path.join(fixture.root, 'digest-fixture')
    await writeFile(file, 'abc')
    expect(await artifact.hashArtifactArchive(file)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('refuses extra files before invoking zip or the service', async () => {
    const fixture = await createUploadFixture()
    await writeFile(path.join(fixture.directory, 'unexpected.txt'), 'fixture')
    const fetcher = uploadFetch()
    await expect(
      artifact.runArtifactUploadAction(fixture.env, {
        execFile: fixture.execute,
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RELEASE_TARBALLS' })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refuses symlinks in the tarball directory', async () => {
    const fixture = await createUploadFixture()
    const filename = path.join(fixture.directory, fixture.files[0]!)
    await rm(filename)
    await symlink(path.join(fixture.directory, fixture.files[1]!), filename)
    await expect(
      artifact.readReleaseTarballs(fixture.directory),
    ).rejects.toMatchObject({ code: 'INVALID_RELEASE_TARBALLS' })
  })
})
