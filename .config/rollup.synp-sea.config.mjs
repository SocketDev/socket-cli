/** Bundle the pinned Synp API and its dependency/license closure for SEA VFS. */
/* eslint-disable no-await-in-loop -- VFS staging writes shared paths in dependency order. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import commonjsPlugin from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'

const root = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..',
)
const legalPattern =
  /^(?:license|licence|copying|copyright|notice|patents?)(?:[._ -].*)?$/i

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function slug(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '_') || 'unknown'
}

async function packageRootFor(modulePath) {
  let current = path.dirname(modulePath)
  while (current !== path.dirname(current)) {
    try {
      const metadata = JSON.parse(
        await fs.readFile(path.join(current, 'package.json'), 'utf8'),
      )
      if (
        typeof metadata.name === 'string' &&
        typeof metadata.version === 'string'
      ) {
        return { root: current, metadata }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error
      }
    }
    if (path.basename(current) === 'node_modules') {
      break
    }
    current = path.dirname(current)
  }
}

async function legalFiles(packageRoot) {
  const found = []
  const visit = async (directory, relative = '') => {
    for (const entry of (
      await fs.readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = path.posix.join(
        relative.split(path.sep).join('/'),
        entry.name,
      )
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          await visit(fullPath, path.join(relative, entry.name))
        }
      } else if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        legalPattern.test(entry.name)
      ) {
        const resolvedPath = await fs.realpath(fullPath)
        if (
          resolvedPath !== packageRoot &&
          !resolvedPath.startsWith(`${packageRoot}${path.sep}`)
        ) {
          throw new Error(
            `Synp notice file escapes package root: ${relativePath}`,
          )
        }
        found.push({ fullPath: resolvedPath, relativePath })
      }
    }
  }
  await visit(packageRoot)
  return found
}

function noticesPlugin() {
  return {
    name: 'sea-synp-third-party-notices',
    async generateBundle() {
      const packages = new Map()
      const unmapped = []
      for (const id of this.getModuleIds()) {
        if (id.startsWith('\0')) {
          continue
        }
        const raw = id.startsWith('file:')
          ? url.fileURLToPath(id)
          : id.split('?')[0]
        if (
          !path.isAbsolute(raw) ||
          !raw.split(path.sep).includes('node_modules')
        ) {
          continue
        }
        let real
        try {
          real = await fs.realpath(raw)
        } catch (error) {
          if (error?.code === 'ENOENT') {
            continue
          }
          throw error
        }
        const info = await packageRootFor(real)
        if (!info) {
          unmapped.push(real)
          continue
        }
        const key = `${info.metadata.name}@${info.metadata.version}`
        if (!packages.has(key)) {
          packages.set(key, { ...info, key })
        }
      }
      if (unmapped.length) {
        throw new Error(
          `Unable to map ${unmapped.length} bundled Synp module(s) to package metadata`,
        )
      }

      const inventory = {
        schemaVersion: 1,
        generator: 'rollup-module-closure',
        packages: [],
        obligations: [],
      }
      for (const record of [...packages.values()].sort((a, b) =>
        a.key.localeCompare(b.key),
      )) {
        const files = await legalFiles(record.root)
        const obligations = []
        if (!files.length) {
          obligations.push({
            code: 'missing-license-text',
            message:
              'No license or notice text file is present in the installed package; its package metadata license is retained.',
          })
        }
        const packageSlug = `${slug(record.metadata.name)}-${slug(record.metadata.version)}`
        const licenseFiles = []
        const noticeFiles = []
        for (const file of files) {
          const contents = await fs.readFile(file.fullPath)
          const filename = `notices/${packageSlug}/${file.relativePath}`
          this.emitFile({ type: 'asset', fileName: filename, source: contents })
          const reference = {
            path: `tools/synp/${filename}`,
            sourcePath: file.relativePath,
            sha256: digest(contents),
          }
          if (
            /^(?:notice|copyright|patents?)/i.test(
              path.posix.basename(file.relativePath),
            )
          ) {
            noticeFiles.push(reference)
          } else {
            licenseFiles.push(reference)
          }
        }
        inventory.packages.push({
          name: record.metadata.name,
          version: record.metadata.version,
          license: record.metadata.license ?? record.metadata.licenses ?? null,
          licenseFiles,
          noticeFiles,
          obligations,
        })
        for (const obligation of obligations) {
          inventory.obligations.push({ package: record.key, ...obligation })
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD-PARTY-NOTICES.json',
        source: `${JSON.stringify(inventory, null, 2)}\n`,
      })
    },
  }
}

export default {
  input:
    process.env.SEA_SYNP_INPUT ||
    path.join(root, 'src/sea/adapters/synp-worker.mjs'),
  output: {
    dir: process.env.SEA_SYNP_OUTPUT || path.join(root, 'dist/sea-synp'),
    format: 'cjs',
    entryFileNames: 'bin/synp.js',
  },
  external: id =>
    id.startsWith('node:') ||
    [
      'assert',
      'buffer',
      'crypto',
      'fs',
      'fs/promises',
      'module',
      'os',
      'path',
      'stream',
      'url',
      'util',
      'worker_threads',
    ].includes(id),
  plugins: [
    nodeResolve({ preferBuiltins: true, exportConditions: ['node'] }),
    commonjsPlugin(),
    noticesPlugin(),
  ],
}
