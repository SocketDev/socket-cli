/* eslint-disable no-await-in-loop -- Nested lockfile annotations are written in traversal order. */

import { createHash } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { workerData } from 'node:worker_threads'

import { isObjectObject } from '../../utils/is-object-object.mjs'

const require = createRequire(import.meta.url)

async function main() {
  const ipc = workerData && workerData.socketIpc
  if (
    !ipc ||
    typeof ipc.projectPath !== 'string' ||
    typeof ipc.outputPath !== 'string' ||
    typeof ipc.tempDev !== 'string' ||
    typeof ipc.tempIno !== 'string' ||
    path.dirname(path.resolve(ipc.outputPath)) !==
      path.resolve(ipc.projectPath) ||
    !/^\.socket-cdxgen-lock-[a-f\d-]+\.tmp$/i.test(
      path.basename(ipc.outputPath),
    )
  ) {
    throw new Error('Invalid Socket Synp Worker request')
  }

  const projectPath = path.resolve(ipc.projectPath)
  const outputPath = path.resolve(ipc.outputPath)
  const yarnLockPath = path.join(projectPath, 'yarn.lock')
  const yarnLock = await readFile(yarnLockPath, 'utf8')
  if (!/^# yarn lockfile v1(?:\r?\n|$)/m.test(yarnLock)) {
    throw new Error('Embedded Synp supports Yarn Classic lockfile v1 only')
  }

  const packageJson = JSON.parse(
    await readFile(path.join(projectPath, 'package.json'), 'utf8'),
  )
  if (packageJson.workspaces) {
    throw new Error('Embedded Synp does not support workspaces')
  }
  if (
    Object.values({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
    }).some(
      value => typeof value === 'string' && value.startsWith('workspace:'),
    )
  ) {
    throw new Error(
      'Embedded Synp does not support Yarn workspace dependencies',
    )
  }
  const nodeModules = await stat(path.join(projectPath, 'node_modules'))
  if (!nodeModules.isDirectory()) {
    throw new Error('Embedded Synp requires an existing node_modules directory')
  }

  const synp = require('synp')
  const converted = JSON.parse(synp.yarnToNpm(projectPath, false))
  if (converted.lockfileVersion !== 1) {
    throw new Error('Synp returned an unsupported package-lock format')
  }
  const annotateDependencies = async (dependencies, modulesPath) => {
    if (dependencies !== undefined && !isObjectObject(dependencies)) {
      throw new Error('Synp returned a malformed dependencies map')
    }
    for (const [name, entry] of Object.entries(dependencies || {})) {
      const packagePath = path.join(modulesPath, ...name.split('/'))
      let manifest
      try {
        manifest = JSON.parse(
          await readFile(path.join(packagePath, 'package.json'), 'utf8'),
        )
      } catch {
        throw new Error(
          `Synp lock entry '${name}' has no matching installed package manifest`,
        )
      }
      entry._socketOptionalDependencies = Object.keys(
        manifest.optionalDependencies || {},
      )
      entry._socketPeerDependencies = Object.keys(
        manifest.peerDependencies || {},
      )
      await annotateDependencies(
        entry.dependencies,
        path.join(packagePath, 'node_modules'),
      )
    }
  }
  await annotateDependencies(
    converted.dependencies,
    path.join(projectPath, 'node_modules'),
  )
  const findDependency = (name, ownDependencies, ancestorMaps) => {
    if (
      isObjectObject(ownDependencies) &&
      Object.hasOwn(ownDependencies, name)
    ) {
      return ownDependencies[name]
    }
    for (const map of ancestorMaps) {
      if (isObjectObject(map) && Object.hasOwn(map, name)) {
        return map[name]
      }
    }
  }
  const collectDependencies = (name, entry, ancestorMaps, collected) => {
    if (!entry || collected.has(entry)) {
      return
    }
    collected.add(entry)
    if (entry.requires !== undefined && !isObjectObject(entry.requires)) {
      throw new Error(`Synp returned a malformed requires map for '${name}'`)
    }
    const visibleMaps = [entry.dependencies, ...ancestorMaps]
    const dependencyNames = new Set([
      ...Object.keys(entry.requires || {}),
      ...(entry._socketOptionalDependencies || []),
    ])
    for (const dependencyName of dependencyNames) {
      collectDependencies(
        dependencyName,
        findDependency(dependencyName, entry.dependencies, visibleMaps),
        visibleMaps,
        collected,
      )
    }
  }
  const productionEntries = new Set()
  for (const name of [
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.optionalDependencies || {}),
  ]) {
    collectDependencies(
      name,
      findDependency(name, converted.dependencies, []),
      [converted.dependencies],
      productionEntries,
    )
  }
  const developmentEntries = new Set()
  for (const name of Object.keys(packageJson.devDependencies || {})) {
    collectDependencies(
      name,
      findDependency(name, converted.dependencies, []),
      [converted.dependencies],
      developmentEntries,
    )
  }
  for (const entry of productionEntries) {
    entry.dev = false
  }
  for (const entry of developmentEntries) {
    if (!productionEntries.has(entry)) {
      entry.dev = true
    }
  }
  const bytes = Buffer.from(`${JSON.stringify(converted, null, 2)}\n`)
  const digest = createHash('sha256').update(bytes).digest('hex')
  let handle
  try {
    handle = await open(outputPath, 'r+')
    const createdStat = await handle.stat()
    if (
      String(createdStat.dev) !== ipc.tempDev ||
      String(createdStat.ino) !== ipc.tempIno
    ) {
      throw new Error(
        'Synp temporary output ownership changed before conversion',
      )
    }
    await handle.truncate(0)
    await handle.writeFile(bytes)
    await handle.sync()
    process.stdout.write(
      `${JSON.stringify({ dev: String(createdStat.dev), ino: String(createdStat.ino), size: bytes.length, sha256: digest })}\n`,
    )
  } finally {
    await handle?.close()
  }
}

main().catch(error => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
  process.exitCode = 1
})
