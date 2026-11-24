import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const [command, ...args] = process.argv.slice(2)

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function recordStage() {
  const output = readFileSync(args[0]!, 'utf8')
  const start = output.search(/^(?:\{(?=\s*")|\[(?=\s*\{))/mu)
  const value = JSON.parse(start < 0 ? output : output.slice(start))
  const rows: unknown[] = Array.isArray(value)
    ? value
    : Object.values(value ?? {})
  const matches = rows.filter(
    (row): row is { name: string; version: string; stageId: string } =>
      row !== null &&
      typeof row === 'object' &&
      'name' in row &&
      'version' in row &&
      'stageId' in row &&
      typeof row.name === 'string' &&
      typeof row.version === 'string' &&
      typeof row.stageId === 'string' &&
      /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu.test(
        row.stageId,
      ),
  )
  if (matches.length !== 1)
    {throw new Error('Expected one npm stage ID in pnpm JSON output.')}
  const stage = matches[0]!
  const artifactName = `${stage.name.replace(/^@/u, '').replace('/', '-')}-${stage.version}.tgz`
  if (basename(args[2]!) !== artifactName)
    {throw new Error('Stage identity does not match the verified tarball.')}
  appendFileSync(
    args[1]!,
    `- ${stage.name}@${stage.version} — stage ID: \`${stage.stageId}\`\n`,
  )
  process.stdout.write(`Stage ID: ${stage.stageId}\n`)
}

switch (command) {
  case 'stage-output':
    recordStage()
    break
  case 'tarball-count': {
    const expected = required('VERSION').includes('-') ? 6 : 3
    if (Number(args[0]) !== expected) {
      throw new Error(
        `Expected ${expected} verified tarballs, found ${args[0]}.`,
      )
    }
    console.log(expected)
    break
  }
  case 'first-release': {
    const missing = []
    for (const target of [
      'darwin-arm64',
      'linux-arm64',
      'linux-x64',
      'win32-arm64',
      'win32-x64',
    ]) {
      const name = `@socketsecurity/socket-cli-${target}`
      const status = execFileSync(
        'curl',
        [
          '--retry',
          '3',
          '--silent',
          '--show-error',
          '--output',
          '/dev/null',
          '--write-out',
          '%{http_code}',
          `https://registry.npmjs.org/@socketsecurity%2fsocket-cli-${target}`,
        ],
        { encoding: 'utf8' },
      )
      if (status === '404') {
        missing.push(name)
      } else if (status !== '200') {
        throw new Error(`Registry lookup for ${name} returned ${status}`)
      }
    }
    writeFileSync(
      join(required('RUNNER_TEMP'), 'first-native-packages'),
      missing.join('\n'),
    )
    if (missing.length && required('BOOTSTRAP_AVAILABLE') !== 'true') {
      throw new Error(
        `Set NPM_FIRST_STAGE_TOKEN to stage ${missing.join(', ')}.`,
      )
    }
    break
  }
  case 'commit': {
    const sha = execFileSync(
      'git',
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      { encoding: 'utf8' },
    ).trim()
    const verified = execFileSync(
      'gh',
      [
        'api',
        `repos/${required('REPOSITORY')}/commits/${sha}`,
        '--jq',
        '.commit.verification.verified',
      ],
      { encoding: 'utf8' },
    ).trim()
    if (verified !== 'true') {
      throw new Error(
        `Release commit ${sha} is not GitHub-verified; npm staging stopped.`,
      )
    }
    break
  }
  case 'latest-branch':
    if (required('REF') !== 'refs/heads/v1.x') {
      throw new Error(
        'Refusing to publish the latest dist-tag outside refs/heads/v1.x.',
      )
    }
    break
  default:
    throw new Error(`Unknown release check: ${command}`)
}
