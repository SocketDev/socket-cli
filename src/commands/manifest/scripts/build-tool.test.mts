import { describe, expect, it } from 'vitest'

import { socketFactsFileName } from './build-tool.mts'
import { parseRecords } from './records.mts'

describe('socketFactsFileName', () => {
  it('names a directory-addressed build after its tool', () => {
    expect(socketFactsFileName('gradle', undefined)).toBe(
      'gradle.socket.facts.json',
    )
    expect(socketFactsFileName('sbt', undefined)).toBe('sbt.socket.facts.json')
  })

  it('names a file-addressed build after the entry file it reported', () => {
    expect(
      socketFactsFileName('maven', parseRecords('entry\tpom.xml').entry),
    ).toBe('pom.xml.socket.facts.json')
    expect(
      socketFactsFileName('maven', parseRecords('entry\tother-pom.xml').entry),
    ).toBe('other-pom.xml.socket.facts.json')
  })

  it('cannot name a file-addressed build that reported no entry file', () => {
    expect(
      socketFactsFileName(
        'maven',
        parseRecords('meta\tmaven\t3.9.6\t17').entry || undefined,
      ),
    ).toBeUndefined()
  })
})
