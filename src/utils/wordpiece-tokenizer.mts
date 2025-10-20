/**
 * WordPiece Tokenizer for BERT-like Models
 *
 * WHAT THIS IS:
 * A pure JavaScript implementation of WordPiece tokenization used by BERT,
 * MiniLM, and other transformer models. This converts text into token IDs
 * that can be fed to ONNX Runtime for semantic understanding.
 *
 * WHY WE NEED IT:
 * ML models don't understand raw text - they need numeric token IDs.
 * WordPiece breaks words into subword units from a fixed vocabulary.
 *
 * EXAMPLE:
 *   Input:  "fixing vulnerabilities"
 *   Tokens: ["[CLS]", "fix", "##ing", "vulnerability", "##ies", "[SEP]"]
 *   IDs:    [101, 8081, 2075, 23829, 2497, 102]
 *
 * HOW IT WORKS:
 * 1. Normalize text (lowercase, strip accents)
 * 2. Split on whitespace and punctuation
 * 3. Apply greedy longest-match from vocabulary
 * 4. Add special tokens: [CLS] at start, [SEP] at end
 * 5. Convert tokens to IDs using vocab lookup
 *
 * VOCABULARY:
 * The vocab is a JSON file mapping tokens to IDs:
 * {
 *   "[CLS]": 101,
 *   "[SEP]": 102,
 *   "[UNK]": 100,
 *   "fix": 8081,
 *   "##ing": 2075,
 *   ...
 * }
 *
 * PERFORMANCE:
 * - Pure JavaScript, no dependencies
 * - ~500KB vocab file (loaded once, cached)
 * - ~1-2ms per query tokenization
 * - Zero ML overhead
 *
 * REFERENCES:
 * - Original WordPiece paper: https://arxiv.org/abs/1609.08144
 * - BERT tokenization: https://arxiv.org/abs/1810.04805
 */

/**
 * WordPiece tokenization result.
 */
export interface TokenizationResult {
  /** Token IDs for the model input. */
  inputIds: number[]

  /** Attention mask (1 for real tokens, 0 for padding). */
  attentionMask: number[]

  /** String tokens (for debugging). */
  tokens: string[]
}

/**
 * WordPiece vocabulary mapping tokens to IDs.
 */
export interface Vocabulary {
  /** Token string → token ID. */
  [token: string]: number
}

/**
 * WordPiece Tokenizer Configuration.
 */
export interface TokenizerConfig {
  /** Vocabulary mapping. */
  vocab: Vocabulary

  /** Maximum sequence length (default: 512). */
  maxLength?: number

  /** Whether to do basic tokenization (default: true). */
  doBasicTokenize?: boolean

  /** Whether to lowercase input (default: true). */
  doLowerCase?: boolean

  /** Unknown token (default: "[UNK]"). */
  unkToken?: string

  /** Separator token (default: "[SEP]"). */
  sepToken?: string

  /** Pad token (default: "[PAD]"). */
  padToken?: string

  /** Classification token (default: "[CLS]"). */
  clsToken?: string

  /** Mask token (default: "[MASK]"). */
  maskToken?: string

  /** Subword prefix (default: "##"). */
  subwordPrefix?: string
}

/**
 * WordPiece Tokenizer for BERT-like models.
 *
 * USAGE:
 * ```typescript
 * import { WordPieceTokenizer } from './wordpiece-tokenizer.mts'
 *
 * // Load vocabulary from file.
 * const vocab = JSON.parse(await fs.readFile('vocab.json', 'utf-8'))
 *
 * // Create tokenizer.
 * const tokenizer = new WordPieceTokenizer({ vocab })
 *
 * // Tokenize text.
 * const result = tokenizer.tokenize('fix vulnerabilities')
 * console.log(result.inputIds) // [101, 8081, 23829, 102]
 * ```
 */
export class WordPieceTokenizer {
  private vocab: Vocabulary
  private idsToTokens: Map<number, string>
  private maxLength: number
  private doBasicTokenize: boolean
  private doLowerCase: boolean
  private unkToken: string
  private sepToken: string
  private padToken: string
  private clsToken: string
  private maskToken: string
  private subwordPrefix: string

