/** @fileoverview Example test file demonstrating comprehensive usage of Socket CLI test helpers. */

import { afterEach, describe, expect, it } from 'vitest'

import {
  executeBatchCliCommands,
  executeCliCommand,
  executeCliJson,
  executeCliWithRetry,
  executeCliWithTiming,
  expectCliError,
  expectCliSuccess,
} from './cli-execution.mts'
import {
  expectNoAnsiCodes,
  expectOrderedPatterns,
  expectOutput,
  expectStdoutContainsAll,
  expectValidJson,
} from './output-assertions.mts'
import {
  expectAllSuccess,
  expectFailure,
  expectFailureWithMessage,
  expectResult,
  expectSuccess,
} from './result-assertions.mts'
import {
  createTestWorkspace,
  createWorkspaceWithLockfile,
  createWorkspaceWithSocketConfig,
  withTestWorkspace,
} from './workspace-helper.mts'

import type { Workspace } from './workspace-helper.mts'

/**
 * Example test suite demonstrating CLI execution helpers
 */
describe('CLI Execution Helpers - Examples', () => {
  describe('executeCliCommand', () => {
    it('should execute basic command', async () => {
      const result = await executeCliCommand(['config', 'list'])

      expect(result.status).toBe(true)
      expect(result.code).toBe(0)
    })

    it('should execute with custom config', async () => {
      const result = await executeCliCommand(['config', 'get', 'apiToken'], {
        config: { apiToken: 'test-token-123' },
      })

      expect(result.status).toBe(true)
      expect(result.stdout).toContain('test-token-123')
    })

    it('should handle command failure', async () => {
      const result = await executeCliCommand(['invalid-command'])

      expect(result.status).toBe(false)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toBeTruthy()
    })
  })

  describe('expectCliSuccess', () => {
    it('should validate successful command', async () => {
      const result = await expectCliSuccess(['--help'])

      expect(result.stdout).toContain('Socket CLI')
      expect(result.stderr).toContain('CLI:')
    })

    it('should throw on command failure', async () => {
      await expect(expectCliSuccess(['invalid-command'])).rejects.toThrow(
        /Expected exit code 0 but got 2/,
      )
    })
  })

  describe('expectCliError', () => {
    it('should validate command failure', async () => {
      const result = await expectCliError(['invalid-command'])

      expect(result.code).not.toBe(0)
      expect(result.status).toBe(false)
    })

    it('should validate specific exit code', async () => {
      const result = await expectCliError(['invalid-command'], 2)

      expect(result.code).toBe(2)
    })
  })

  describe('executeCliJson', () => {
    it('should parse JSON output', async () => {
      const { data, result } = await executeCliJson([
        'config',
        'list',
        '--json',
      ])

      expect(result.status).toBe(true)
      expect(typeof data).toBe('object')
    })

    it('should handle JSON parsing errors', async () => {
      await expect(
        executeCliJson(['--help']), // Help text is not JSON
      ).rejects.toThrow(/Failed to parse JSON/)
    })
  })

  describe('executeCliWithRetry', () => {
    it('should retry on failure', async () => {
      // This command should succeed, so no retries needed.
      const result = await executeCliWithRetry(['config', 'list'], 3, 100)

      expect(result.status).toBe(true)
    })
  })

  describe('executeBatchCliCommands', () => {
    it('should execute multiple commands', async () => {
      const results = await executeBatchCliCommands([
        ['config', 'list'],
        ['whoami'],
      ])

      expect(results).toHaveLength(2)
      expect(results[0].status).toBe(true)
    })
  })

  describe('executeCliWithTiming', () => {
    it('should measure command execution time', async () => {
      const { duration, result } = await executeCliWithTiming([
        'config',
        'list',
      ])

      expect(result.status).toBe(true)
      expect(duration).toBeGreaterThan(0)
      expect(duration).toBeLessThan(5000)
    })
  })
})

/**
 * Example test suite demonstrating output assertion helpers
 */
