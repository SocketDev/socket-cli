import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildArchiveFacts,
  findArchiveTargets,
  generateArchiveTargetFacts,
} from './generate-archive-facts.mts'

function records(...lines: string[][]): string {
  return lines.map(fields => `${fields.join('\t')}\n`).join('')
}

function nested(archivePath: string): string[] {
  return ['archive', archivePath]
}

function pom(
  archivePath: string,
  groupId: string,
  artifactId: string,
  version: string,
): string[] {
  return [
    'pom',
    archivePath,
    `META-INF/maven/${groupId}/${artifactId}/pom.properties`,
    groupId,
    artifactId,
    version,
  ]
}

function ids(facts: { components: Array<{ id: string }> }): string[] {
  return facts.components.map(c => c.id)
}

describe('buildArchiveFacts', () => {
  it('reports each bundled library by its own pom.properties, all direct', () => {
    const { facts, report } = buildArchiveFacts(
      'app-1.0.war',
      records(
        nested('WEB-INF/lib/lib-a-2.0.jar'),
        pom('WEB-INF/lib/lib-a-2.0.jar', 'org.a', 'lib-a', '2.0'),
        nested('WEB-INF/lib/lib-b-3.1-tests.jar'),
        pom('WEB-INF/lib/lib-b-3.1-tests.jar', 'org.b', 'lib-b', '3.1'),
        nested('WEB-INF/lib/gradle-built-4.0.jar'),
        pom('', 'com.example', 'app', '1.0'),
      ),
    )
    expect(facts).toEqual({
      projects: [
        {
          type: 'maven',
          namespace: 'com.example',
          name: 'app',
          version: '1.0',
          id: 'app-1.0.war',
          subprojectDir: '.',
          manifestFiles: [{ file: 'app-1.0.war' }],
          children: [0, 1],
        },
      ],
      components: [
        {
          type: 'maven',
          namespace: 'org.a',
          name: 'lib-a',
          version: '2.0',
          qualifiers: { ext: 'jar' },
          id: 'org.a:lib-a:jar:2.0',
          direct: true,
        },
        {
          type: 'maven',
          namespace: 'org.b',
          name: 'lib-b',
          version: '3.1',
          qualifiers: { classifier: 'tests', ext: 'jar' },
          id: 'org.b:lib-b:jar:tests:3.1',
          direct: true,
        },
      ],
      dependencies: [{ component: 0 }, { component: 1 }],
    })
    expect(report.unidentifiedArchives).toEqual([
      'app-1.0.war!/WEB-INF/lib/gradle-built-4.0.jar',
    ])
  })

  it('skips libraries shaded into a nested jar', () => {
    const lib = 'WEB-INF/lib/shaded-client-3.3.jar'
    const { facts, report } = buildArchiveFacts(
      'app-1.0.war',
      records(
        nested(lib),
        pom(lib, 'org.h', 'shaded-client', '3.3'),
        pom(lib, 'com.google.guava', 'guava', '32.0'),
      ),
    )
    expect(ids(facts)).toEqual(['org.h:shaded-client:jar:3.3'])
    expect(report.skippedBundled).toEqual([
      `app-1.0.war!/${lib}!/META-INF/maven/com.google.guava/guava/pom.properties`,
    ])
  })

  it('skips archives nested inside a dependency jar', () => {
    const tool = 'WEB-INF/lib/tool-1.0.jar'
    const { facts, report } = buildArchiveFacts(
      'app-1.0.war',
      records(
        nested(tool),
        pom(tool, 'org.t', 'tool', '1.0'),
        nested(`${tool}!/lib/guava-31.0.jar`),
        pom(`${tool}!/lib/guava-31.0.jar`, 'com.google.guava', 'guava', '31.0'),
      ),
    )
    expect(ids(facts)).toEqual(['org.t:tool:jar:1.0'])
    expect(report.skippedBundled).toEqual([
      `app-1.0.war!/${tool}!/lib/guava-31.0.jar`,
    ])
  })

  it('walks a war inside an ear', () => {
    const { facts } = buildArchiveFacts(
      'suite-1.0.ear',
      records(
        pom('', 'com.example', 'suite', '1.0'),
        nested('web-1.0.war'),
        pom('web-1.0.war', 'com.example', 'web', '1.0'),
        nested('web-1.0.war!/WEB-INF/lib/lib-a-2.0.jar'),
        pom('web-1.0.war!/WEB-INF/lib/lib-a-2.0.jar', 'org.a', 'lib-a', '2.0'),
        nested('lib/lib-b-3.0.jar'),
        pom('lib/lib-b-3.0.jar', 'org.b', 'lib-b', '3.0'),
      ),
    )
    expect(ids(facts)).toEqual([
      'com.example:web:war:1.0',
      'org.a:lib-a:jar:2.0',
      'org.b:lib-b:jar:3.0',
    ])
  })

  it('reports libraries shaded into the scanned archive itself', () => {
    const { facts } = buildArchiveFacts(
      'app-1.0.jar',
      records(
        pom('', 'com.example', 'app', '1.0'),
        pom('', 'com.google.guava', 'guava', '32.0'),
      ),
    )
    expect(facts.projects![0]).toMatchObject({ name: 'app', version: '1.0' })
    expect(facts.components).toEqual([
      {
        type: 'maven',
        namespace: 'com.google.guava',
        name: 'guava',
        version: '32.0',
        id: 'com.google.guava:guava:32.0',
        direct: true,
      },
    ])
  })

  it('reports a library both shaded in and shipped as a jar once', () => {
    const { facts } = buildArchiveFacts(
      'app-1.0.jar',
      records(
        pom('', 'com.example', 'app', '1.0'),
        pom('', 'org.a', 'lib-a', '2.0'),
        nested('BOOT-INF/lib/lib-a-2.0.jar'),
        pom('BOOT-INF/lib/lib-a-2.0.jar', 'org.a', 'lib-a', '2.0'),
      ),
    )
    expect(ids(facts)).toEqual(['org.a:lib-a:jar:2.0'])
  })

  it('names an archive without its own pom.properties by its file', () => {
    const { facts } = buildArchiveFacts(
      'ROOT.war',
      records(
        nested('WEB-INF/lib/lib-a-2.0.jar'),
        pom('WEB-INF/lib/lib-a-2.0.jar', 'org.a', 'lib-a', '2.0'),
      ),
    )
    expect(facts.projects![0]).toMatchObject({
      type: 'generic',
      name: 'ROOT.war',
    })
    expect(ids(facts)).toEqual(['org.a:lib-a:jar:2.0'])
  })

  it('keeps unreadable archives and pom.properties apart from unidentified ones', () => {
    const { report } = buildArchiveFacts(
      'app-1.0.war',
      records(
        [
          'malformed',
          '',
          'META-INF/maven/org.a/a/pom.properties',
          'Malformed \\\\uxxxx encoding.',
        ],
        ['pom', '', 'META-INF/maven/org.b/b/pom.properties', '', 'b', ''],
        nested('WEB-INF/lib/broken-1.0.jar'),
        [
          'unreadable',
          'WEB-INF/lib/broken-1.0.jar',
          'java.util.zip.ZipException: invalid',
        ],
      ),
    )
    expect(report).toEqual({
      malformedPomProperties: [
        'app-1.0.war!/META-INF/maven/org.a/a/pom.properties: Malformed \\uxxxx encoding.',
        'app-1.0.war!/META-INF/maven/org.b/b/pom.properties: missing groupId, artifactId or version',
      ],
      skippedBundled: [],
      unidentifiedArchives: [],
      unreadableArchives: [
        'app-1.0.war!/WEB-INF/lib/broken-1.0.jar: java.util.zip.ZipException: invalid',
      ],
    })
  })

  it.for([
    ['plain', 'lib-1.0.jar', '1.0', 'org.x:lib:jar:1.0'],
    ['classifier', 'lib-1.0-sources.jar', '1.0', 'org.x:lib:jar:sources:1.0'],
    [
      'base snapshot',
      'lib-1.0-SNAPSHOT.jar',
      '1.0-SNAPSHOT',
      'org.x:lib:jar:1.0-SNAPSHOT',
    ],
    [
      'timestamped snapshot',
      'lib-1.0-20240102.030405-7.jar',
      '1.0-SNAPSHOT',
      'org.x:lib:jar:1.0-SNAPSHOT',
    ],
    [
      'timestamped snapshot with classifier',
      'lib-1.0-20240102.030405-7-tests.jar',
      '1.0-SNAPSHOT',
      'org.x:lib:jar:tests:1.0-SNAPSHOT',
    ],
    ['renamed', 'renamed.jar', '1.0', undefined],
    ['other version', 'lib-1.1.jar', '1.0', undefined],
    ['version prefix only', 'lib-1.0x.jar', '1.0', undefined],
  ] as const)(
    'identifies a nested jar by its file name: %s',
    ([, fileName, version, expectedId]) => {
      const lib = `WEB-INF/lib/${fileName}`
      const { facts } = buildArchiveFacts(
        'ROOT.war',
        records(nested(lib), pom(lib, 'org.x', 'lib', version)),
      )
      expect(ids(facts)).toEqual(expectedId ? [expectedId] : [])
    },
  )
})

describe('findArchiveTargets', () => {
  it('keeps existing archive files and nothing else', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'socket-archive-targets-'))
    try {
      await fs.writeFile(path.join(dir, 'app.war'), '')
      await fs.writeFile(path.join(dir, 'APP.WAR'), '')
      await fs.writeFile(path.join(dir, 'pom.xml'), '')
      await fs.mkdir(path.join(dir, 'dir.jar'))
      expect(
        findArchiveTargets(
          [
            'app.war',
            './app.war',
            'APP.WAR',
            'pom.xml',
            'dir.jar',
            'missing.jar',
            '.',
          ],
          dir,
        ),
      ).toEqual([path.join(dir, 'app.war')])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('generateArchiveTargetFacts', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'socket-archive-cwd-'))
    await fs.mkdir(path.join(dir, 'build'))
    await fs.writeFile(path.join(dir, 'build/app-1.0.jar'), '')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('skips an archive matched by --exclude-paths', async () => {
    await expect(
      generateArchiveTargetFacts(['build/app-1.0.jar'], {
        cwd: dir,
        excludeGlobs: ['build', 'build/**'],
      }),
    ).resolves.toEqual([])
  })
})
