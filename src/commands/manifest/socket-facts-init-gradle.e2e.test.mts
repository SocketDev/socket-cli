// Integration tests for the socket-facts.init.gradle init script.
// Skipped when no `gradle` binary is on PATH; otherwise resolves real
// Maven dependencies against Maven Central, so they require network on
// first run and are slower than the rest of the unit suite (~2-10s each).
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { testPath } from '../../../test/utils.mts'

type FactsArtifact = {
  type: string
  namespace: string
  name: string
  version?: string
  qualifiers?: { classifier?: string; ext?: string }
  id: string
  direct?: boolean
  dev?: boolean
  tooling?: boolean
  dependencies?: string[]
}

type SocketFacts = {
  components: FactsArtifact[]
}

const initScriptPath = path.join(
  testPath,
  '..',
  'src',
  'commands',
  'manifest',
  'socket-facts.init.gradle',
)
const fixturesRoot = path.join(
  testPath,
  'fixtures/commands/manifest/gradle-facts',
)

async function gradleAvailable(): Promise<boolean> {
  try {
    const out = await spawn('gradle', ['--version'])
    return out.code === 0
  } catch {
    return false
  }
}

async function runFacts(cwd: string): Promise<void> {
  const out = await spawn(
    'gradle',
    ['--init-script', initScriptPath, '--quiet', 'socketFacts'],
    { cwd },
  )
  if (out.code !== 0) {
    throw new Error(
      `gradle socketFacts exited with ${out.code} in ${cwd}\nstderr:\n${out.stderr}\nstdout:\n${out.stdout}`,
    )
  }
}

function readFacts(file: string): SocketFacts {
  return JSON.parse(readFileSync(file, 'utf8')) as SocketFacts
}

function clean(...files: string[]): void {
  for (const f of files) {
    if (existsSync(f)) {
      rmSync(f, { force: true })
    }
  }
}

function findById(
  facts: SocketFacts,
  predicate: (a: FactsArtifact) => boolean,
): FactsArtifact[] {
  return facts.components.filter(predicate)
}

const hasGradle = await gradleAvailable()
const describeOrSkip = hasGradle ? describe : describe.skip

