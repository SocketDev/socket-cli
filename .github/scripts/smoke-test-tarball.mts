import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { PKG, VERSION, TARGET, RUNNER_TEMP } = process.env
if (!PKG || !VERSION || !RUNNER_TEMP) {
  throw new Error('PKG, VERSION, and RUNNER_TEMP are required.')
}
const consumer = mkdtempSync(join(RUNNER_TEMP, 'socket-consumer-'))
try {
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'socket-cli-smoke', private: true }),
  )
  if (TARGET) {
    writeFileSync(
      join(consumer, 'pnpm-workspace.yaml'),
      `overrides:\n  "@socketsecurity/socket-cli-${TARGET}@${VERSION}": "file:../platform/socketsecurity-socket-cli-${TARGET}-${VERSION}.tgz"\n`,
    )
  }
  const tarball = join(
    RUNNER_TEMP,
    TARGET ? 'launcher' : 'dist',
    PKG.replace(/^@/u, '').replace('/', '-') + '-' + VERSION + '.tgz',
  )
  // Git Bash runs both the Unix shims and the pnpm-generated Windows shell shims.
  execFileSync(
    'bash',
    [
      '-c',
      'exec pnpm add --ignore-scripts "$@"',
      'pnpm',
      ...(TARGET ? ['--offline'] : []),
      tarball,
    ],
    { cwd: consumer, stdio: 'inherit' },
  )
  const manifest = JSON.parse(
    readFileSync(join(consumer, 'node_modules', PKG, 'package.json'), 'utf8'),
  )
  const main = PKG.split('/').pop()!
  if (
    manifest.name !== PKG ||
    manifest.version !== VERSION ||
    !Object.hasOwn(manifest.bin ?? {}, main)
  ) {
    throw new Error(
      `Installed manifest does not match ${PKG}@${VERSION} or lacks its main executable.`,
    )
  }
  for (const bin of Object.keys(manifest.bin)) {
    const executable = './node_modules/.bin/' + bin
    if (TARGET && bin === main) {
      execFileSync('bash', ['-c', 'exec "$1" --help', 'smoke', executable], {
        cwd: consumer,
        stdio: 'inherit',
      })
    }
    const reported = execFileSync(
      'bash',
      ['-c', 'exec "$1" --version', 'smoke', executable],
      { cwd: consumer, encoding: 'utf8' },
    ).trimEnd()
    if (bin === main && reported !== VERSION) {
      throw new Error(`${bin} reported ${reported}; expected ${VERSION}.`)
    }
  }
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
