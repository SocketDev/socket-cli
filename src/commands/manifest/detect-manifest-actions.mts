// The point here is to attempt to detect the various supported manifest files
// the CLI can generate. This would be environments that we can't do server side

import { existsSync } from 'node:fs'
import path from 'node:path'

import { debugLog } from '@socketsecurity/registry/lib/debug'

export async function detectManifestActions(cwd = process.cwd()): Promise<{
  conda: boolean
  gradle: boolean
  sbt: boolean
}> {
  const output = {
    cdxgen: false,
    conda: false,
    gradle: false,
    sbt: false,
  }

  if (existsSync(path.join(cwd, 'build.sbt'))) {
    debugLog('Detected a Scala sbt build, running default Scala generator...')

    output.sbt = true
  }

  if (existsSync(path.join(cwd, 'gradlew'))) {
    debugLog('Detected a gradle build, running default gradle generator...')
    output.gradle = true
  }

  const envyml = path.join(cwd, 'environment.yml')
  const hasEnvyml = existsSync(envyml)
  const envyaml = path.join(cwd, 'environment.yaml')
  const hasEnvyaml = !hasEnvyml && existsSync(envyaml)
  if (hasEnvyml || hasEnvyaml) {
    debugLog(
      'Detected an environment.yml file, running default Conda generator...',
    )
    output.conda = true
  }

  return output
}
