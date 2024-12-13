import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'
import colors from 'yoctocolors-cjs'
import yargsParse from 'yargs-parser'
import { pluralize } from '@socketsecurity/registry/lib/words'

import constants from '../constants'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const { cdxgenBinPath, synpBinPath } = constants
const { execPath } = process

const {
  SBOM_SIGN_ALGORITHM, // Algorithm. Example: RS512
  SBOM_SIGN_PRIVATE_KEY, // Location to the RSA private key
  SBOM_SIGN_PUBLIC_KEY // Optional. Location to the RSA public key
} = process.env

const toLower = (arg: string) => arg.toLowerCase()
const arrayToLower = (arg: string[]) => arg.map(toLower)

const nodejsPlatformTypes = new Set([
  'javascript',
  'js',
  'nodejs',
  'npm',
  'pnpm',
  'ts',
  'tsx',
  'typescript'
])

const yargsConfig = {
  configuration: {
    'camel-case-expansion': false,
    'strip-aliased': true,
    'parse-numbers': false,
    'populate--': true,
    'unknown-options-as-args': true
  },
  coerce: {
    author: arrayToLower,
    filter: arrayToLower,
    only: arrayToLower,
    profile: toLower,
    standard: arrayToLower,
    type: toLower
  },
  default: {
    //author: ['OWASP Foundation'],
    //'auto-compositions': true,
    //babel: true,
    //evidence: false,
    //'include-crypto': false,
    //'include-formulation': false,

    // Default 'install-deps' to `false` and 'lifecycle' to 'pre-build' to
    // sidestep arbitrary code execution during a cdxgen scan.
    // https://github.com/CycloneDX/cdxgen/issues/1328
    'install-deps': false,
    lifecycle: 'pre-build',

    //output: 'bom.json',
    //profile: 'generic',
    //'project-version': '',
    //recurse: true,
    //'server-host': '127.0.0.1',
    //'server-port': '9090',
    //'spec-version': '1.5',
    type: 'js'
    //validate: true,
  },
  alias: {
    help: ['h'],
    output: ['o'],
    print: ['p'],
    recurse: ['r'],
    'resolve-class': ['c'],
    type: ['t'],
    version: ['v']
  },
  array: [
    { key: 'author', type: 'string' },
    { key: 'exclude', type: 'string' },
    { key: 'filter', type: 'string' },
    { key: 'only', type: 'string' },
    { key: 'standard', type: 'string' }
  ],
  boolean: [
    'auto-compositions',
    'babel',
    'deep',
    'evidence',
    'fail-on-error',
    'generate-key-and-sign',
    'help',
    'include-formulation',
    'include-crypto',
    'install-deps',
    'print',
    'required-only',
    'server',
    'validate',
    'version'
  ],
  string: [
    'api-key',
    'lifecycle',
    'output',
    'parent-project-id',
    'profile',
    'project-group',
    'project-name',
    'project-version',
    'project-id',
    'server-host',
    'server-port',
    'server-url',
    'spec-version'
  ]
}

function argvToArray(argv: {
  [key: string]: boolean | null | number | string | (string | number)[]
}): string[] {
  if (argv['help']) return ['--help']
  const result = []
  for (const { 0: key, 1: value } of Object.entries(argv)) {
    if (key === '_' || key === '--') continue
    if (key === 'babel' || key === 'install-deps' || key === 'validate') {
      // cdxgen documents no-babel, no-install-deps, and no-validate flags so
      // use them when relevant.
      result.push(`--${value ? key : `no-${key}`}`)
    } else if (value === true) {
      result.push(`--${key}`)
    } else if (typeof value === 'string') {
      result.push(`--${key}`, String(value))
    } else if (Array.isArray(value)) {
      result.push(`--${key}`, ...value.map(String))
    }
  }
  if (argv['--']) {
    result.push('--', ...(argv as any)['--'])
  }
  return result
}

export const cdxgen: CliSubcommand = {
  description: 'Create an SBOM with CycloneDX generator (cdxgen)',
  async run(argv_) {
    const yargv = <any>{
      ...yargsParse(<string[]>argv_, yargsConfig)
    }
    const unknown: string[] = yargv._
    const { length: unknownLength } = unknown
    if (unknownLength) {
      console.error(
        `Unknown ${pluralize('argument', unknownLength)}: ${yargv._.join(', ')}`
      )
      process.exitCode = 1
      return
    }
    let cleanupPackageLock = false
    if (
      yargv.type !== 'yarn' &&
      nodejsPlatformTypes.has(yargv.type) &&
      existsSync('./yarn.lock')
    ) {
      if (existsSync('./package-lock.json')) {
        yargv.type = 'npm'
      } else {
        // Use synp to create a package-lock.json from the yarn.lock,
        // based on the node_modules folder, for a more accurate SBOM.
        try {
          await spawn(
            execPath,
            [await fs.realpath(synpBinPath), '--source-file', './yarn.lock'],
            { shell: true }
          )
          yargv.type = 'npm'
          cleanupPackageLock = true
        } catch {}
      }
    }
    if (yargv.output === undefined) {
      yargv.output = 'socket-cdx.json'
    }
    await spawn(
      execPath,
      [await fs.realpath(cdxgenBinPath), ...argvToArray(yargv)],
      {
        env: {
          NODE_ENV: '',
          SBOM_SIGN_ALGORITHM,
          SBOM_SIGN_PRIVATE_KEY,
          SBOM_SIGN_PUBLIC_KEY
        },
        shell: true,
        stdio: 'inherit'
      }
    )
    if (cleanupPackageLock) {
      try {
        await fs.unlink('./package-lock.json')
      } catch {}
    }
    const fullOutputPath = path.join(process.cwd(), yargv.output)
    if (existsSync(fullOutputPath)) {
      console.log(colors.cyanBright(`${yargv.output} created!`))
    }
  }
}
