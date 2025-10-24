/**
 * @fileoverview Intl.Segmenter stub - Character-by-character segmentation.
 *
 * Real behavior:
 * - Segments text into grapheme clusters, words, or sentences
 * - Locale-aware (e.g., Thai has no spaces between words)
 * - Example (grapheme): segments "👨‍👩‍👧‍👦" → single segment (family emoji)
 *
 * Stub behavior:
 * - Simple character-by-character split
 * - No grapheme cluster awareness
 * - Example: segments "👨‍👩‍👧‍👦" → multiple segments (breaks emoji)
 * - Ignores all locale and granularity parameters
 *
 * Trade-off: Character-level split is sufficient for ASCII text.
 */

import { IntlBase } from './base.mts'

export class SegmenterStub extends IntlBase {
  granularity: string
  locale: string

  constructor(_locales?: string | string[], options?: Intl.SegmenterOptions) {
    super()
    this.locale = 'en-US'
    this.granularity = options?.granularity || 'grapheme'
  }

  segment(text: string): Intl.Segments {
    // Return iterable of segments (simplest: split by character).
    const segments: Intl.SegmentData[] = []
    for (let i = 0; i < text.length; i++) {
      segments.push({
        index: i,
        input: text,
        // Use non-null assertion since array access always returns string for valid indices.
        segment: text[i]!,
      })
    }
    return segments as unknown as Intl.Segments
  }

  resolvedOptions(): Intl.ResolvedSegmenterOptions {
    return {
      granularity: this.granularity as 'grapheme' | 'word' | 'sentence',
      locale: 'en-US',
    }
  }
}