describe('Output Assertion Helpers - Examples', () => {
  describe('expectOutput fluent API', () => {
    it('should validate success with fluent assertions', async () => {
      const result = await executeCliCommand(['--help'])

      expectOutput(result)
        .succeeded()
        .stdoutContains('socket <command>')
        .stdoutContains('Main commands')
        .stderrContains('CLI:')
    })

    it('should validate failure with fluent assertions', async () => {
      const result = await executeCliCommand(['invalid-command'])

      expectOutput(result).failed().exitCode(2).stdoutContains('Commands')
    })

    it('should validate output patterns', async () => {
      const result = await executeCliCommand(['--help'])

      expectOutput(result)
        .stdoutContains(/socket/i)
        .stdoutNotContains('unexpected')
        .outputContains('socket')
    })
  })

  describe('expectStdoutContainsAll', () => {
    it('should validate multiple required strings', async () => {
      const result = await executeCliCommand(['--help'])

      expectStdoutContainsAll(result.stdout, [
        'Usage',
        'socket <command>',
        'Main commands',
      ])
    })
  })

  describe('expectOrderedPatterns', () => {
    it('should validate pattern order', async () => {
      const result = await executeCliCommand(['--help'])

      expectOrderedPatterns(result.stdout, [
        /usage/i,
        /socket <command>/i,
        /main commands/i,
      ])
    })
  })

  describe('expectValidJson', () => {
    it('should validate and parse JSON', async () => {
      const result = await executeCliCommand(['config', 'list', '--json'])
      const json = expectValidJson<Record<string, unknown>>(result.stdout)

      expect(typeof json).toBe('object')
    })
  })

  describe('expectLineCount', () => {
    it('should validate output line count', async () => {
      const result = await executeCliCommand(['config', 'list', '--json'])
      // JSON output is multi-line formatted.
      expect(result.stdout.split('\n').length).toBeGreaterThan(5)
    })
  })

  describe('expectNoAnsiCodes', () => {
    it('should validate plain text output', async () => {
      const result = await executeCliCommand(['config', 'list', '--json'])
      expectNoAnsiCodes(result.stdout)
    })
  })
})

/**
 * Example test suite demonstrating result assertion helpers
 */
describe('Result Assertion Helpers - Examples', () => {
  // Mock CResult for demonstration
  const mockSuccessResult = {
    ok: true,
    data: { id: 'test-123', name: 'Test Item' },
  } as const

  const mockErrorResult = {
    ok: false,
    message: 'Item not found',
    code: 404,
    cause: 'Invalid ID provided',
  } as const

  describe('expectResult fluent API', () => {
    it('should validate success result', () => {
      expectResult(mockSuccessResult)
        .isSuccess()
        .hasData()
        .dataContains({ id: 'test-123' })
    })

    it('should validate error result', () => {
      expectResult(mockErrorResult)
        .isFailure()
        .messageContains('not found')
        .hasCode(404)
        .hasCause()
    })

    it('should execute callbacks with data', () => {
      expectResult(mockSuccessResult).withData(data => {
        expect(data.id).toBe('test-123')
        expect(data.name).toBe('Test Item')
      })
    })

    it('should execute callbacks with error', () => {
      expectResult(mockErrorResult).withError(error => {
        expect(error.message).toContain('not found')
        expect(error.code).toBe(404)
      })
    })
  })

  describe('expectSuccess', () => {
    it('should extract data from success result', () => {
      const data = expectSuccess(mockSuccessResult)

      expect(data.id).toBe('test-123')
      expect(data.name).toBe('Test Item')
    })

    it('should throw on error result', () => {
      expect(() => expectSuccess(mockErrorResult)).toThrow(
        /Expected successful result/,
      )
    })
  })

  describe('expectFailure', () => {
    it('should extract error from failure result', () => {
      const error = expectFailure(mockErrorResult)

      expect(error.message).toContain('not found')
      expect(error.code).toBe(404)
    })

    it('should throw on success result', () => {
      expect(() => expectFailure(mockSuccessResult)).toThrow(
        /Expected failed result/,
      )
    })
  })

  describe('expectFailureWithMessage', () => {
    it('should validate error message and code', () => {
      expectFailureWithMessage(mockErrorResult, 'not found', 404)
    })

    it('should validate with regex pattern', () => {
      expectFailureWithMessage(mockErrorResult, /item.*not.*found/i)
    })
  })

  describe('expectAllSuccess', () => {
    it('should validate all results succeeded', () => {
      const results = [mockSuccessResult, mockSuccessResult, mockSuccessResult]

      expectAllSuccess(results)
    })

    it('should throw if any result failed', () => {
      const results = [mockSuccessResult, mockErrorResult, mockSuccessResult]

      expect(() => expectAllSuccess(results)).toThrow(/1 failed/)
    })
  })
})

/**
 * Example test suite demonstrating workspace helpers
 */
