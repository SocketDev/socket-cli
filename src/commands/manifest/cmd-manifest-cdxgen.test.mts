import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { LOG_SYMBOLS } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  cleanOutput,
  cmdit,
  spawnSocketCli,
  testPath,
} from '../../../test/utils.mts'
import constants from '../../constants.mts'

type PromiseSpawnOptions = Exclude<Parameters<typeof spawn>[2], undefined> & {
  encoding?: BufferEncoding | undefined
}

function createIncludeMatcher(streamName: 'stdout' | 'stderr') {
  return function (received: any, expected: string) {
    const { isNot } = this
    const strippedExpected = cleanOutput(expected)
    const stream = cleanOutput(received?.[streamName] || '')
    return {
      // Do not alter your "pass" based on isNot. Vitest does it for you.
      pass: !!stream?.includes?.(strippedExpected),
      message: () =>
        `spawn.${streamName} ${isNot ? 'does NOT include' : 'includes'} \`${strippedExpected}\`: ${stream}`,
    }
  }
}

// Register custom matchers.
expect.extend({
  toHaveStdoutInclude: createIncludeMatcher('stdout'),
  toHaveStderrInclude: createIncludeMatcher('stderr'),
})

describe('socket manifest cdxgen', async () => {
  const { binCliPath } = constants

  const spawnOpts: PromiseSpawnOptions = {
    env: {
      ...process.env,
      ...constants.processEnv,
      SOCKET_CLI_CONFIG: '{}',
    },
  }

  describe('command forwarding', async () => {
    cmdit(
      ['manifest', 'cdxgen', '--help'],
      'should support --help',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          // Need to pass it on as env because --config will break cdxgen.
          env: { SOCKET_CLI_CONFIG: '{}' },
        })

        const redactedStdout = stdout
          .replace(/(?<=CycloneDX\s+Generator\s+)[\d.]+/, '<redacted>')
          .replace(/(?<=Node\.js,\s+Version:\s+)[\d.]+/, '<redacted>')

        expect(redactedStdout).toMatchInlineSnapshot(`
          "CycloneDX Generator <redacted>
          Runtime: Node.js, Version: <redacted>"
        `)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
            |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest cdxgen\`, cwd: <redacted>

          cdxgen [command]

          Commands:
            cdxgen completion  Generate bash/zsh completion

          Options:
            -o, --output                    Output file. Default bom.json  [default: "bom.json"]
            -t, --type                      Project type. Please refer to https://cyclonedx.github.io/cdxgen/#/PROJECT_TYPES for supported languages/platforms.  [array]
                --exclude-type              Project types to exclude. Please refer to https://cyclonedx.github.io/cdxgen/#/PROJECT_TYPES for supported languages/platforms.
            -r, --recurse                   Recurse mode suitable for mono-repos. Defaults to true. Pass --no-recurse to disable.  [boolean] [default: true]
            -p, --print                     Print the SBOM as a table with tree.  [boolean]
            -c, --resolve-class             Resolve class names for packages. jars only for now.  [boolean]
                --deep                      Perform deep searches for components. Useful while scanning C/C++ apps, live OS and oci images.  [boolean]
                --server-url                Dependency track url. Eg: https://deptrack.cyclonedx.io
                --skip-dt-tls-check         Skip TLS certificate check when calling Dependency-Track.  [boolean] [default: false]
                --api-key                   Dependency track api key
                --project-group             Dependency track project group
                --project-name              Dependency track project name. Default use the directory name
                --project-version           Dependency track project version  [string] [default: ""]
                --project-id                Dependency track project id. Either provide the id or the project name and version together  [string]
                --parent-project-id         Dependency track parent project id  [string]
                --required-only             Include only the packages with required scope on the SBOM. Would set compositions.aggregate to incomplete unless --no-auto-compositions is passed.  [boolean]
                --fail-on-error             Fail if any dependency extractor fails.  [boolean]
                --no-babel                  Do not use babel to perform usage analysis for JavaScript/TypeScript projects.  [boolean]
                --generate-key-and-sign     Generate an RSA public/private key pair and then sign the generated SBOM using JSON Web Signatures.  [boolean]
                --server                    Run cdxgen as a server  [boolean]
                --server-host               Listen address  [default: "127.0.0.1"]
                --server-port               Listen port  [default: "9090"]
                --install-deps              Install dependencies automatically for some projects. Defaults to true but disabled for containers and oci scans. Use --no-install-deps to disable this feature.  [boolean] [default: true]
                --validate                  Validate the generated SBOM using json schema. Defaults to true. Pass --no-validate to disable.  [boolean] [default: true]
                --evidence                  Generate SBOM with evidence for supported languages.  [boolean] [default: false]
                --spec-version              CycloneDX Specification version to use. Defaults to 1.6  [number] [choices: 1.4, 1.5, 1.6, 1.7] [default: 1.6]
                --filter                    Filter components containing this word in purl or component.properties.value. Multiple values allowed.  [array]
                --only                      Include components only containing this word in purl. Useful to generate BOM with first party components alone. Multiple values allowed.  [array]
                --author                    The person(s) who created the BOM. Set this value if you're intending the modify the BOM and claim authorship.  [array] [default: "OWASP Foundation"]
                --profile                   BOM profile to use for generation. Default generic.  [choices: "appsec", "research", "operational", "threat-modeling", "license-compliance", "generic", "machine-learning", "ml", "deep-learning", "ml-deep", "ml-tiny"] [default: "generic"]
                --include-regex             glob pattern to include. This overrides the default pattern used during auto-detection.  [string]
                --exclude, --exclude-regex  Additional glob pattern(s) to ignore  [array]
                --export-proto              Serialize and export BOM as protobuf binary.  [boolean] [default: false]
                --proto-bin-file            Path for the serialized protobuf binary.  [default: "bom.cdx"]
                --include-formulation       Generate formulation section with git metadata and build tools. Defaults to false.  [boolean] [default: false]
                --include-crypto            Include crypto libraries as components.  [boolean] [default: false]
                --standard                  The list of standards which may consist of regulations, industry or organizational-specific standards, maturity models, best practices, or any other requirements which can be evaluated against or attested to.  [array] [choices: "asvs-5.0", "asvs-4.0.3", "bsimm-v13", "masvs-2.0.0", "nist_ssdf-1.1", "pcissc-secure-slc-1.1", "scvs-1.0.0", "ssaf-DRAFT-2023-11"]
                --json-pretty               Pretty-print the generated BOM json.  [boolean] [default: false]
                --min-confidence            Minimum confidence needed for the identity of a component from 0 - 1, where 1 is 100% confidence.  [number] [default: 0]
                --technique                 Analysis technique to use  [array] [choices: "auto", "source-code-analysis", "binary-analysis", "manifest-analysis", "hash-comparison", "instrumentation", "filename"]
                --auto-compositions         Automatically set compositions when the BOM was filtered. Defaults to true  [boolean] [default: true]
            -h, --help                      Show help  [boolean]
            -v, --version                   Show version number  [boolean]

          Examples:
            cdxgen -t java .                       Generate a Java SBOM for the current directory
            cdxgen -t java -t js .                 Generate a SBOM for Java and JavaScript in the current directory
            cdxgen -t java --profile ml .          Generate a Java SBOM for machine learning purposes.
            cdxgen -t python --profile research .  Generate a Python SBOM for appsec research.
            cdxgen --server                        Run cdxgen as a server

          for documentation, visit https://cyclonedx.github.io/cdxgen"
        `)

        expect(code, 'help should exit with code 0').toBe(0)
        expect(stderr, 'banner includes base command').toContain(
          '`socket manifest cdxgen`',
        )
      },
    )

    it.skipIf(constants.WIN32 && constants.ENV.CI)(
      'should forward known flags to cdxgen',
      {
        // Increase timeout for CI environments where cdxgen downloads can be slow.
        timeout: 60_000,
      },
      async () => {
        for (const command of ['-h', '--help']) {
          // eslint-disable-next-line no-await-in-loop
          await expect(
            spawn(
              constants.execPath,
              [binCliPath, 'manifest', 'cdxgen', command],
              spawnOpts,
            ),
            // @ts-ignore toHaveStdoutInclude is defined above.
          ).resolves.toHaveStdoutInclude('CycloneDX Generator')
        }
      },
    )

    it('should not forward an unknown short flag to cdxgen', async () => {
      const command = '-u'
      await expect(
        spawn(
          constants.execPath,
          [binCliPath, 'manifest', 'cdxgen', command],
          spawnOpts,
        ),
        // @ts-ignore toHaveStderrInclude is defined above.
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown argument: ${command}`,
      )
    })

    it('should not forward an unknown flag to cdxgen', async () => {
      const command = '--unknown'
      await expect(
        spawn(
          constants.execPath,
          [binCliPath, 'manifest', 'cdxgen', command],
          spawnOpts,
        ),
        // @ts-ignore toHaveStderrInclude is defined above
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown argument: ${command}`,
      )
    })

    it('should not forward multiple unknown flags to cdxgen', async () => {
      await expect(
        () =>
          spawn(
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', '-u', '-h', '--unknown'],
            spawnOpts,
          ),
        // @ts-ignore toHaveStderrInclude is defined above
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown arguments: -u, --unknown`,
      )
    })
  })
})
