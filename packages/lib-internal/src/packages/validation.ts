/**
 * @fileoverview Package name validation utilities.
 */

let _validateNpmPackageName:
  | typeof import('validate-npm-package-name')
  | undefined
/**
 * Get the validate-npm-package-name module.
 */
/*@__NO_SIDE_EFFECTS__*/
function getValidateNpmPackageName() {
  if (_validateNpmPackageName === undefined) {
    _validateNpmPackageName =
      /*@__PURE__*/ require('validate-npm-package-name')
  }
  return _validateNpmPackageName as typeof import('validate-npm-package-name')
}

/**
 * Check if package name is a blessed Socket.dev package.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isBlessedPackageName(name: unknown): boolean {
  return (
    typeof name === 'string' &&
    (name === 'sfw' ||
      name === 'socket' ||
      name.startsWith('@socketoverride/') ||
      name.startsWith('@socketregistry/') ||
      name.startsWith('@socketsecurity/'))
  )
}

/**
 * Check if a type string represents a registry fetcher type.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isRegistryFetcherType(type: string): boolean {
  // RegistryFetcher spec.type check based on:
  // https://github.com/npm/pacote/blob/v19.0.0/lib/fetcher.js#L467-L488
  return (
    type === 'alias' || type === 'range' || type === 'tag' || type === 'version'
  )
}

/**
 * Check if a package name is valid according to npm naming rules.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isValidPackageName(name: string): boolean {
  const validateNpmPackageName = getValidateNpmPackageName()
  return validateNpmPackageName(name).validForOldPackages
}
