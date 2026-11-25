import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  assertCdxgenFixtureOutput,
  writeCdxgenFixture,
} from './cdxgen-fixture.mts'

import type { SeaCapabilities } from '../capabilities.mts'

const exec = promisify(execFile)

export async function smokeTestSea(
  executable: string,
  cwd: string,
  version: string,
  patchVersion: string,
  capabilities: SeaCapabilities,
): Promise<void> {
  await fs.mkdir(cwd)
  const tmp = path.join(cwd, 'tmp')
  await fs.mkdir(tmp)
  const env = {
    PATH: process.env['PATH'],
    SystemRoot: process.env['SystemRoot'],
    // NuGet and MSBuild locate machine-wide configuration and SDKs here.
    ProgramData: process.env['ProgramData'],
    ProgramFiles: process.env['ProgramFiles'],
    'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
    ProgramW6432: process.env['ProgramW6432'],
    DOTNET_ROOT: process.env['DOTNET_ROOT'],
    DOTNET_CLI_HOME: cwd,
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    MSBUILDDISABLENODEREUSE: '1',
    HOME: cwd,
    USERPROFILE: cwd,
    APPDATA: cwd,
    LOCALAPPDATA: cwd,
    CI: '1',
    NO_UPDATE_NOTIFIER: '1',
    SOCKET_CLI_API_BASE_URL: 'http://127.0.0.1:1/v0/',
    SOCKET_CLI_NO_API_TOKEN: '1',
    SOCKET_CLI_CONFIG: '{}',
    TMP: tmp,
    TEMP: tmp,
    TMPDIR: tmp,
  }
  const run = (args: string[], timeout = 30_000, directory = cwd) =>
    exec(executable, args, { cwd: directory, env, timeout, windowsHide: true })

  assert.match((await run(['--help'])).stdout, /\$ socket <command>/u)
  assert.equal(
    (await run(['--version'])).stdout.trim().split(/\s+/u)[0],
    version,
  )

  if (capabilities.available.includes('socket-patch')) {
    const { stdout } = await run(['patch', '--version'])
    assert.equal(stdout.trim(), `socket-patch ${patchVersion}`)
  }
  const { stdout } = await run(['sea', 'smoke-test'])
  assert.match(stdout, /^VFS smoke test passed$/mu)
  await fs.writeFile(
    path.join(cwd, 'NuGet.Config'),
    '<configuration><packageSources><clear /></packageSources></configuration>',
  )
  await fs.writeFile(
    path.join(cwd, 'Smoke.csproj'),
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><DisableImplicitFrameworkReferences>true</DisableImplicitFrameworkReferences></PropertyGroup></Project>',
  )
  await run(['manifest', 'dotnet', 'Smoke.csproj'], 60_000)
  const facts = JSON.parse(
    await fs.readFile(path.join(cwd, 'Smoke.csproj.socket.facts.json'), 'utf8'),
  )
  assert.equal(facts.metadata.tool, 'dotnet')
  assert.ok(
    facts.projects.some(
      (project: { id: string }) => project.id === 'Smoke.csproj',
    ),
  )

  assert.deepEqual(
    (await fs.readdir(tmp)).filter(
      name =>
        name.startsWith('socket-cli-sea-') ||
        name.startsWith('socket-dotnet-facts-'),
    ),
    [],
  )

  for (const [mode, capability] of [
    ['npm', 'manifest-cdxgen-npm-lock-v3'],
    ['yarn', 'manifest-cdxgen-yarn-classic'],
  ] as const) {
    assert.ok(
      capabilities.available.includes(capability),
      `Missing ${capability}`,
    )
    const project = path.join(cwd, mode)
    // eslint-disable-next-line no-await-in-loop -- Verify each generated SBOM before the next command.
    await writeCdxgenFixture(project, mode)
    // eslint-disable-next-line no-await-in-loop
    await run(['manifest', 'cdxgen', '--type', 'npm'], 60_000, project)
    // eslint-disable-next-line no-await-in-loop
    await assertCdxgenFixtureOutput(project, mode)
  }
}
