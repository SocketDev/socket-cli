import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { EnvironmentVariables } from './environment-variables.mts'
import { PACKAGE_ROOT } from './paths.mts'
import { loadEnvFile } from './util/load-env.mts'

const logger = getDefaultLogger()

export async function runProductTests(
  lane: 'integration' | 'e2e',
): Promise<void> {
  if (!existsSync(path.join(PACKAGE_ROOT, 'dist/index.js'))) {
    logger.error(
      'CLI build missing at dist/index.js. Run pnpm run build first.',
    )
    process.exitCode = 1
    return
  }
  const require = createRequire(import.meta.url)
  const vitest = path.join(
    path.dirname(require.resolve('vitest/package.json')),
    'vitest.mjs',
  )
  const args = process.argv.slice(2)
  if (args[0] === '--') {
    args.shift()
  }
  const result = await spawn(
    process.execPath,
    [
      vitest,
      'run',
      '--config',
      `.config/repo/cli/vitest.${lane}.config.mts`,
      ...args,
    ],
    {
      cwd: PACKAGE_ROOT,
      env: {
        ...loadEnvFile(
          path.join(PACKAGE_ROOT, lane === 'e2e' ? '.env.e2e' : '.env.test'),
        ),
        ...process.env,
        ...Object.fromEntries(
          Object.entries(EnvironmentVariables.getTestVariables()),
        ),
        RUN_INTEGRATION_TESTS: '1',
      },
      stdio: 'inherit',
    },
  )
  process.exitCode = result.code ?? 1
}
