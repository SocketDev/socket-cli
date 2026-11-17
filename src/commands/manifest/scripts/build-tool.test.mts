import { describe, expect, it } from 'vitest'

import { socketFactsFileName } from './build-tool.mts'

describe('socketFactsFileName', () => {
  it('names a directory-addressed build after its tool', () => {
    expect(socketFactsFileName('gradle', undefined)).toBe(
      'gradle.socket.facts.json',
    )
    expect(socketFactsFileName('sbt', undefined)).toBe('sbt.socket.facts.json')
  })

  it('names a file-addressed build after its entry file', () => {
    expect(socketFactsFileName('maven', 'pom.xml')).toBe(
      'pom.xml.socket.facts.json',
    )
    expect(socketFactsFileName('maven', 'other-pom.xml')).toBe(
      'other-pom.xml.socket.facts.json',
    )
    expect(socketFactsFileName('dotnet', 'App.sln')).toBe(
      'App.sln.socket.facts.json',
    )
  })

  it('names a file-addressed build by the base name of an entry file path', () => {
    expect(socketFactsFileName('maven', 'sub/pom.xml')).toBe(
      'pom.xml.socket.facts.json',
    )
  })

  it('cannot name a file-addressed build without an entry file', () => {
    expect(socketFactsFileName('maven', undefined)).toBeUndefined()
    expect(socketFactsFileName('dotnet', undefined)).toBeUndefined()
  })
})
