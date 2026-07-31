const ENV_VAR_REF = /\$\{(\w+)\}|\$(\w+)/g

// Expands `$VAR`/`${VAR}` references (e.g. a team-shared `javaHome:
// "$JAVA11_HOME"`) against the CLI process's own environment, so a socket.json
// value works across machines instead of hardcoding one developer's path.
export function expandEnvVarRefs(value: string): {
  missing?: string
  value: string
} {
  let missing: string | undefined
  const expanded = value.replace(ENV_VAR_REF, (_match, braced, bare) => {
    const name = braced ?? bare
    const resolved = process.env[name]
    if (resolved === undefined) {
      missing ??= name
    }
    return resolved ?? ''
  })
  return missing ? { missing, value: expanded } : { value: expanded }
}
