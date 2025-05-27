// The point here is to attempt to detect the various supported manifest files
// the CLI can generate. This would be environments that we can't do server side

import { existsSync } from 'node:fs'
import path from 'node:path'

import { debugLog } from '@socketsecurity/registry/lib/debug'

export interface GeneratableManifests {
  cdxgen: boolean
  count: number
  conda: boolean
  gradle: boolean
  sbt: boolean
}

export async function detectManifestActions(
  cwd = process.cwd(),
): Promise<GeneratableManifests> {
  const output = {
    cdxgen: false, // TODO
    count: 0,
    conda: false,
    gradle: false,
    sbt: false,
  }

  if (existsSync(path.join(cwd, 'build.sbt'))) {
    debugLog('[DEBUG] - Detected a Scala sbt build file')

    output.sbt = true
    output.count += 1
  }

  if (existsSync(path.join(cwd, 'gradlew'))) {
    debugLog('[DEBUG] - Detected a gradle build file')
    output.gradle = true
    output.count += 1
  }

  const envyml = path.join(cwd, 'environment.yml')
  const hasEnvyml = existsSync(envyml)
  const envyaml = path.join(cwd, 'environment.yaml')
  const hasEnvyaml = !hasEnvyml && existsSync(envyaml)
  if (hasEnvyml || hasEnvyaml) {
    debugLog('[DEBUG] - Detected an environment.yml Conda file')
    output.conda = true
    output.count += 1
  }

  return output
}
