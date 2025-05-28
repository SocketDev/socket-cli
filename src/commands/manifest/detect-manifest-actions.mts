// The point here is to attempt to detect the various supported manifest files
// the CLI can generate. This would be environments that we can't do server side

import { existsSync } from 'node:fs'
import path from 'node:path'

import { debugFn } from '@socketsecurity/registry/lib/debug'

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
    debugFn('Detected a Scala sbt build, running default Scala generator...')

    output.sbt = true
    output.count += 1
  }

  if (existsSync(path.join(cwd, 'gradlew'))) {
    debugFn('Detected a gradle build, running default gradle generator...')
    output.gradle = true
    output.count += 1
  }

  const envyml = path.join(cwd, 'environment.yml')
  const hasEnvyml = existsSync(envyml)
  const envyaml = path.join(cwd, 'environment.yaml')
  const hasEnvyaml = !hasEnvyml && existsSync(envyaml)
  if (hasEnvyml || hasEnvyaml) {
    debugFn(
      'Detected an environment.yml file, running default Conda generator...',
    )
    output.conda = true
    output.count += 1
  }

  return output
}
