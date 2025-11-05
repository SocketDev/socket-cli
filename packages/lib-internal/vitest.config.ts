import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    coverage: {
      exclude: [
        '**/dist/external/**',
        '**/src/external/**',
        '**/node_modules/**',
        '**/test/**',
        '**/*.test.ts',
        '**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@socketsecurity/lib/github': `${projectRoot}src/github.ts`,
      '@socketsecurity/lib/env/ci': `${projectRoot}src/env/ci.ts`,
      '@socketsecurity/lib/env/debug': `${projectRoot}src/env/debug.ts`,
      '@socketsecurity/lib/env/github': `${projectRoot}src/env/github.ts`,
      '@socketsecurity/lib/env/home': `${projectRoot}src/env/home.ts`,
      '@socketsecurity/lib/env/locale': `${projectRoot}src/env/locale.ts`,
      '@socketsecurity/lib/env/node-auth-token': `${projectRoot}src/env/node-auth-token.ts`,
      '@socketsecurity/lib/env/node-env': `${projectRoot}src/env/node-env.ts`,
      '@socketsecurity/lib/env/npm': `${projectRoot}src/env/npm.ts`,
      '@socketsecurity/lib/env/path': `${projectRoot}src/env/path.ts`,
      '@socketsecurity/lib/env/pre-commit': `${projectRoot}src/env/pre-commit.ts`,
      '@socketsecurity/lib/env/rewire': `${projectRoot}src/env/rewire.ts`,
      '@socketsecurity/lib/env/shell': `${projectRoot}src/env/shell.ts`,
      '@socketsecurity/lib/env/socket': `${projectRoot}src/env/socket.ts`,
      '@socketsecurity/lib/env/socket-cli': `${projectRoot}src/env/socket-cli.ts`,
      '@socketsecurity/lib/env/socket-cli-shadow': `${projectRoot}src/env/socket-cli-shadow.ts`,
      '@socketsecurity/lib/env/temp-dir': `${projectRoot}src/env/temp-dir.ts`,
      '@socketsecurity/lib/env/term': `${projectRoot}src/env/term.ts`,
      '@socketsecurity/lib/env/test': `${projectRoot}src/env/test.ts`,
      '@socketsecurity/lib/env/windows': `${projectRoot}src/env/windows.ts`,
      '@socketsecurity/lib/env/xdg': `${projectRoot}src/env/xdg.ts`,
      '@socketsecurity/lib/env/helpers': `${projectRoot}src/env/helpers.ts`,
      '#env/rewire': `${projectRoot}src/env/rewire.ts`,
      '#env/helpers': `${projectRoot}src/env/helpers.ts`,
      '#env/ci': `${projectRoot}src/env/ci.ts`,
      '#env/debug': `${projectRoot}src/env/debug.ts`,
      '#env/github': `${projectRoot}src/env/github.ts`,
      '#env/home': `${projectRoot}src/env/home.ts`,
      '#env/node-env': `${projectRoot}src/env/node-env.ts`,
      '#env/socket': `${projectRoot}src/env/socket.ts`,
      '#env/socket-cli': `${projectRoot}src/env/socket-cli.ts`,
      '#env/test': `${projectRoot}src/env/test.ts`,
      '#env/windows': `${projectRoot}src/env/windows.ts`,
      '#lib/paths': `${projectRoot}src/paths.ts`,
    },
  },
})
