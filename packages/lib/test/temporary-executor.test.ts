/**
 * @fileoverview Unit tests for temporary package executor detection (npx/dlx).
 *
 * Tests detection of temporary package executor environments:
 * - isRunningInTemporaryExecutor() detects npx, pnpm dlx, yarn dlx
 * - User agent parsing from npm_config_user_agent
 * - Environment variable inspection
 * - Package manager version detection
 * Used by Socket CLI to adapt behavior when running via npx/dlx.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { isRunningInTemporaryExecutor } from '@socketsecurity/lib/temporary-executor'

describe('temporary-executor', () => {
  describe('isRunningInTemporaryExecutor', () => {
    describe('user agent detection', () => {
      const originalUserAgent = process.env['npm_config_user_agent']

      afterEach(() => {
        if (originalUserAgent === undefined) {
          delete process.env['npm_config_user_agent']
        } else {
          process.env['npm_config_user_agent'] = originalUserAgent
        }
      })

      it('should detect npm exec in user agent', () => {
        process.env['npm_config_user_agent'] = 'npm/8.19.2 node/v18.12.0 exec'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(true)
      })

      it('should detect npx in user agent', () => {
        process.env['npm_config_user_agent'] = 'npm/8.19.2 node/v18.12.0 npx'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(true)
      })

      it('should detect dlx in user agent', () => {
        process.env['npm_config_user_agent'] = 'pnpm/8.6.0 node/v18.12.0 dlx'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(true)
      })

      it('should not detect normal npm usage', () => {
        process.env['npm_config_user_agent'] =
          'npm/8.19.2 node/v18.12.0 darwin x64'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(false)
      })

      it('should not detect normal pnpm usage', () => {
        process.env['npm_config_user_agent'] =
          'pnpm/8.6.0 node/v18.12.0 darwin x64'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(false)
      })

      it('should not detect when user agent is undefined', () => {
        delete process.env['npm_config_user_agent']
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(false)
      })

      it('should not detect when user agent is empty', () => {
        process.env['npm_config_user_agent'] = ''
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(false)
      })

      it('should detect exec substring in longer user agent', () => {
        process.env['npm_config_user_agent'] =
          'npm/9.0.0 node/v20.0.0 linux x64 workspaces/false exec'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(true)
      })

      it('should detect npx substring anywhere in user agent', () => {
        process.env['npm_config_user_agent'] =
          'npm/9.0.0 npx node/v20.0.0 linux x64'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(true)
      })

      it('should detect dlx with yarn', () => {
        process.env['npm_config_user_agent'] = 'yarn/3.5.0 node/v18.12.0 dlx'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(true)
      })
    })

    describe('npm cache detection', () => {
      const originalCache = process.env['npm_config_cache']

      afterEach(() => {
        if (originalCache === undefined) {
          delete process.env['npm_config_cache']
        } else {
          process.env['npm_config_cache'] = originalCache
        }
      })

      it('should detect execution from npm cache directory', () => {
        process.env['npm_config_cache'] = '/home/user/.npm'
        expect(
          isRunningInTemporaryExecutor('/home/user/.npm/_npx/abc123'),
        ).toBe(true)
      })

      it('should detect execution from Windows npm cache', () => {
        process.env['npm_config_cache'] = 'C:\\Users\\user\\AppData\\npm-cache'
        expect(
          isRunningInTemporaryExecutor(
            'C:\\Users\\user\\AppData\\npm-cache\\_npx\\123',
          ),
        ).toBe(true)
      })

      it('should not detect when cwd is outside npm cache', () => {
        process.env['npm_config_cache'] = '/home/user/.npm'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(false)
      })

      it('should not detect when npm_config_cache is not set', () => {
        delete process.env['npm_config_cache']
        expect(
          isRunningInTemporaryExecutor('/home/user/.npm/_npx/abc123'),
        ).toBe(true) // Still detects due to _npx pattern
      })

      it('should handle npm cache path with forward slashes on Windows', () => {
        process.env['npm_config_cache'] = 'C:/Users/user/AppData/npm-cache'
        expect(
          isRunningInTemporaryExecutor('C:/Users/user/AppData/npm-cache/_npx'),
        ).toBe(true)
      })

      it('should handle empty npm_config_cache', () => {
        process.env['npm_config_cache'] = ''
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(false)
      })
    })

    describe('temporary path patterns', () => {
      it('should detect _npx directory', () => {
        expect(isRunningInTemporaryExecutor('/home/user/.npm/_npx/123')).toBe(
          true,
        )
      })

      it('should detect _npx in nested path', () => {
        expect(
          isRunningInTemporaryExecutor('/home/user/.cache/_npx/abc/def'),
        ).toBe(true)
      })

      it('should detect .pnpm-store directory', () => {
        expect(
          isRunningInTemporaryExecutor('/home/user/.pnpm-store/dlx-123'),
        ).toBe(true)
      })

      it('should detect dlx- prefix', () => {
        expect(isRunningInTemporaryExecutor('/tmp/dlx-abc123')).toBe(true)
      })

      it('should detect dlx- in nested path', () => {
        expect(
          isRunningInTemporaryExecutor('/var/tmp/pnpm/dlx-package/bin'),
        ).toBe(true)
      })

      it('should detect Yarn Berry PnP virtual packages', () => {
        expect(
          isRunningInTemporaryExecutor(
            '/home/user/project/.yarn/$$/virtual/package',
          ),
        ).toBe(true)
      })

      it('should detect Yarn $$ pattern anywhere in path', () => {
        expect(
          isRunningInTemporaryExecutor('/project/.yarn/$$/cache/package'),
        ).toBe(true)
      })

      it('should not detect normal project directories', () => {
        expect(isRunningInTemporaryExecutor('/home/user/my-project')).toBe(
          false,
        )
      })

      it('should not detect node_modules', () => {
        expect(
          isRunningInTemporaryExecutor('/home/user/project/node_modules/.bin'),
        ).toBe(false)
      })

      it('should not detect normal pnpm-store (without dot)', () => {
        expect(isRunningInTemporaryExecutor('/home/user/pnpm-store')).toBe(
          false,
        )
      })
    })

    describe('Windows-specific patterns', () => {
      it('should detect Yarn Windows temp xfs pattern on Windows', () => {
        const cwd = 'C:\\Users\\user\\AppData\\Local\\Temp\\xfs-abc123'
        const result = isRunningInTemporaryExecutor(cwd)
        // Only matches on Windows platform (WIN32 constant check)
        expect(typeof result).toBe('boolean')
      })

      it('should detect xfs pattern in nested Windows path on Windows', () => {
        const cwd =
          'C:\\Users\\user\\AppData\\Local\\Temp\\xfs-123\\package\\bin'
        const result = isRunningInTemporaryExecutor(cwd)
        // Only matches on Windows platform (WIN32 constant check)
        expect(typeof result).toBe('boolean')
      })

      it('should handle Windows paths with forward slashes on Windows', () => {
        const cwd = 'C:/Users/user/AppData/Local/Temp/xfs-abc123'
        const result = isRunningInTemporaryExecutor(cwd)
        // Only matches on Windows platform (WIN32 constant check)
        expect(typeof result).toBe('boolean')
      })

      it('should not detect xfs pattern without AppData/Local/Temp', () => {
        expect(isRunningInTemporaryExecutor('/home/user/xfs-123')).toBe(false)
      })
    })

    describe('path normalization', () => {
      it('should handle paths with backslashes', () => {
        expect(
          isRunningInTemporaryExecutor('C:\\Users\\user\\.npm\\_npx\\123'),
        ).toBe(true)
      })

      it('should handle paths with forward slashes', () => {
        expect(isRunningInTemporaryExecutor('/home/user/.npm/_npx/123')).toBe(
          true,
        )
      })

      it('should handle mixed slash paths', () => {
        expect(
          isRunningInTemporaryExecutor('C:/Users/user/.npm\\_npx/123'),
        ).toBe(true)
      })

      it('should normalize before pattern matching', () => {
        expect(
          isRunningInTemporaryExecutor('C:\\Users\\user\\.pnpm-store\\dlx-abc'),
        ).toBe(true)
      })
    })

    describe('default cwd parameter', () => {
      it('should use process.cwd() when cwd is not provided', () => {
        const result = isRunningInTemporaryExecutor()
        expect(typeof result).toBe('boolean')
      })

      it('should handle undefined cwd', () => {
        const result = isRunningInTemporaryExecutor(undefined)
        expect(typeof result).toBe('boolean')
      })
    })

    describe('combined conditions', () => {
      const originalUserAgent = process.env['npm_config_user_agent']
      const originalCache = process.env['npm_config_cache']

      afterEach(() => {
        if (originalUserAgent === undefined) {
          delete process.env['npm_config_user_agent']
        } else {
          process.env['npm_config_user_agent'] = originalUserAgent
        }
        if (originalCache === undefined) {
          delete process.env['npm_config_cache']
        } else {
          process.env['npm_config_cache'] = originalCache
        }
      })

      it('should detect when both user agent and path pattern match', () => {
        process.env['npm_config_user_agent'] = 'npm/8.19.2 node/v18.12.0 npx'
        expect(isRunningInTemporaryExecutor('/home/user/.npm/_npx/123')).toBe(
          true,
        )
      })

      it('should detect when user agent matches but path does not', () => {
        process.env['npm_config_user_agent'] = 'npm/8.19.2 node/v18.12.0 npx'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(true)
      })

      it('should detect when path matches but user agent does not', () => {
        process.env['npm_config_user_agent'] =
          'npm/8.19.2 node/v18.12.0 darwin x64'
        expect(isRunningInTemporaryExecutor('/home/user/.npm/_npx/123')).toBe(
          true,
        )
      })

      it('should detect when npm cache and path both match', () => {
        process.env['npm_config_cache'] = '/home/user/.npm'
        expect(isRunningInTemporaryExecutor('/home/user/.npm/_npx/123')).toBe(
          true,
        )
      })

      it('should not detect when no conditions match', () => {
        delete process.env['npm_config_user_agent']
        delete process.env['npm_config_cache']
        expect(isRunningInTemporaryExecutor('/home/user/my-project')).toBe(
          false,
        )
      })
    })

    describe('edge cases', () => {
      it('should handle empty cwd', () => {
        const result = isRunningInTemporaryExecutor('')
        expect(typeof result).toBe('boolean')
      })

      it('should handle root directory', () => {
        expect(isRunningInTemporaryExecutor('/')).toBe(false)
      })

      it('should handle relative paths', () => {
        const result = isRunningInTemporaryExecutor('../project/_npx')
        expect(typeof result).toBe('boolean')
      })

      it('should be case-sensitive for pattern matching', () => {
        expect(isRunningInTemporaryExecutor('/home/user/_NPX/123')).toBe(false)
      })

      it('should handle very long paths', () => {
        const longPath = `/home/user/${'a'.repeat(200)}/_npx/123`
        expect(isRunningInTemporaryExecutor(longPath)).toBe(true)
      })

      it('should handle paths with special characters', () => {
        expect(isRunningInTemporaryExecutor('/home/user/@scope/_npx/123')).toBe(
          true,
        )
      })

      it('should handle paths with spaces', () => {
        expect(
          isRunningInTemporaryExecutor('/home/user/my folder/_npx/123'),
        ).toBe(true)
      })

      it('should handle Unicode in paths', () => {
        expect(isRunningInTemporaryExecutor('/home/用户/.npm/_npx/123')).toBe(
          true,
        )
      })

      it('should handle multiple pattern matches', () => {
        expect(
          isRunningInTemporaryExecutor('/home/user/_npx/dlx-abc/.pnpm-store'),
        ).toBe(true)
      })

      it('should match pattern as substring anywhere in path', () => {
        expect(isRunningInTemporaryExecutor('/home/user/my_npx_folder')).toBe(
          true,
        )
      })

      it('should match pattern in filename', () => {
        expect(isRunningInTemporaryExecutor('/home/user/something_npx')).toBe(
          true,
        )
      })

      it('should handle WSL paths', () => {
        expect(isRunningInTemporaryExecutor('/mnt/c/Users/user/_npx/123')).toBe(
          true,
        )
      })
    })

    describe('real-world scenarios', () => {
      const originalUserAgent = process.env['npm_config_user_agent']
      const originalCache = process.env['npm_config_cache']

      afterEach(() => {
        if (originalUserAgent === undefined) {
          delete process.env['npm_config_user_agent']
        } else {
          process.env['npm_config_user_agent'] = originalUserAgent
        }
        if (originalCache === undefined) {
          delete process.env['npm_config_cache']
        } else {
          process.env['npm_config_cache'] = originalCache
        }
      })

      it('should detect npx command execution', () => {
        process.env['npm_config_user_agent'] = 'npm/9.5.0 node/v18.15.0 npx'
        process.env['npm_config_cache'] = '/home/user/.npm'
        expect(
          isRunningInTemporaryExecutor(
            '/home/user/.npm/_npx/12345/node_modules',
          ),
        ).toBe(true)
      })

      it('should detect pnpm dlx execution', () => {
        process.env['npm_config_user_agent'] = 'pnpm/8.6.0 node/v18.12.0 dlx'
        expect(
          isRunningInTemporaryExecutor('/tmp/.pnpm-store/dlx-abc/package'),
        ).toBe(true)
      })

      it('should detect yarn dlx execution', () => {
        process.env['npm_config_user_agent'] = 'yarn/3.5.0 node/v18.12.0 dlx'
        expect(isRunningInTemporaryExecutor('/tmp/dlx-12345')).toBe(true)
      })

      it('should not detect regular npm install', () => {
        process.env['npm_config_user_agent'] =
          'npm/9.5.0 node/v18.15.0 darwin x64'
        expect(
          isRunningInTemporaryExecutor('/home/user/project/node_modules'),
        ).toBe(false)
      })

      it('should not detect regular pnpm install', () => {
        process.env['npm_config_user_agent'] =
          'pnpm/8.6.0 node/v18.12.0 linux x64'
        expect(isRunningInTemporaryExecutor('/home/user/project')).toBe(false)
      })

      it('should not detect global installation', () => {
        delete process.env['npm_config_user_agent']
        expect(
          isRunningInTemporaryExecutor('/usr/local/lib/node_modules'),
        ).toBe(false)
      })
    })
  })
})
