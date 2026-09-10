import path from 'node:path'

import { expect, it } from 'vitest'

import { findUpPackageJson } from '@socketsecurity/lib-stable/packages/find'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

it('preserves the built MCP server tool contract', async () => {
  const result = await spawn('pnpm', ['run', 'mcp:schema:check'], {
    cwd: path.dirname(findUpPackageJson(import.meta)),
    stdio: 'pipe',
    timeout: 30_000,
  })
  expect(result.code).toBe(0)
})
