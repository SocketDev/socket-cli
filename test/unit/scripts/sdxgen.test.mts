import { expect, it } from 'vitest'

import { readSdxgenToolVersions } from '../../../scripts/repo/cli-build/sdxgen.mts'

it('maps configured parser tool versions without admitting unrelated tools', () => {
  expect(
    readSdxgenToolVersions({
      tools: {
        maven: { version: '3.9.9' },
        node: { version: '24.0.0' },
        gradle: {},
        go: undefined,
        example: { version: '1.0.0' },
      },
    }),
  ).toEqual({ mvn: { minimum: '3.9.9' }, node: { minimum: '24.0.0' } })
})

it.each([undefined, {}, { tools: 'invalid' }])(
  'rejects invalid upstream tool configuration %j',
  value => {
    expect(() => readSdxgenToolVersions(value)).toThrow(TypeError)
  },
)
