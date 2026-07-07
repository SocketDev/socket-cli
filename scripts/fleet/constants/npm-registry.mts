/**
 * @file The single canonical npm registry the fleet talks to. ONE source of
 *   truth shared by: the `.npmrc` `registry=` setting npm + pnpm read for
 *   installs/lookups (a check asserts `.npmrc` matches this), the soak-exclude
 *   publish-date verification (fleet-soak-exclude-parity fetches packuments
 *   from here), the publish-config hardening gate (publishConfig.registry, if
 *   set, must equal this), and any tooling that probes the registry. The fleet
 *   publishes provenance-signed tarballs to public npm, so this is npmjs.org —
 *   not a Socket-owned registry. Change it in ONE place and everything
 *   follows.
 */

// Base URL, NO trailing slash — callers append `/${name}` for a packument, or
// use NPM_REGISTRY (the trailing-slash form) where a config value is expected.
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org'

// Trailing-slash form — the value npm/pnpm write into `.npmrc` `registry=` and
// the form a `publishConfig.registry` pin must equal.
export const NPM_REGISTRY = `${NPM_REGISTRY_URL}/`
