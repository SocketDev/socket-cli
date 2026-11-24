import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { setTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const maxBytes = 512 * 1024 * 1024

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}.`)
  }
  return value
}

async function streamFile(command: string, args: string[], file: string, exclusive = false) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let errorText = ''
  child.stderr.setEncoding('utf8').on('data', chunk => { errorText += chunk })
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with ${code}: ${errorText}`))
      }
    })
  })
  let bytes = 0
  try {
    await Promise.all([done, pipeline(child.stdout, async function* (chunks) {
      for await (const chunk of chunks) {
        bytes += chunk.length
        if (exclusive && bytes > maxBytes) {
          throw new Error('Oversized release tarball.')
        }
        yield chunk
      }
    }, createWriteStream(file, { flags: exclusive ? 'wx' : 'w' }))])
  } finally {
    child.kill()
  }
  return bytes
}

async function fetchArtifact(endpoint: string, file: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await streamFile('bash', ['-c', 'exec gh api "$1"', 'gh', endpoint], file)
      return
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('HTTP 404') || attempt === 6) {
        throw error
      }
      await setTimeout(5000)
    }
  }
}

async function download(name: string, receipt: unknown, expected: string[], scratch: string, destination: string) {
  const match = typeof receipt === 'string' && /^([1-9]\d*):([a-f0-9]{64})$/u.exec(receipt)
  if (!match) {
    throw new Error(`Missing or invalid upload receipt for ${name}.`)
  }
  const endpoint = `repos/${required('GITHUB_REPOSITORY')}/actions/artifacts/${match[1]}`
  const metadataFile = path.join(scratch, 'artifact.json')
  await fetchArtifact(endpoint, metadataFile)
  const metadata = JSON.parse(await readFile(metadataFile, 'utf8'))
  if (String(metadata.workflow_run?.id) !== required('GITHUB_RUN_ID') ||
    !new RegExp(`^${name}-[1-9][0-9]*$`, 'u').test(metadata.name) || metadata.expired !== false) {
    throw new Error(`Artifact metadata does not match the release run for ${name}.`)
  }
  const archive = path.join(scratch, 'artifact.zip')
  await fetchArtifact(endpoint + '/zip', archive)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(archive)) {
    hash.update(chunk)
  }
  if (hash.digest('hex') !== match[2]) {
    throw new Error(`Artifact digest does not match the verified upload for ${name}.`)
  }

  const { stdout } = await execute('unzip', ['-Z', '-l', archive], { env: { ...process.env, LC_ALL: 'C' } })
  const entries = stdout.trimEnd().split(/\r?\n/u).slice(2, -1)
  const remaining = new Set(expected)
  for (const entry of entries) {
    // zipinfo's long listing includes the Unix file type and unpacked size.
    const fields = /^-\S*\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+([^\s]+)$/u.exec(entry)
    const filename = fields?.[2]
    const size = Number(fields?.[1])
    if (!filename || !remaining.delete(filename) || !(size > 0 && size <= maxBytes)) {
      throw new Error(`Invalid tarball entry in ${name}.`)
    }
    const written = await streamFile('unzip', ['-p', archive, filename], path.join(destination, filename), true)
    if (written !== size) {
      throw new Error(`Invalid tarball size in ${name}.`)
    }
  }
  if (remaining.size) {
    throw new Error(`Missing release tarballs in ${name}.`)
  }
}

const version = required('VERSION')
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error('Invalid release version.')
}
const packages = version.includes('-') ? ['socket'] : ['socket', 'socketsecurity-cli', 'socketsecurity-cli-with-sentry']
const releases = [{ name: 'npm-release-tarballs', receipt: required('ROOT_RECEIPT'), files: packages.map(pkg => `${pkg}-${version}.tgz`) }]
if (process.env['NATIVE_RECEIPTS'] !== undefined) {
  const receipts = JSON.parse(process.env['NATIVE_RECEIPTS'])
  const targets = version.includes('-') ? ['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'] : []
  if (!receipts || typeof receipts !== 'object' || Array.isArray(receipts) ||
    Object.keys(receipts).length !== targets.length || !targets.every(target => Object.hasOwn(receipts, target))) {
    throw new Error('Platform upload receipts do not match the release track.')
  }
  for (const target of targets) {
    releases.push({ name: `native-${target}`, receipt: receipts[target], files: [`socketsecurity-socket-cli-${target}-${version}.tgz`] })
  }
}
const destination = required('DIST_DIRECTORY')
await mkdir(destination, { recursive: true })
const scratch = await mkdtemp(path.join(required('RUNNER_TEMP'), 'release-'))
try {
  for (const release of releases) {
    await download(release.name, release.receipt, release.files, scratch, destination)
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}
