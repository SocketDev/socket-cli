import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type CdxgenFixture = 'npm' | 'yarn'

export const CDXGEN_FIXTURE_OUTPUT = 'socket-cdx.json'

const dependency = 'is-number'
const version = '7.0.0'
const resolved = 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz'
const project = {
  name: 'smoke',
  version: '1.0.0',
  dependencies: { [dependency]: version },
}

export async function assertCdxgenFixtureOutput(
  cwd: string,
  mode: CdxgenFixture,
): Promise<void> {
  const sbom = JSON.parse(
    await fs.readFile(path.join(cwd, CDXGEN_FIXTURE_OUTPUT), 'utf8'),
  ) as {
    bomFormat?: string
    components?: Array<{ name: string; version: string }>
  }
  assert.equal(sbom.bomFormat, 'CycloneDX')
  assert.ok(
    sbom.components?.some(
      component =>
        component.name === dependency && component.version === version,
    ),
    'The SBOM must include the locked dependency',
  )
  if (mode === 'yarn') {
    const leftovers = await fs.readdir(cwd)
    assert.ok(
      !leftovers.includes('package-lock.json'),
      'Synp left its generated lockfile',
    )
    assert.ok(
      !leftovers.some(name => name.startsWith('.socket-cdxgen-lock-')),
      'Synp left a temporary lockfile',
    )
  }
}

export async function writeCdxgenFixture(
  cwd: string,
  mode: CdxgenFixture,
): Promise<void> {
  await fs.mkdir(cwd, { recursive: true })
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify(project))
  if (mode === 'npm') {
    await fs.writeFile(
      path.join(cwd, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': project,
          [`node_modules/${dependency}`]: { version, resolved },
        },
      }),
    )
  } else {
    const installed = path.join(cwd, 'node_modules', dependency)
    await fs.mkdir(installed, { recursive: true })
    await fs.writeFile(
      path.join(installed, 'package.json'),
      JSON.stringify({ name: dependency, version }),
    )
    await fs.writeFile(
      path.join(cwd, 'yarn.lock'),
      `# yarn lockfile v1\n\n${dependency}@${version}:\n  version "${version}"\n  resolved "${resolved}"\n`,
    )
  }
}