  constructor(config: TokenizerConfig) {
    this.vocab = config.vocab
    this.maxLength = config.maxLength || 512
    this.doBasicTokenize = config.doBasicTokenize ?? true
    this.doLowerCase = config.doLowerCase ?? true
    this.unkToken = config.unkToken || '[UNK]'
    this.sepToken = config.sepToken || '[SEP]'
    this.padToken = config.padToken || '[PAD]'
    this.clsToken = config.clsToken || '[CLS]'
    this.maskToken = config.maskToken || '[MASK]'
    this.subwordPrefix = config.subwordPrefix || '##'

    // Create reverse mapping: ID → token.
    this.idsToTokens = new Map()
    for (const [token, id] of Object.entries(this.vocab)) {
      this.idsToTokens.set(id, token)
    }
  }

  /**
   * Tokenize text into WordPiece tokens and IDs.
   *
   * PROCESS:
   * 1. Basic tokenization (whitespace + punctuation)
   * 2. WordPiece tokenization (greedy longest-match)
   * 3. Add special tokens ([CLS], [SEP])
   * 4. Convert to IDs
   * 5. Create attention mask
   *
   * @param text - Input text to tokenize
   * @returns Tokenization result with IDs, mask, and tokens
   */
  tokenize(text: string): TokenizationResult {
    // Step 1: Basic tokenization.
    let tokens: string[]
    if (this.doBasicTokenize) {
      tokens = this.basicTokenize(text)
    } else {
      tokens = [text]
    }

    // Step 2: WordPiece tokenization.
    const wordpieceTokens: string[] = []
    for (const token of tokens) {
      const subTokens = this.wordpieceTokenize(token)
      wordpieceTokens.push(...subTokens)
    }

    // Step 3: Add special tokens.
    const finalTokens = [this.clsToken, ...wordpieceTokens, this.sepToken]

    // Step 4: Truncate if needed.
    const truncated = finalTokens.slice(0, this.maxLength)

    // Step 5: Convert to IDs.
    const inputIds = truncated.map(token => this.convertTokenToId(token))

    // Step 6: Create attention mask (all 1s for real tokens).
    const attentionMask = new Array(inputIds.length).fill(1)

    return {
      inputIds,
      attentionMask,
      tokens: truncated,
    }
  }

  /**
   * Basic tokenization: whitespace splitting + punctuation handling.
   *
   * WHAT IT DOES:
   * - Lowercase text (if enabled)
   * - Strip accents (é → e)
   * - Split on whitespace
   * - Separate punctuation
   *
   * EXAMPLE:
   *   Input:  "Don't fix vulnerabilities!"
   *   Output: ["don", "'", "t", "fix", "vulnerabilities", "!"]
   *
   * @param text - Input text
   * @returns Array of basic tokens
   */
  private basicTokenize(text: string): string[] {
    // Lowercase if enabled.
    if (this.doLowerCase) {
      text = text.toLowerCase()
    }

    // Strip accents: é → e, ñ → n.
    text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    // Split on whitespace.
    const tokens: string[] = []
    for (const word of text.split(/\s+/)) {
      if (word.length === 0) {
        continue
      }

      // Split punctuation from words.
      const punctSplit = this.splitPunctuation(word)
      tokens.push(...punctSplit)
    }

    return tokens
  }

  /**
   * Split punctuation from words.
   *
   * EXAMPLE:
   *   Input:  "don't"
   *   Output: ["don", "'", "t"]
   *
   * @param text - Input text
   * @returns Array of tokens with punctuation separated
   */
  private splitPunctuation(text: string): string[] {
    const tokens: string[] = []
    let currentToken = ''

    for (const char of text) {
      if (this.isPunctuation(char)) {
        if (currentToken.length > 0) {
          tokens.push(currentToken)
          currentToken = ''
        }
        tokens.push(char)
      } else {
        currentToken += char
      }
    }

    if (currentToken.length > 0) {
      tokens.push(currentToken)
    }

    return tokens
  }

