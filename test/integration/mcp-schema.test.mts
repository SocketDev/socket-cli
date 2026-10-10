import { expect, it } from 'vitest'

import { runSchema } from '../../scripts/repo/cli-build/mcp-schema.mts'

it('preserves built MCP tool names and input/output schemas', () => {
  expect(() => runSchema('check')).not.toThrow()
})
