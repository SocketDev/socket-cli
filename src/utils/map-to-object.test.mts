import { describe, expect, it } from 'vitest'

import { mapToObject } from './map-to-object.mts'

describe('map-to-object', () => {
  it('should convert a map string string', () => {
    expect(
      mapToObject(
        new Map([
          ['a', 'b'],
          ['c', 'd']
        ])
      )
    ).toMatchInlineSnapshot(`
      {
        "a": "b",
        "c": "d",
      }
    `)
  })

  it('should convert a map string map string string', () => {
    expect(
      mapToObject(
        new Map([
          [
            'x',
            new Map([
              ['a', 'b'],
              ['c', 'd']
            ])
          ]
        ])
      )
    ).toMatchInlineSnapshot(`
      {
        "x": {
          "a": "b",
          "c": "d",
        },
      }
    `)
  })

  it('should convert a map string map string map string string', () => {
    expect(
      mapToObject(
        new Map([
          [
            'a123',
            new Map([
              [
                'x',
                new Map([
                  ['a', 'b'],
                  ['c', 'd']
                ])
              ],
              [
                'y',
                new Map([
                  ['a', 'b'],
                  ['c', 'd']
                ])
              ]
            ])
          ],
          [
            'b456',
            new Map([
              [
                'x',
                new Map([
                  ['a', 'b'],
                  ['c', 'd']
                ])
              ],
              [
                'y',
                new Map([
                  ['a', 'b'],
                  ['c', 'd']
                ])
              ]
            ])
          ]
        ])
      )
    ).toMatchInlineSnapshot(`
      {
        "a123": {
          "x": {
            "a": "b",
            "c": "d",
          },
          "y": {
            "a": "b",
            "c": "d",
          },
        },
        "b456": {
          "x": {
            "a": "b",
            "c": "d",
          },
          "y": {
            "a": "b",
            "c": "d",
          },
        },
      }
    `)
  })
})
