import terminalLink from 'terminal-link'
import yargsParse from 'yargs-parser'

import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { runCdxgen } from './run-cdxgen.mts'
import constants from '../../constants.mts'
import { isHelpFlag } from '../../utils/cmd.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

// TODO: Convert yargs to meow.
const toLower = (arg: string) => arg.toLowerCase()
const arrayToLower = (arg: string[]) => arg.map(toLower)

// npx @cyclonedx/cdxgen@11.2.7 --help
//
// Options:
//   -o, --output                 Output file. Default bom.json                                       [default: "bom.json"]
//   -t, --type                   Project type. Please refer to https://cyclonedx.github.io/cdxgen/#/PROJECT_TYPES for supp
//                                orted languages/platforms.                                                        [array]
//       --exclude-type           Project types to exclude. Please refer to https://cyclonedx.github.io/cdxgen/#/PROJECT_TY
//                                PES for supported languages/platforms.
//   -r, --recurse                Recurse mode suitable for mono-repos. Defaults to true. Pass --no-recurse to disable.
//                                                                                                [boolean] [default: true]
//   -p, --print                  Print the SBOM as a table with tree.                                            [boolean]
//   -c, --resolve-class          Resolve class names for packages. jars only for now.                            [boolean]
//       --deep                   Perform deep searches for components. Useful while scanning C/C++ apps, live OS and oci i
//                                mages.                                                                          [boolean]
//       --server-url             Dependency track url. Eg: https://deptrack.cyclonedx.io
//       --skip-dt-tls-check      Skip TLS certificate check when calling Dependency-Track.      [boolean] [default: false]
//       --api-key                Dependency track api key
//       --project-group          Dependency track project group
//       --project-name           Dependency track project name. Default use the directory name
//       --project-version        Dependency track project version                                   [string] [default: ""]
//       --project-id             Dependency track project id. Either provide the id or the project name and version togeth
//                                er                                                                               [string]
//       --parent-project-id      Dependency track parent project id                                               [string]
//       --required-only          Include only the packages with required scope on the SBOM. Would set compositions.aggrega
//                                te to incomplete unless --no-auto-compositions is passed.                       [boolean]
//       --fail-on-error          Fail if any dependency extractor fails.                                         [boolean]
//       --no-babel               Do not use babel to perform usage analysis for JavaScript/TypeScript projects.  [boolean]
//       --generate-key-and-sign  Generate an RSA public/private key pair and then sign the generated SBOM using JSON Web S
//                                ignatures.                                                                      [boolean]
//       --server                 Run cdxgen as a server                                                          [boolean]
//       --server-host            Listen address                                                     [default: "127.0.0.1"]
//       --server-port            Listen port                                                             [default: "9090"]
//       --install-deps           Install dependencies automatically for some projects. Defaults to true but disabled for c
//                                ontainers and oci scans. Use --no-install-deps to disable this feature.
//                                                                                                [boolean] [default: true]
//       --validate               Validate the generated SBOM using json schema. Defaults to true. Pass --no-validate to di
//                                sable.                                                          [boolean] [default: true]
//       --evidence               Generate SBOM with evidence for supported languages.           [boolean] [default: false]
//       --spec-version           CycloneDX Specification version to use. Defaults to 1.6
//                                                                         [number] [choices: 1.4, 1.5, 1.6] [default: 1.6]
//       --filter                 Filter components containing this word in purl or component.properties.value. Multiple va
//                                lues allowed.                                                                     [array]
//       --only                   Include components only containing this word in purl. Useful to generate BOM with first p
//                                arty components alone. Multiple values allowed.                                   [array]
//       --author                 The person(s) who created the BOM. Set this value if you're intending the modify the BOM
//                                and claim authorship.                               [array] [default: "OWASP Foundation"]
//       --profile                BOM profile to use for generation. Default generic.
//   [choices: "appsec", "research", "operational", "threat-modeling", "license-compliance", "generic", "machine-learning",
//                                                        "ml", "deep-learning", "ml-deep", "ml-tiny"] [default: "generic"]
//       --exclude                Additional glob pattern(s) to ignore                                              [array]
//       --include-formulation    Generate formulation section with git metadata and build tools. Defaults to false.
//                                                                                               [boolean] [default: false]
//       --include-crypto         Include crypto libraries as components.                        [boolean] [default: false]
//       --standard               The list of standards which may consist of regulations, industry or organizational-specif
//                                ic standards, maturity models, best practices, or any other requirements which can be eva
//                                luated against or attested to.
//   [array] [choices: "asvs-5.0", "asvs-4.0.3", "bsimm-v13", "masvs-2.0.0", "nist_ssdf-1.1", "pcissc-secure-slc-1.1", "scv
//                                                                                          s-1.0.0", "ssaf-DRAFT-2023-11"]
//       --json-pretty            Pretty-print the generated BOM json.                           [boolean] [default: false]
//       --min-confidence         Minimum confidence needed for the identity of a component from 0 - 1, where 1 is 100% con
//                                fidence.                                                            [number] [default: 0]
//       --technique              Analysis technique to use
//   [array] [choices: "auto", "source-code-analysis", "binary-analysis", "manifest-analysis", "hash-comparison", "instrume
//                                                                                                    ntation", "filename"]
//       --auto-compositions      Automatically set compositions when the BOM was filtered. Defaults to true
//                                                                                                [boolean] [default: true]
//   -h, --help                   Show help                                                                       [boolean]
//   -v, --version                Show version number                                                             [boolean]

