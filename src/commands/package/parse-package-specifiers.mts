// Either an ecosystem was given or all args must be (namespaced) purls
// The `pkg:` part is optional here. We'll scan for `eco/name@version`.
// Not hardcoding the namespace since we don't know what the server accepts.
// The ecosystem is considered as the first package if it is not an a-z string.
export function parsePackageSpecifiers(
  ecosystem: string,
  pkgs: string[]
): { purls: string[]; valid: boolean } {
  let valid = true
  const purls = []
  if (!ecosystem) {
    valid = false
  } else if (/^[a-zA-Z]+$/.test(ecosystem)) {
    for (let i = 0; i < pkgs.length; ++i) {
      const pkg = pkgs[i] ?? ''
      if (!pkg) {
        valid = false
        break
      } else if (pkg.startsWith('pkg:')) {
        // keep
        purls.push(pkg)
      } else {
        purls.push('pkg:' + ecosystem + '/' + pkg)
      }
    }
    if (!purls.length) {
      valid = false
    }
  } else {
    // Assume ecosystem is a purl, too
    pkgs.unshift(ecosystem)

    for (let i = 0; i < pkgs.length; ++i) {
      const pkg = pkgs[i] ?? ''
      if (!/^(?:pkg:)?[a-zA-Z]+\/./.test(pkg)) {
        // At least one purl did not start with `pkg:eco/x` or `eco/x`
        valid = false
        break
      } else if (pkg.startsWith('pkg:')) {
        purls.push(pkg)
      } else {
        purls.push('pkg:' + pkg)
      }
    }

    if (!purls.length) {
      valid = false
    }
  }

  return { purls, valid }
}
