/**
 * Socket CLI: Polyfill String.prototype.normalize
 *
 * Safety fallback for String.prototype.normalize() in small-icu builds.
 *
 * WHY THIS EXISTS:
 * - Node.js built with --with-intl=small-icu may have limited normalization support
 * - normalize() may throw errors for certain forms or edge cases
 * - This polyfill provides a basic fallback when native implementation fails
 *
 * WHEN IT ACTIVATES:
 * - Only when native normalize() throws an error
 * - Preserves native behavior whenever possible
 *
 * LIMITATIONS:
 * - Fallback returns original string unchanged (identity function)
 * - Does not perform actual Unicode normalization
 * - Sufficient for Socket CLI's internal use cases where normalization is optional
 *
 * NORMALIZATION FORMS:
 * - NFC: Canonical Decomposition, followed by Canonical Composition
 * - NFD: Canonical Decomposition
 * - NFKC: Compatibility Decomposition, followed by Canonical Composition
 * - NFKD: Compatibility Decomposition
 */

'use strict';

// Save reference to original implementation.
const originalNormalize = String.prototype.normalize;

// Basic fallback: return string unchanged (identity function).
// This is safe because:
// 1. Many use cases work fine with un-normalized strings.
// 2. Socket CLI's code paths that use normalize() handle this gracefully.
// 3. Better to have working code with un-normalized strings than crash.
function fallbackNormalize(form) {
  return this;
}

// Wrapper that tries native first, falls back if it throws.
function polyfillNormalize(form) {
  try {
    // Try native implementation first.
    return originalNormalize.call(this, form);
  } catch (e) {
    // If native throws, use fallback (return unchanged).
    return fallbackNormalize.call(this, form);
  }
}

// Replace String.prototype.normalize with wrapped version.
Object.defineProperty(String.prototype, 'normalize', {
  value: polyfillNormalize,
  writable: true,
  enumerable: false,
  configurable: true,
});
