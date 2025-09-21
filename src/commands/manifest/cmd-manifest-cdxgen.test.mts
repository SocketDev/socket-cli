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
import constants, { FLAG_HELP } from '../../constants.mts'

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
      ['manifest', 'cdxgen', FLAG_HELP],
      `should support ${FLAG_HELP}`,
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          // Need to pass it on as env because --config will break cdxgen.
          env: { SOCKET_CLI_CONFIG: '{}' },
        })

        const redactedStdout = stdout
          .replace(/(?<=CycloneDX\s+Generator\s+)[\d.]+/, '<redacted>')
          .replace(/(?<=Node\.js,\s+Version:\s+)[\d.]+/, '<redacted>')

        const redactedStderr = stderr
          .replace(/CLI:\s+v[\d.]+/, 'CLI: <redacted>')
          .replace(/token:\s+[^,]+/, 'token: <redacted>')
          .replace(/org:\s+[^)]+/, 'org: <redacted>')
          .replace(/cwd:\s+[^\n]+/, 'cwd: <redacted>')

        expect(redactedStdout).toMatchInlineSnapshot(`
          "CycloneDX Generator <redacted>
          Runtime: Node.js, Version: <redacted>"
        `)
        expect(`\n   ${redactedStderr}`).toMatchInlineSnapshot(`
          "
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | CLI: <redacted>
            |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>) who created the BOM. Set this value if you're intending the modify the BOM and claim authorship.  [array] [default: "OWASP Foundation"]
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
        for (const command of ['-h', FLAG_HELP]) {
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
        `${LOG_SYMBOLS.fail} Unknown arguments: -u and --unknown`,
      )
    })
  })
})
