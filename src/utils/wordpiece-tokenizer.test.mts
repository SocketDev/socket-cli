/**
 * Tests for WordPiece Tokenizer
 *
 * These tests demonstrate how the tokenizer works and validate its behavior
 * against expected BERT/MiniLM tokenization patterns.
 */

import { describe, expect, it } from 'vitest'

import { WordPieceTokenizer } from './wordpiece-tokenizer.mts'

import type { Vocabulary } from './wordpiece-tokenizer.mts'

/**
 * Create a minimal test vocabulary.
 * Real BERT vocab has 30k+ tokens - we use a subset for testing.
 */
function createTestVocab(): Vocabulary {
  return {
    // Special tokens.
    '[PAD]': 0,
    '[UNK]': 100,
    '[CLS]': 101,
    '[SEP]': 102,
    '[MASK]': 103,

    // Common words.
    'fix': 8081,
    'scan': 15772,
    'vulnerability': 23829,
    'package': 7427,
    'security': 3036,
    'dependency': 16621,

    // Subwords.
    '##ing': 2075,
    '##ies': 2497,
    '##s': 2015,
    '##ed': 2098,

    // Punctuation.
    '.': 1012,
    ',': 1010,
    '!': 999,
    '?': 1029,
    "'": 1005,
  }
}

describe('WordPieceTokenizer', () => {
  describe('Basic Tokenization', () => {
    it('should tokenize simple text', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      const result = tokenizer.tokenize('fix vulnerability')

      expect(result.tokens).toEqual(['[CLS]', 'fix', 'vulnerability', '[SEP]'])
      expect(result.inputIds).toEqual([101, 8081, 23829, 102])
      expect(result.attentionMask).toEqual([1, 1, 1, 1])
    })

    it('should handle lowercase normalization', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab, doLowerCase: true })

      const result = tokenizer.tokenize('FIX VULNERABILITY')

      expect(result.tokens).toEqual(['[CLS]', 'fix', 'vulnerability', '[SEP]'])
    })

    it('should handle punctuation splitting', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      const result = tokenizer.tokenize('fix vulnerabilities!')

      expect(result.tokens).toContain('!')
      expect(result.tokens).toContain('vulnerability')
    })
  })

  describe('WordPiece Tokenization', () => {
    it('should apply subword tokenization', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      const result = tokenizer.tokenize('fixing')

      // "fixing" = "fix" + "##ing"
      expect(result.tokens).toEqual(['[CLS]', 'fix', '##ing', '[SEP]'])
      expect(result.inputIds).toEqual([101, 8081, 2075, 102])
    })

    it('should handle multiple subwords', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      const result = tokenizer.tokenize('vulnerabilities')

      // "vulnerabilities" = "vulnerability" + "##ies"
      expect(result.tokens).toEqual([
        '[CLS]',
        'vulnerability',
        '##ies',
        '[SEP]',
      ])
    })

    it('should use UNK token for unknown words', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      const result = tokenizer.tokenize('xyzabc')

      expect(result.tokens).toContain('[UNK]')
    })

    it('should handle greedy longest-match', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      const result = tokenizer.tokenize('packages')

      // "packages" = "package" + "##s"
      expect(result.tokens).toEqual(['[CLS]', 'package', '##s', '[SEP]'])
    })
  })

  describe('Special Tokens', () => {
    it('should add CLS and SEP tokens', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      const result = tokenizer.tokenize('fix')

      expect(result.tokens[0]).toBe('[CLS]')
      expect(result.tokens[result.tokens.length - 1]).toBe('[SEP]')
    })

    it('should respect max length', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab, maxLength: 5 })

      const result = tokenizer.tokenize('fix scan vulnerability package security')

      expect(result.tokens.length).toBeLessThanOrEqual(5)
      expect(result.tokens[0]).toBe('[CLS]')
    })
  })

  describe('Attention Mask', () => {
    it('should create attention mask with all 1s', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      const result = tokenizer.tokenize('fix vulnerability')

      expect(result.attentionMask).toEqual([1, 1, 1, 1])
      expect(result.attentionMask.length).toBe(result.inputIds.length)
    })
  })

  describe('Decoding', () => {
    it('should decode tokens back to text', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      // Encode.
      const encoded = tokenizer.tokenize('fixing vulnerabilities')

      // Decode.
      const decoded = tokenizer.decode(encoded.inputIds)

      expect(decoded).toBe('fixing vulnerabilities')
    })

    it('should join subwords correctly', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      // Manual token IDs: [CLS] fix ##ing [SEP]
      const ids = [101, 8081, 2075, 102]

      const decoded = tokenizer.decode(ids)

      expect(decoded).toBe('fixing')
    })

    it('should remove special tokens when decoding', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      // [CLS] fix [SEP]
      const ids = [101, 8081, 102]

      const decoded = tokenizer.decode(ids)

      expect(decoded).not.toContain('[CLS]')
      expect(decoded).not.toContain('[SEP]')
      expect(decoded).toBe('fix')
    })
  })

  describe('Real-world Examples', () => {
    it('should tokenize socket ask queries', () => {
      const vocab = createTestVocab()
      const tokenizer = new WordPieceTokenizer({ vocab })

      const queries = [
        'fix vulnerabilities',
        'scan packages',
        'check security',
      ]

      for (const query of queries) {
        const result = tokenizer.tokenize(query)

        expect(result.inputIds).toBeDefined()
        expect(result.tokens).toBeDefined()
        expect(result.attentionMask).toBeDefined()
        expect(result.tokens[0]).toBe('[CLS]')
        expect(result.tokens[result.tokens.length - 1]).toBe('[SEP]')
      }
    })
  })
})