describeOrSkip('socket-facts.init.gradle', () => {
  describe('single-module-java fixture', () => {
    const fixture = path.join(fixturesRoot, 'single-module-java')
    const output = path.join(fixture, '.socket.facts.json')

    it('produces a facts file with the expected shape', async () => {
      clean(output)
      await runFacts(fixture)
      expect(existsSync(output)).toBe(true)
      const facts = readFacts(output)
      expect(facts.components.length).toBeGreaterThan(0)
      for (const c of facts.components) {
        expect(c.type).toBe('maven')
        expect(typeof c.namespace).toBe('string')
        expect(typeof c.name).toBe('string')
        expect(typeof c.id).toBe('string')
        if (c.qualifiers !== undefined) {
          // MavenQualifiersSchema is .strict() — only classifier and ext.
          const keys = Object.keys(c.qualifiers).sort()
          expect(
            keys.every(k => k === 'classifier' || k === 'ext'),
            `unexpected qualifier keys: ${keys.join(',')}`,
          ).toBe(true)
        }
      }
    })

    it('marks first-level dependencies as direct', async () => {
      const facts = readFacts(output)
      const guava = findById(
        facts,
        c => c.namespace === 'com.google.guava' && c.name === 'guava',
      )
      expect(guava.length, 'guava artifact present').toBeGreaterThan(0)
      expect(guava.some(c => c.direct === true)).toBe(true)
    })

    it('does not mark production deps as dev', async () => {
      const facts = readFacts(output)
      // slf4j-api is `implementation` (production). It must not be dev:true.
      const slf4j = findById(
        facts,
        c => c.namespace === 'org.slf4j' && c.name === 'slf4j-api',
      )
      expect(slf4j.length).toBeGreaterThan(0)
      for (const c of slf4j) {
        expect(
          c.dev,
          `slf4j-api should not be dev: ${JSON.stringify(c)}`,
        ).not.toBe(true)
      }
      // junit is testImplementation — must be dev:true.
      const junit = findById(
        facts,
        c => c.namespace === 'junit' && c.name === 'junit',
      )
      expect(junit.length).toBeGreaterThan(0)
      expect(junit.some(c => c.dev === true)).toBe(true)
    })

    it('flags annotation-processor deps as tooling, prod deps not as tooling', async () => {
      const facts = readFacts(output)
      // Lombok is declared on `annotationProcessor` only — must carry
      // tooling: true.
      const lombok = findById(
        facts,
        c => c.namespace === 'org.projectlombok' && c.name === 'lombok',
      )
      expect(lombok.length, 'lombok artifact present').toBeGreaterThan(0)
      expect(lombok.some(c => c.tooling === true)).toBe(true)
      // Guava is `api` (production) — must NOT carry tooling.
      const guava = findById(
        facts,
        c => c.namespace === 'com.google.guava' && c.name === 'guava',
      )
      expect(guava.length).toBeGreaterThan(0)
      for (const c of guava) {
        expect(
          c.tooling,
          `guava should not be tooling: ${JSON.stringify(c)}`,
        ).not.toBe(true)
      }
      // Junit is `testImplementation` — must be dev:true but not tooling.
      const junit = findById(
        facts,
        c => c.namespace === 'junit' && c.name === 'junit',
      )
      expect(junit.length).toBeGreaterThan(0)
      for (const c of junit) {
        expect(c.tooling).not.toBe(true)
      }
    })

    it('records dependency edges by artifact id', async () => {
      const facts = readFacts(output)
      const byId = new Map(facts.components.map(c => [c.id, c]))
      for (const c of facts.components) {
        for (const childId of c.dependencies ?? []) {
          expect(
            byId.has(childId),
            `dangling dependency id from ${c.id}: ${childId}`,
          ).toBe(true)
        }
      }
    })
  })

  describe('unresolved-deps fixture', () => {
    const fixture = path.join(fixturesRoot, 'unresolved-deps')
    const output = path.join(fixture, '.socket.facts.json')

    it('records unresolvable dependencies without failing the build', async () => {
      clean(output)
      await runFacts(fixture)
      expect(existsSync(output)).toBe(true)
      const facts = readFacts(output)
      const fake = findById(
        facts,
        c =>
          c.namespace === 'com.example.does-not-exist' &&
          c.name === 'fake-artifact',
      )
      expect(fake.length, 'unresolved dep should appear exactly once').toBe(1)
      // Never-resolved coordinates carry no artifact, so we expect no `ext`.
      expect(fake[0].qualifiers?.ext).toBeUndefined()
      // It's a top-level dep, so it should be marked direct.
      expect(fake[0].direct).toBe(true)
    })
  })

  describe('kotlin-multiplatform fixture', () => {
    const fixture = path.join(fixturesRoot, 'kotlin-multiplatform')
    const output = path.join(fixture, '.socket.facts.json')

    it('captures per-target classpaths from kotlin.targets', async () => {
      clean(output)
      await runFacts(fixture)
      expect(existsSync(output)).toBe(true)
      const facts = readFacts(output)
      // commonMain dep — should resolve into both jvm and js target variants.
      const serializationCore = findById(
        facts,
        c =>
          c.namespace === 'org.jetbrains.kotlinx' &&
          c.name.startsWith('kotlinx-serialization-core'),
      )
      expect(
        serializationCore.length,
        `expected kotlinx-serialization-core in at least one target variant: ${facts.components.map(c => c.id).join(', ')}`,
      ).toBeGreaterThan(0)
      // jvmMain-only dep — should be present, exercising the per-target
      // classpath name pattern (`jvmMainRuntimeClasspath` and friends).
      const slf4j = findById(
        facts,
        c => c.namespace === 'org.slf4j' && c.name === 'slf4j-api',
      )
      expect(slf4j.length, 'jvmMain slf4j-api present').toBeGreaterThan(0)
    })
  })

  describe('android-library fixture', () => {
    const fixture = path.join(fixturesRoot, 'android-library')
    const output = path.join(fixture, '.socket.facts.json')

    const androidSdk =
      process.env['ANDROID_HOME'] || process.env['ANDROID_SDK_ROOT']
    const androidDescribeOrSkip = androidSdk ? describe : describe.skip

    androidDescribeOrSkip('with ANDROID_HOME set', () => {
      it('resolves Android variant classpaths (debug + release)', async () => {
        clean(output)
        await runFacts(fixture)
        expect(existsSync(output)).toBe(true)
        const facts = readFacts(output)
        // The androidx.annotation dep is declared as `implementation` and
        // should appear via debug/release runtime classpaths. Its
        // qualifiers.ext should be 'jar' or 'aar' (annotation 1.7.1 ships
        // both — Android uses the aar via variant resolution).
        const annotation = findById(
          facts,
          c => c.namespace === 'androidx.annotation' && c.name === 'annotation',
        )
        expect(
          annotation.length,
          `androidx.annotation:annotation present (got ${facts.components.length} components total)`,
        ).toBeGreaterThan(0)
        expect(annotation.some(c => c.direct === true)).toBe(true)
      })
    })
  })

  describe('multi-module-java fixture', () => {
    const fixture = path.join(fixturesRoot, 'multi-module-java')
    const rootOut = path.join(fixture, '.socket.facts.json')
    const appOut = path.join(fixture, 'app/.socket.facts.json')
    const libOut = path.join(fixture, 'lib/.socket.facts.json')

    it('emits one facts file per project', async () => {
      clean(rootOut, appOut, libOut)
      await runFacts(fixture)
      expect(existsSync(rootOut)).toBe(true)
      expect(existsSync(appOut)).toBe(true)
      expect(existsSync(libOut)).toBe(true)
    })

    it('represents project dependencies as a single artifact', async () => {
      const appFacts = readFacts(appOut)
      // `implementation project(':lib')` should appear once, not split across
      // Gradle variants (java-classes-directory vs jar).
      const libEntries = findById(
        appFacts,
        c => c.namespace === 'com.example.socket' && c.name === 'lib',
      )
      expect(
        libEntries.length,
        `expected one entry for project(:lib), got ${libEntries.length}: ${JSON.stringify(libEntries.map(e => e.id))}`,
      ).toBe(1)
    })

    it('does not mark prod deps as dev in multi-module builds', async () => {
      const appFacts = readFacts(appOut)
      const slf4j = findById(
        appFacts,
        c => c.namespace === 'org.slf4j' && c.name === 'slf4j-api',
      )
      expect(slf4j.length).toBeGreaterThan(0)
      for (const c of slf4j) {
        expect(c.dev).not.toBe(true)
      }
    })
  })
})
