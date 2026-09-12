import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, it } from 'vitest'

it.each(['npm', 'npx', 'pnpm', 'yarn'])(
  'built %s wrapper selects its mode before loading the CLI',
  async mode => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'socket-bin-wrapper-'),
    )
    try {
      const wrapper = path.join(directory, 'wrapper.js')
      await copyFile(
        new URL(`../../dist/socket-${mode}.js`, import.meta.url),
        wrapper,
      )
      await writeFile(
        path.join(directory, 'index.js'),
        'process.stdout.write(process.env.SOCKET_CLI_MODE)\n',
      )
      const result = await spawn(process.execPath, [wrapper], { stdio: 'pipe' })
      expect(result.stdout).toBe(mode)
    } finally {
      await safeDelete(directory, { maxRetries: 0 })
    }
  },
)
