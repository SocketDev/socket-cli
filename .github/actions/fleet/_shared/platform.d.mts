/**
 * @file Type declarations for platform.mjs — the dep-0 bootstrap helper that
 *   prints the canonical Socket platform string for this runner. The .mjs is
 *   intentionally untyped (it runs before node_modules); this .d.mts mirrors
 *   the EXPORTED helper so unit tests can import it with type-checking. Keep
 *   in step with the .mjs exports.
 */

export function canonicalPlatform(): string
