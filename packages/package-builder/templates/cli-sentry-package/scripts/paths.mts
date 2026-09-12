import { fileURLToPath } from 'node:url'

export const CLI_BUILD_PATH = fileURLToPath(new URL('../build/cli.js', import.meta.url))
