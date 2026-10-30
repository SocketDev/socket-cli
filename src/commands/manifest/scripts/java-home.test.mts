import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  currentJavaInstallation,
  discoverJavaInstallations,
  javaRange,
  parseJavaFeatureVersion,
  projectBuildToolVersion,
  selectBuildJavaHome,
} from './java-home.mts'
import { fakeJdk, gradleWrapperProject } from './test/java-fixtures.mts'

let root: string

beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'socket-java-home-')),
  )
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function gradleProject(gradleVersion: string): Promise<string> {
  return gradleWrapperProject(
    path.join(root, `gradle-${gradleVersion}`),
    gradleVersion,
  )
}

describe('parseJavaFeatureVersion', () => {
  it.each([
    ['JAVA_VERSION="1.8.0_504"', 8],
    ['JAVA_VERSION="11.0.32.1"', 11],
    ['JAVA_VERSION="25.0.4.1"', 25],
    ['JAVA_VERSION="26"', 26],
    ['IMPLEMENTOR="x"\nJAVA_VERSION="21.0.12"\n', 21],
  ])('reads %s as Java %i', (release, feature) => {
    expect(parseJavaFeatureVersion(release)).toBe(feature)
  })

  it('reads nothing from a release file without JAVA_VERSION', () => {
    expect(parseJavaFeatureVersion('IMPLEMENTOR="x"')).toBeUndefined()
  })
})

describe('Gradle javaRange', () => {
  it.each([
    ['6.9.4', 8, 15],
    ['7.6.4', 8, 19],
    ['8.4', 8, 20],
    ['8.5', 8, 21],
    ['8.14.3', 8, 24],
    ['9.0.0', 17, 24],
    ['9.1.0', 17, 25],
  ])('runs Gradle %s on Java %i to %i', (version, min, max) => {
    expect(javaRange('gradle', version)).toEqual({ min, max })
  })

  it('runs a Gradle newer than it knows of on any Java from 17', () => {
    expect(javaRange('gradle', '9.4.0')).toEqual({
      min: 17,
      max: Number.POSITIVE_INFINITY,
    })
  })
})

describe('sbt javaRange', () => {
  it.each([
    ['0.13.18', 8, 11],
    ['1.2.8', 8, 11],
    ['1.5.8', 8, 17],
    ['1.8.3', 8, 17],
    ['1.9.0', 8, 25],
  ])('runs sbt %s on Java %i to %i', (version, min, max) => {
    expect(javaRange('sbt', version)).toEqual({ min, max })
  })

  it('runs sbt 2 on any Java from 17', () => {
    expect(javaRange('sbt', '2.0.0')).toEqual({
      min: 17,
      max: Number.POSITIVE_INFINITY,
    })
  })
})

describe('projectBuildToolVersion', () => {
  it('reads the Gradle wrapper distribution version', async () => {
    const dir = await gradleProject('8.10-rc-1')
    expect(await projectBuildToolVersion('gradle', dir)).toBe('8.10')
  })

  it('knows no version for a Gradle run without the wrapper', async () => {
    const dir = await gradleProject('8.14.3')
    expect(
      await projectBuildToolVersion('gradle', dir, '/opt/gradle/bin/gradle'),
    ).toBeUndefined()
  })

  it('reads the version next to a wrapper given as the bin', async () => {
    const dir = await gradleProject('8.14.3')
    const subproject = path.join(dir, 'app')
    await fs.mkdir(subproject)
    expect(
      await projectBuildToolVersion('gradle', subproject, '../gradlew'),
    ).toBe('8.14.3')
    expect(
      await projectBuildToolVersion('gradle', root, path.join(dir, 'gradlew')),
    ).toBe('8.14.3')
  })

  it("reads sbt's pinned version", async () => {
    const dir = path.join(root, 'sbt')
    await fs.mkdir(path.join(dir, 'project'), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'project', 'build.properties'),
      '# pinned\nsbt.version = 1.5.8\n',
    )
    expect(await projectBuildToolVersion('sbt', dir)).toBe('1.5.8')
  })
})