  /**
   * Check if character is punctuation.
   *
   * @param char - Character to check
   * @returns True if punctuation
   */
  private isPunctuation(char: string): boolean {
    const code = char.charCodeAt(0)

    // ASCII punctuation.
    if (
      (code >= 33 && code <= 47) || // !"#$%&'()*+,-./
      (code >= 58 && code <= 64) || // :;<=>?@
      (code >= 91 && code <= 96) || // [\]^_`
      (code >= 123 && code <= 126) // {|}~
    ) {
      return true
    }

    // Unicode punctuation categories.
    return /^\p{P}$/u.test(char)
  }

  /**
   * WordPiece tokenization: greedy longest-match from vocabulary.
   *
   * ALGORITHM:
   * 1. Start at beginning of word
   * 2. Find longest substring in vocabulary
   * 3. Add to tokens (with ## prefix if not first)
   * 4. Move to next position
   * 5. Repeat until word is consumed
   * 6. If no match found, use [UNK] token
   *
   * EXAMPLE:
   *   Word: "vulnerabilities"
   *   Vocab: {"vulnerability": 123, "##ies": 456}
   *   Result: ["vulnerability", "##ies"]
   *
   * @param word - Input word
   * @returns Array of WordPiece subword tokens
   */
  private wordpieceTokenize(word: string): string[] {
    if (word.length > 200) {
      // Too long - use UNK token.
      return [this.unkToken]
    }

    const tokens: string[] = []
    let start = 0

    while (start < word.length) {
      let end = word.length
      let foundToken: string | null = null

      // Greedy longest-match: try longest substring first.
      while (start < end) {
        let substr = word.slice(start, end)

        // Add subword prefix if not first token.
        if (start > 0) {
          substr = this.subwordPrefix + substr
        }

        // Check if substring is in vocabulary.
        if (this.vocab[substr] !== undefined) {
          foundToken = substr
          break
        }

        end -= 1
      }

      if (foundToken === null) {
        // No match found - entire word is unknown.
        return [this.unkToken]
      }

      tokens.push(foundToken)
      start = end
    }

    return tokens
  }

  /**
   * Convert token string to ID.
   *
   * @param token - Token string
   * @returns Token ID from vocabulary, or UNK ID if not found
   */
  private convertTokenToId(token: string): number {
    return this.vocab[token] ?? this.vocab[this.unkToken] ?? 0
  }

  /**
   * Convert token ID to string.
   *
   * @param id - Token ID
   * @returns Token string from vocabulary, or UNK token if not found
   */
  convertIdToToken(id: number): string {
    return this.idsToTokens.get(id) ?? this.unkToken
  }

  /**
   * Decode token IDs back to text.
   *
   * PROCESS:
   * 1. Convert IDs to tokens
   * 2. Remove special tokens ([CLS], [SEP], [PAD])
   * 3. Join subwords (remove ## prefix)
   * 4. Join tokens with spaces
   *
   * EXAMPLE:
   *   IDs: [101, 8081, 2075, 102]
   *   Tokens: ["[CLS]", "fix", "##ing", "[SEP]"]
   *   Output: "fixing"
   *
   * @param ids - Token IDs to decode
   * @returns Decoded text string
   */
  decode(ids: number[]): string {
    const tokens = ids.map(id => this.convertIdToToken(id))

    // Remove special tokens.
    const filtered = tokens.filter(
      token =>
        token !== this.clsToken &&
        token !== this.sepToken &&
        token !== this.padToken
    )

    // Join subwords and tokens.
    let text = ''
    for (const token of filtered) {
      if (token.startsWith(this.subwordPrefix)) {
        // Subword - append without space.
        text += token.slice(this.subwordPrefix.length)
      } else {
        // New word - add space if not first.
        if (text.length > 0) {
          text += ' '
        }
        text += token
      }
    }

    return text
  }
}
