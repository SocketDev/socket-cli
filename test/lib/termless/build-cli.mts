import { execSync } from 'node:child_process'

export function setup(): void {
  execSync('pnpm run build:dist:src', {
    env: { ...process.env, VITEST: '', NODE_ENV: 'production' },
    stdio: 'inherit',
  })
}
