const ENV_VAR_REF = /\$\$|\$\{(\w+)\}|\$(\w+)/g

// Expands `$VAR`/`${VAR}` references (e.g. a team-shared `javaHome:
// "$JAVA11_HOME"`) against the CLI process's own environment, so a socket.json
// value works across machines instead of hardcoding one developer's path.
// `$$` is a literal `$`, for a value that must contain a literal `$WORD`.
export function expandEnvVarRefs(value: string): {
  missing?: string[]
  value: string
} {
  const missing: string[] = []
  const expanded = value.replace(ENV_VAR_REF, (match, braced, bare) => {
    if (match === '$$') {
      return '$'
    }
    const name = braced ?? bare
    const resolved = process.env[name]
    if (resolved === undefined) {
      if (!missing.includes(name)) {
        missing.push(name)
      }
      return ''
    }
    return resolved
  })
  return missing.length ? { missing, value: expanded } : { value: expanded }
}

export function formatMissingEnvVarRefs(missing: readonly string[]): string {
  const names = missing.map(name => `\`${name}\``).join(', ')
  const verb = missing.length > 1 ? 'are' : 'is'
  return `references ${names}, which ${verb} not set in this environment`
}