describe('Workspace Helpers - Examples', () => {
  let workspace: Workspace | undefined

  afterEach(async () => {
    if (workspace) {
      await workspace.cleanup()
      workspace = undefined
    }
  })

  describe('createTestWorkspace', () => {
    it('should create workspace with package.json', async () => {
      workspace = await createTestWorkspace({
        packageJson: {
          name: 'test-workspace',
          version: '1.0.0',
          dependencies: {
            lodash: '^4.17.21',
          },
        },
      })

      expect(await workspace.fileExists('package.json')).toBe(true)

      const content = await workspace.readFile('package.json')
      const pkg = JSON.parse(content)
      expect(pkg.name).toBe('test-workspace')
      expect(pkg.dependencies.lodash).toBe('^4.17.21')
    })

    it('should create workspace with files', async () => {
      workspace = await createTestWorkspace({
        files: [
          { path: 'index.js', content: 'console.log("hello")' },
          { path: 'src/app.js', content: 'module.exports = {}' },
        ],
      })

      expect(await workspace.fileExists('index.js')).toBe(true)
      expect(await workspace.fileExists('src/app.js')).toBe(true)

      const content = await workspace.readFile('index.js')
      expect(content).toContain('hello')
    })
  })

  describe('withTestWorkspace', () => {
    it('should auto-cleanup workspace', async () => {
      let workspacePath = ''

      await withTestWorkspace(
        {
          packageJson: { name: 'auto-cleanup-test' },
        },
        async ws => {
          workspacePath = ws.path
          expect(await ws.fileExists('package.json')).toBe(true)
        },
      )

      // Workspace should be cleaned up automatically
      expect(workspacePath).toBeTruthy()
    })
  })

  describe('createWorkspaceWithLockfile', () => {
    it('should create npm workspace', async () => {
      workspace = await createWorkspaceWithLockfile('npm', {
        express: '^4.18.0',
        lodash: '^4.17.21',
      })

      expect(await workspace.fileExists('package.json')).toBe(true)
      expect(await workspace.fileExists('package-lock.json')).toBe(true)
    })

    it('should create pnpm workspace', async () => {
      workspace = await createWorkspaceWithLockfile('pnpm', {
        react: '^18.0.0',
      })

      expect(await workspace.fileExists('package.json')).toBe(true)
      expect(await workspace.fileExists('pnpm-lock.yaml')).toBe(true)
    })

    it('should create yarn workspace', async () => {
      workspace = await createWorkspaceWithLockfile('yarn', {
        typescript: '^5.0.0',
      })

      expect(await workspace.fileExists('package.json')).toBe(true)
      expect(await workspace.fileExists('yarn.lock')).toBe(true)
    })
  })

  describe('createWorkspaceWithSocketConfig', () => {
    it('should create workspace with .socketrc.json', async () => {
      workspace = await createWorkspaceWithSocketConfig({
        version: 2,
        issueRules: {
          '*': {
            'npm/install-scripts': 'error',
          },
        },
      })

      expect(await workspace.fileExists('.socketrc.json')).toBe(true)

      const content = await workspace.readFile('.socketrc.json')
      const config = JSON.parse(content)
      expect(config.version).toBe(2)
      expect(config.issueRules['*']['npm/install-scripts']).toBe('error')
    })
  })

  describe('workspace operations', () => {
    it('should write and read files', async () => {
      workspace = await createTestWorkspace()

      await workspace.writeFile('test.txt', 'test content')
      const content = await workspace.readFile('test.txt')

      expect(content).toBe('test content')
    })

    it('should resolve paths', async () => {
      workspace = await createTestWorkspace()

      const resolved = workspace.resolve('src', 'index.js')
      expect(resolved).toContain(workspace.path)
      expect(resolved).toMatch(/src[/\\]index\.js$/)
    })

    it('should check file existence', async () => {
      workspace = await createTestWorkspace({
        files: [{ path: 'exists.txt', content: 'test' }],
      })

      expect(await workspace.fileExists('exists.txt')).toBe(true)
      expect(await workspace.fileExists('missing.txt')).toBe(false)
    })
  })
})

/**
 * Example test suite demonstrating combined helper usage
 */
describe('Combined Helper Usage - Real World Examples', () => {
  it('should test complete workflow with all helpers', async () => {
    await withTestWorkspace(
      {
        packageJson: {
          name: 'integration-test',
          dependencies: {
            lodash: '^4.17.21',
          },
        },
      },
      async workspace => {
        // Execute CLI command in workspace.
        const result = await executeCliCommand(['config', 'list'], {
          cwd: workspace.path,
        })

        // Validate output.
        expectOutput(result).succeeded()

        // Verify workspace state.
        expect(await workspace.fileExists('package.json')).toBe(true)
      },
    )
  })

  it('should test with retry and timing', async () => {
    const { duration, result } = await executeCliWithTiming(['config', 'list'])

    expectOutput(result).succeeded()
    expect(duration).toBeLessThan(5000)
  })

  it('should test batch operations', async () => {
    const results = await executeBatchCliCommands([
      ['config', 'list'],
      ['whoami'],
    ])

    expectAllSuccess(
      results.map(r => ({ ok: r.status, data: r.stdout }) as const),
    )
  })
})
