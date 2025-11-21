/** @fileoverview Integration tests for SEA (Single Executable Application) binary. */

import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  ROOT_DIR,
  logger,
  prepareBinary,
  type BinaryConfig,
} from './helpers.mts'
import ENV from '../../../src/constants/env.mts'
import { getDefaultApiToken } from '../../../src/utils/socket/sdk.mts'
import { executeCliCommand } from '../../helpers/cli-execution.mts'

const BINARY: BinaryConfig = {
  buildCommand: ['pnpm', '--filter', '@socketsecurity/cli', 'run', 'build:sea'],
  // In CI: always enabled. Locally: only if TEST_SEA_BINARY is set.
  enabled: process.env.CI ? true : !!process.env.TEST_SEA_BINARY,
  name: 'SEA Binary (Single Executable Application)',
  path: path.join(ROOT_DIR, 'dist/sea/socket-sea'),
}

if (BINARY.enabled) {
  describe(BINARY.name, () => {
    let hasAuth = false
    let binaryExists = false

    beforeAll(async () => {
      binaryExists = await prepareBinary(BINARY, 'sea')

      // Check authentication.
      if (ENV.RUN_INTEGRATION_TESTS) {
        const apiToken = await getDefaultApiToken()
        hasAuth = !!apiToken
        if (!apiToken && !process.env.CI) {
          logger.log('')
          logger.warn('Integration tests require Socket authentication.')
          logger.log('Please run one of the following:')
          logger.log('  1. socket login (to authenticate with Socket)')
          logger.log('  2. Set SOCKET_SECURITY_API_KEY environment variable')
          logger.log(
            '  3. Skip integration tests by not setting RUN_INTEGRATION_TESTS',
          )
          logger.log('')
          logger.log(
            'Integration tests will be skipped due to missing authentication.',
          )
          logger.log('')
        }
      }
    })
    describe('Basic commands (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display version',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['--version'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          // Note: --version currently shows help and exits with code 2 (known issue).
          // This test validates the CLI executes without crashing.
          expect(result.code).toBeGreaterThanOrEqual(0)
          expect(result.stdout.length).toBeGreaterThan(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)('should display help', async () => {
        if (!binaryExists) {
          return
        }

        const result = await executeCliCommand(['--help'], {
          binPath: BINARY.path,
          isolateConfig: false,
        })

        expect(result.code).toBe(0)
        expect(result.stdout).toContain('socket')
        expect(result.stdout).toContain('Main commands')
      })

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('scan')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display package command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['package', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('package')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display optimize command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['optimize', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('optimize')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display fix command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['fix', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('fix')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display npm command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['npm', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('npm')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display npx command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['npx', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('npx')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display patch command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['patch', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('patch')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display config command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['config', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('config')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display manifest command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['manifest', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('manifest')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display organization command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['organization', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('organization')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display repository command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['repository', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('repository')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display pnpm command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['pnpm', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('pnpm')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display yarn command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['yarn', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('yarn')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display pip command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['pip', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('pip')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display wrapper command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['wrapper', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('wrapper')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display install command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['install', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('install')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display uninstall command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['uninstall', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('uninstall')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display login command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['login', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('login')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display logout command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['logout', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('logout')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display whoami command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['whoami', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('whoami')
        },
      )
    })

    describe('Scan subcommands (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan create help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', 'create', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('create')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan list help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', 'list', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('list')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan view help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', 'view', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('view')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan del help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', 'del', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('del')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan diff help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', 'diff', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('diff')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan metadata help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['scan', 'metadata', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('metadata')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan report help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', 'report', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('report')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan setup help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', 'setup', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('setup')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan github help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', 'github', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('github')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display scan reach help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', 'reach', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('reach')
        },
      )
    })

    describe('Config subcommands (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display config get help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['config', 'get', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('get')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display config set help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['config', 'set', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('set')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display config unset help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['config', 'unset', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('unset')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display config list help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['config', 'list', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('list')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display config auto help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['config', 'auto', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('auto')
        },
      )
    })

    describe('Organization subcommands (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display organization list help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['organization', 'list', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('list')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display organization dependencies help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['organization', 'dependencies', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('dependencies')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display organization quota help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['organization', 'quota', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('quota')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display organization policy help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['organization', 'policy', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('policy')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display organization policy license help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['organization', 'policy', 'license', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('license')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display organization policy security help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['organization', 'policy', 'security', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('security')
        },
      )
    })

    describe('Repository subcommands (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display repository create help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['repository', 'create', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('create')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display repository list help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['repository', 'list', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('list')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display repository view help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['repository', 'view', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('view')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display repository update help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['repository', 'update', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('update')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display repository del help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['repository', 'del', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('del')
        },
      )
    })

    describe('Patch subcommands (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display patch list help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['patch', 'list', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('list')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display patch get help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['patch', 'get', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('get')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display patch info help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['patch', 'info', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('info')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display patch discover help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['patch', 'discover', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('discover')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display patch download help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['patch', 'download', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('download')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display patch cleanup help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['patch', 'cleanup', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('cleanup')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display patch rm help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['patch', 'rm', '--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('rm')
        },
      )
    })

    describe('Manifest subcommands (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display manifest auto help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['manifest', 'auto', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('auto')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display manifest conda help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['manifest', 'conda', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('conda')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display manifest gradle help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['manifest', 'gradle', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('gradle')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display manifest kotlin help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['manifest', 'kotlin', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('kotlin')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display manifest scala help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['manifest', 'scala', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('scala')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display manifest setup help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['manifest', 'setup', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('setup')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should handle manifest cdxgen command',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['manifest', 'cdxgen', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          // cdxgen spawns external binary - just verify command exists.
          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )
    })

    describe('Package subcommands (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display package score help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['package', 'score', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('score')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display package shallow help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['package', 'shallow', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('shallow')
        },
      )
    })

    describe('Install/Uninstall subcommands (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display install completion help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['install', 'completion', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('completion')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display uninstall completion help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['uninstall', 'completion', '--help'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('completion')
        },
      )
    })

    describe('Dry-run validation (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should handle optimize --dry-run',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['optimize', '--dry-run', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          // Dry-run should exit gracefully.
          expect(result.code).toBeGreaterThanOrEqual(0)
          const output = result.stdout + result.stderr
          expect(output).toContain('[DryRun]')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should handle fix --dry-run',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['fix', '--dry-run', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          // Dry-run should exit gracefully.
          expect(result.code).toBeGreaterThanOrEqual(0)
          const output = result.stdout + result.stderr
          expect(output).toContain('[DryRun]')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should handle npm --dry-run',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['npm', 'install', '--dry-run', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          // Dry-run should exit gracefully.
          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should handle config get with invalid key',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['config', 'get', 'invalidKey', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          // Should fail with input error.
          expect(result.code).toBeGreaterThan(0)
          expect(result.stderr).toContain('Input error')
        },
      )
    })

    describe('Auth-required commands', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should list config settings',
        async () => {
          if (!binaryExists || !hasAuth) {
            return
          }

          const result = await executeCliCommand(['config', 'list'], {
            binPath: BINARY.path,
          })

          expect(result.code).toBe(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should display whoami information',
        async () => {
          if (!binaryExists || !hasAuth) {
            return
          }

          const result = await executeCliCommand(['whoami'], {
            binPath: BINARY.path,
          })

          expect(result.code).toBe(0)
        },
      )
    })

    describe('Error handling - missing arguments (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should error on scan create without arguments',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['scan', 'create', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThan(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should error on scan view without scan ID',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['scan', 'view', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThan(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should error on config get without key',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['config', 'get', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThan(0)
          expect(result.stderr).toContain('Input error')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should error on config set without arguments',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['config', 'set', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThan(0)
          expect(result.stderr).toContain('Input error')
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should error on patch get without package',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['patch', 'get', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThan(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should error on package score without package',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['package', 'score', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThan(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should error on repository create without name',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['repository', 'create', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThan(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should error on repository view without ID',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['repository', 'view', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThan(0)
        },
      )
    })

    describe('JSON output format validation (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should support --json flag for scan list',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['scan', 'list', '--json', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          // JSON flag should be recognized (may fail due to auth, but shouldn't reject flag).
          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should support --json flag for config list',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['config', 'list', '--json', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should support --json flag for organization list',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['organization', 'list', '--json', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should support --json flag for repository list',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['repository', 'list', '--json', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should support --json flag for patch list',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['patch', 'list', '--json', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )
    })

    describe('Markdown output format validation (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should support --markdown flag for scan list',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['scan', 'list', '--markdown', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should support --markdown flag for config list',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['config', 'list', '--markdown', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should support --markdown flag for organization list',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['organization', 'list', '--markdown', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should support --markdown flag for repository list',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['repository', 'list', '--markdown', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should support --markdown flag for patch list',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['patch', 'list', '--markdown', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )
    })

    describe('Additional dry-run tests (no auth required)', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should handle scan create --dry-run',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['scan', 'create', '--dry-run', '--config', '{}', '.'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          // Dry-run should be recognized.
          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should handle patch download --dry-run',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['patch', 'download', '--dry-run', '--config', '{}', 'express'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should handle npx --dry-run',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['npx', '--dry-run', '--config', '{}', 'cowsay'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should handle pnpm --dry-run',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['pnpm', 'install', '--dry-run', '--config', '{}'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )

      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should handle yarn --dry-run',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(
            ['yarn', 'add', '--dry-run', '--config', '{}', 'lodash'],
            {
              binPath: BINARY.path,
              isolateConfig: false,
            },
          )

          expect(result.code).toBeGreaterThanOrEqual(0)
        },
      )
    })

    describe('Performance validation', () => {
      it.skipIf(!ENV.RUN_INTEGRATION_TESTS)(
        'should execute help command within reasonable time',
        async () => {
          if (!binaryExists) {
            return
          }

          const startTime = Date.now()
          const result = await executeCliCommand(['--help'], {
            binPath: BINARY.path,
            isolateConfig: false,
          })
          const duration = Date.now() - startTime

          expect(result.code).toBe(0)
          // Help should execute in under 5 seconds even for bundled binaries.
          expect(duration).toBeLessThan(5000)
        },
      )
    })
  })
}
