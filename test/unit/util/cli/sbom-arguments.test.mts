import { expect, it } from 'vitest'
import { normalizeSbomDirectoryArguments } from '../../../../src/util/cli/sbom-arguments.mts'

it.each([
  [
    ['--dir', 'example-project', 'sbom', '--out', 'bom.json'],
    ['sbom', '--dir', 'example-project', '--out', 'bom.json'],
  ],
  [
    ['-C', 'example-project', 'sbom'],
    ['sbom', '-C', 'example-project'],
  ],
  [
    ['--dir=example-project', 'sbom'],
    ['sbom', '--dir=example-project'],
  ],
  [
    ['-Cexample-project', 'sbom'],
    ['sbom', '-Cexample-project'],
  ],
])('forwards directory flags before the SBOM command', (input, output) => {
  expect(normalizeSbomDirectoryArguments(input)).toEqual(output)
})

it.each(
  [
    [],
    ['--dir'],
    ['sbom', '-C', 'example-project'],
    ['--dir', 'example-project', 'scan'],
    ['--help'],
  ].map(args => ({ args })),
)(
  'leaves unrelated or incomplete arguments for normal validation',
  ({ args }) => {
    expect(normalizeSbomDirectoryArguments(args)).toBe(args)
  },
)