// isSecureMode defined at:
// https://github.com/CycloneDX/cdxgen/blob/v11.2.7/lib/helpers/utils.js#L66
// const isSecureMode =
//   ['true', '1'].includes(process.env?.CDXGEN_SECURE_MODE) ||
//   process.env?.NODE_OPTIONS?.includes('--permission')

// Yargs CDXGEN configuration defined at:
// https://github.com/CycloneDX/cdxgen/blob/v11.2.7/bin/cdxgen.js#L64
const yargsConfig = {
  configuration: {
    'camel-case-expansion': false,
    'greedy-arrays': false,
    'parse-numbers': false,
    'populate--': true,
    'short-option-groups': false,
    'strip-aliased': true,
    'unknown-options-as-args': true,
  },
  coerce: {
    'exclude-type': arrayToLower,
    'feature-flags': arrayToLower,
    filter: arrayToLower,
    only: arrayToLower,
    profile: toLower,
    standard: arrayToLower,
    technique: arrayToLower,
    type: arrayToLower,
  },
  default: {
    //author: ['OWASP Foundation'],
    //'auto-compositions': true,
    //babel: true,
    //banner: false, // hidden
    //'deps-slices-file': 'deps.slices.json', // hidden
    //evidence: false,
    //'exclude-type': [],
    //'export-proto': true, // hidden
    //'fail-on-error': isSecureMode,
    //'feature-flags': [], // hidden
    //'include-crypto': false,
    //'include-formulation': false,
    //'install-deps': !isSecureMode
    //lifecycle: 'build', // hidden
    //'min-confidence': '0',
    //output: 'bom.json',
    //profile: 'generic',
    //'project-version': '',
    //'proto-bin-file': 'bom.cdx', // hidden
    //recurse: true,
    //'skip-dt-tls-check': false,
    //'semantics-slices-file': 'semantics.slices.json',
    //'server-host': '127.0.0.1',
    //'server-port': '9090',
    //'spec-version': '1.6',
    type: ['js'],
    //validate: true,
  },
  alias: {
    help: ['h'],
    output: ['o'],
    print: ['p'],
    recurse: ['r'],
    'resolve-class': ['c'],
    type: ['t'],
    version: ['v'],
    yes: ['y'],
  },
  array: [
    { key: 'author', type: 'string' },
    { key: 'exclude', type: 'string' },
    { key: 'exclude-type', type: 'string' },
    { key: 'feature-flags', type: 'string' }, // hidden
    { key: 'filter', type: 'string' },
    { key: 'only', type: 'string' },
    { key: 'standard', type: 'string' },
    { key: 'technique', type: 'string' },
    { key: 'type', type: 'string' },
  ],
  boolean: [
    'auto-compositions',
    'babel',
    'banner', // hidden
    'deep',
    'evidence',
    'export-proto', // hidden
    'fail-on-error',
    'generate-key-and-sign',
    'help',
    'include-crypto',
    'include-formulation',
    'install-deps',
    'json-pretty',
    'print',
    'recurse',
    'required-only',
    'resolve-class',
    'skip-dt-tls-check',
    'server',
    'validate',
    'version',
    // The --yes flag and -y alias map to the corresponding flag and alias of npx.
    // https://docs.npmjs.com/cli/v7/commands/npx#compatibility-with-older-npx-versions
    'yes',
  ],
  string: [
    'api-key',
    'data-flow-slices-file', // hidden
    'deps-slices-file', // hidden
    'evinse-output', // hidden
    'lifecycle',
    'min-confidence', // number
    'openapi-spec-file', // hidden
    'output',
    'parent-project-id',
    'profile',
    'project-group',
    'project-name',
    'project-version',
    'project-id',
    'proto-bin-file', // hidden
    'reachables-slices-file', // hidden
    'semantics-slices-file', // hidden
    'server-host',
    'server-port',
    'server-url',
    'spec-version', // number
    'usages-slices-file', // hidden
  ],
}

const config: CliCommandConfig = {
  commandName: 'cdxgen',
  description: 'Create an SBOM with CycloneDX generator (cdxgen)',
  hidden: false,
  // Stub out flags and help.
  // TODO: Convert yargs to meow.
  flags: {},
  help: () => '',
}

export const cmdCdxgen = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    allowUnknownFlags: true,
    // Don't let meow take over --help.
    argv: argv.filter(a => !isHelpFlag(a)),
    config,
    importMeta,
    parentName,
  })

  // TODO: Convert yargs to meow.
  const yargv = {
    ...yargsParse(argv as string[], yargsConfig),
  } as any

  const unknown: string[] = yargv._
  const { length: unknownLength } = unknown
  if (unknownLength) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(
      `Unknown ${pluralize('argument', unknownLength)}: ${yargv._.join(', ')}`,
    )
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  // Change defaults when not passing the --help flag.
  if (!yargv.help) {
    // Make 'lifecycle' default to 'pre-build', which also sets 'install-deps' to `false`,
    // to avoid arbitrary code execution on the cdxgen scan.
    // https://github.com/CycloneDX/cdxgen/issues/1328
    if (yargv.lifecycle === undefined) {
      yargv.lifecycle = 'pre-build'
      yargv['install-deps'] = false
      logger.info(
        `Socket set cdxgen --lifecycle to "${yargv.lifecycle}" to avoid arbitrary code execution on this scan.\n  Pass "--lifecycle build" to generate a BOM consisting of information obtained during the build process.\n  See cdxgen ${terminalLink(
          'BOM lifecycles documentation',
          'https://cyclonedx.github.io/cdxgen/#/ADVANCED?id=bom-lifecycles',
        )} for more details.\n`,
      )
    }
    if (yargv.output === undefined) {
      yargv.output = 'socket-cdx.json'
    }
  }

  await runCdxgen(yargv)
}
