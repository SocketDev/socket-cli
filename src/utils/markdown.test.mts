import { describe, expect, it } from 'vitest'

import { mdTableOfPairs } from './markdown.mts'

describe('markdown', () => {
  describe('mdTableOfPairs', () => {
    it('should convert an array of tuples to markdown', () => {
      expect(
        mdTableOfPairs(
          [
            ['apple', 'green'],
            ['banana', 'yellow'],
            ['orange', 'orange']
          ],
          ['name', 'color']
        )
      ).toMatchInlineSnapshot(`
        "| ------ | ------ |
        | name   | color  |
        | ------ | ------ |
        | apple  | green  |
        | banana | yellow |
        | orange | orange |
        | ------ | ------ |"
      `)
    })
  })
})
