import { describe, expect, it } from 'vitest'

import { walkNestedMap } from './walk-nested-map.mts'

describe('walkNestedMap', () => {
  it('should walk a flat map', () => {
    expect(
      Array.from(
        walkNestedMap(
          new Map([
            ['x', 1],
            ['y', 2],
            ['z', 3]
          ])
        )
      )
    ).toMatchInlineSnapshot(`
      [
        {
          "keys": [
            "x",
          ],
          "value": 1,
        },
        {
          "keys": [
            "y",
          ],
          "value": 2,
        },
        {
          "keys": [
            "z",
          ],
          "value": 3,
        },
      ]
    `)
  })

  it('should walk a 2d map', () => {
    expect(
      Array.from(
        walkNestedMap(
          new Map([
            [
              'x',
              new Map([
                ['x2', 1],
                ['y2', 2],
                ['z2', 3]
              ])
            ],
            [
              'y',
              new Map([
                ['x3', 1],
                ['y3', 2],
                ['z3', 3]
              ])
            ]
          ])
        )
      )
    ).toMatchInlineSnapshot(`
      [
        {
          "keys": [
            "x",
            "x2",
          ],
          "value": 1,
        },
        {
          "keys": [
            "x",
            "y2",
          ],
          "value": 2,
        },
        {
          "keys": [
            "x",
            "z2",
          ],
          "value": 3,
        },
        {
          "keys": [
            "y",
            "x3",
          ],
          "value": 1,
        },
        {
          "keys": [
            "y",
            "y3",
          ],
          "value": 2,
        },
        {
          "keys": [
            "y",
            "z3",
          ],
          "value": 3,
        },
      ]
    `)
  })

  it('should walk a 3d map', () => {
    expect(
      Array.from(
        walkNestedMap(
          new Map([
            [
              'a',
              new Map([
                [
                  'x',
                  new Map([
                    ['x2', 1],
                    ['y2', 2],
                    ['z2', 3]
                  ])
                ],
                [
                  'y',
                  new Map([
                    ['x3', 1],
                    ['y3', 2],
                    ['z3', 3]
                  ])
                ]
              ])
            ],
            [
              'b',
              new Map([
                [
                  'x',
                  new Map([
                    ['x2', 1],
                    ['y2', 2],
                    ['z2', 3]
                  ])
                ],
                [
                  'y',
                  new Map([
                    ['x3', 1],
                    ['y3', 2],
                    ['z3', 3]
                  ])
                ]
              ])
            ]
          ])
        )
      )
        // Makes test easier to read...
        .map(obj => JSON.stringify(obj))
    ).toMatchInlineSnapshot(`
      [
        "{"keys":["a","x","x2"],"value":1}",
        "{"keys":["a","x","y2"],"value":2}",
        "{"keys":["a","x","z2"],"value":3}",
        "{"keys":["a","y","x3"],"value":1}",
        "{"keys":["a","y","y3"],"value":2}",
        "{"keys":["a","y","z3"],"value":3}",
        "{"keys":["b","x","x2"],"value":1}",
        "{"keys":["b","x","y2"],"value":2}",
        "{"keys":["b","x","z2"],"value":3}",
        "{"keys":["b","y","x3"],"value":1}",
        "{"keys":["b","y","y3"],"value":2}",
        "{"keys":["b","y","z3"],"value":3}",
      ]
    `)
  })
})