describe('discoverJavaInstallations', () => {
  it('finds JDKs in search dirs, macOS bundles and runner variables', async () => {
    const jvm = path.join(root, 'jvm')
    const jdk17 = await fakeJdk(path.join(jvm, 'temurin-17'), '17.0.20')
    const jdk21 = await fakeJdk(
      path.join(jvm, 'temurin-21.jdk', 'Contents', 'Home'),
      '21.0.12',
    )
    const jdk8 = await fakeJdk(path.join(root, 'hosted', '8'), '1.8.0_504')
    await fs.mkdir(path.join(jvm, 'not-a-jdk'))
    await fs.symlink(jdk17, path.join(jvm, 'default'))

    const found = await discoverJavaInstallations({ JAVA_HOME_8_X64: jdk8 }, [
      jvm,
      path.join(root, 'missing'),
    ])

    expect(found).toEqual([
      { home: jdk8, feature: 8 },
      { home: jdk17, feature: 17 },
      { home: jdk21, feature: 21 },
    ])
  })
})

describe('currentJavaInstallation', () => {
  it('takes JAVA_HOME over the java on PATH', async () => {
    const jdk21 = await fakeJdk(path.join(root, 'jdk21'), '21.0.12')
    const jdk25 = await fakeJdk(path.join(root, 'jdk25'), '25.0.4')
    expect(
      await currentJavaInstallation({
        JAVA_HOME: jdk21,
        PATH: path.join(jdk25, 'bin'),
      }),
    ).toEqual({ home: jdk21, feature: 21 })
  })

  it('resolves the java on PATH through symlinks', async () => {
    const jdk25 = await fakeJdk(path.join(root, 'jdk25'), '25.0.4')
    const binDir = path.join(root, 'usr-bin')
    await fs.mkdir(binDir)
    await fs.symlink(path.join(jdk25, 'bin', 'java'), path.join(binDir, 'java'))
    expect(await currentJavaInstallation({ PATH: binDir })).toEqual({
      home: jdk25,
      feature: 25,
    })
  })
})

async function installed(): Promise<Record<number, string>> {
  const jvm = path.join(root, 'jvm')
  return {
    17: await fakeJdk(path.join(jvm, 'temurin-17'), '17.0.20'),
    21: await fakeJdk(path.join(jvm, 'temurin-21'), '21.0.12'),
    25: await fakeJdk(path.join(jvm, 'temurin-25'), '25.0.4'),
  }
}

describe('selectBuildJavaHome', () => {
  it('moves Gradle 8 off Java 25 onto the newest JDK it runs on', async () => {
    const jdks = await installed()
    const dir = await gradleProject('8.14.3')
    const selected = await selectBuildJavaHome('gradle', dir, {
      env: { JAVA_HOME: jdks[25] },
      searchDirs: [path.join(root, 'jvm')],
    })
    expect(selected).toEqual({
      current: { home: jdks[25], feature: 25 },
      picked: { home: jdks[21], feature: 21 },
      toolVersion: '8.14.3',
    })
  })

  it('moves Gradle 9 off Java 8', async () => {
    const jdks = await installed()
    const jdk8 = await fakeJdk(path.join(root, 'jdk8'), '1.8.0_504')
    const dir = await gradleProject('9.1.0')
    const selected = await selectBuildJavaHome('gradle', dir, {
      env: { JAVA_HOME: jdk8 },
      searchDirs: [path.join(root, 'jvm')],
    })
    expect(selected?.picked).toEqual({ home: jdks[25], feature: 25 })
  })

  it('keeps a JDK the build tool runs on', async () => {
    const jdks = await installed()
    const dir = await gradleProject('8.14.3')
    expect(
      await selectBuildJavaHome('gradle', dir, {
        env: { JAVA_HOME: jdks[17] },
        searchDirs: [path.join(root, 'jvm')],
      }),
    ).toBeUndefined()
  })

  it('keeps the current JDK when no installed one fits', async () => {
    const jdk25 = await fakeJdk(path.join(root, 'jdk25'), '25.0.4')
    const dir = await gradleProject('8.14.3')
    expect(
      await selectBuildJavaHome('gradle', dir, {
        env: { JAVA_HOME: jdk25 },
        searchDirs: [],
      }),
    ).toBeUndefined()
  })

  it('leaves Maven on the current JDK', async () => {
    const jdks = await installed()
    expect(
      await selectBuildJavaHome('maven', root, {
        env: { JAVA_HOME: jdks[25] },
        searchDirs: [path.join(root, 'jvm')],
      }),
    ).toBeUndefined()
  })
})
