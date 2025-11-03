/**
 * Socket CLI: Polyfill localeCompare
 *
 * Safety fallback for String.prototype.localeCompare() in small-icu builds.
 *
 * WHY THIS EXISTS:
 * - Node.js built with --with-intl=small-icu has English-only ICU data
 * - localeCompare() may throw errors or behave unexpectedly for non-English locales
 * - This polyfill provides basic alphabetical comparison as a fallback
 *
 * WHEN IT ACTIVATES:
 * - Only when native localeCompare() throws an error
 * - Preserves native behavior whenever possible
 *
 * LIMITATIONS:
 * - Fallback uses basic character code comparison (no locale awareness)
 * - Does not support advanced collation rules
 * - Sufficient for Socket CLI's internal use cases
 */

'use strict';

// Save reference to original implementation.
const originalLocaleCompare = String.prototype.localeCompare;

// Basic fallback: compare character codes.
function fallbackLocaleCompare(that, locales, options) {
  // Basic comparison using character codes.
  if (that < this) return -1;
  if (that > this) return 1;
  return 0;
}

// Wrapper that tries native first, falls back if it throws.
function polyfillLocaleCompare(that, locales, options) {
  try {
    // Try native implementation first.
    return originalLocaleCompare.call(this, that, locales, options);
  } catch (e) {
    // If native throws, use fallback.
    return fallbackLocaleCompare.call(this, that);
  }
}

// Replace String.prototype.localeCompare with wrapped version.
Object.defineProperty(String.prototype, 'localeCompare', {
  value: polyfillLocaleCompare,
  writable: true,
  enumerable: false,
  configurable: true,
});
