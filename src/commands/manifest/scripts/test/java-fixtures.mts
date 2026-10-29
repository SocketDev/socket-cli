import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function fakeJdk(
  home: string,
  javaVersion: string,
): Promise<string> {
  await fs.mkdir(path.join(home, 'bin'), { recursive: true })
  await fs.writeFile(path.join(home, 'bin', 'java'), '', { mode: 0o755 })
  await fs.writeFile(
    path.join(home, 'release'),
    `IMPLEMENTOR="Eclipse Adoptium"\nJAVA_VERSION="${javaVersion}"\n`,
  )
  return await fs.realpath(home)
}

export async function gradleWrapperProject(
  dir: string,
  gradleVersion: string,
): Promise<string> {
  await fs.mkdir(path.join(dir, 'gradle', 'wrapper'), { recursive: true })
  await fs.writeFile(path.join(dir, 'gradlew'), '', { mode: 0o755 })
  await fs.writeFile(
    path.join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
    `distributionBase=GRADLE_USER_HOME\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip\n`,
  )
  return dir
}
