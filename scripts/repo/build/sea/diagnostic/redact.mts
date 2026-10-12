const SECRET_PATTERNS = [
  {
    name: 'assignment',
    // Redact credentials assigned to token, key, password, or secret fields.
    re: /(?<prefix>\b[A-Za-z0-9_-]{0,64}(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|credential|signature|sig|password|passwd)\b(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)(?!\[redacted\])[^\s"',;}&\\\]]+/giu,
    replace: (groups: Record<string, string>) =>
      `${groups['prefix']}[redacted]`,
  },
  {
    name: 'openai-token',
    // Redact OpenAI-style secret keys.
    re: /sk-(?:proj-)?[A-Za-z0-9_*=-]{8,}/gu,
    replace: () => '[redacted]',
  },
  {
    name: 'github-token',
    // Redact GitHub personal access and application tokens.
    re: /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}/giu,
    replace: () => '[redacted]',
  },
  {
    name: 'npm-token',
    // Redact npm automation tokens.
    re: /npm_[A-Za-z0-9_-]{8,}/giu,
    replace: () => '[redacted]',
  },
  {
    name: 'socket-token',
    // Redact Socket API tokens.
    re: /sktsec_[A-Za-z0-9_-]{8,}/giu,
    replace: () => '[redacted]',
  },
  {
    name: 'auth-scheme',
    // Redact Basic, Bearer, and Token authorization values.
    re: /(?<lead>^|%20|[^A-Za-z0-9_])(?<scheme>Basic|Bearer|Token)(?<sep>(?:%20|\+|\s)\s*)(?=[A-Za-z]*[0-9.%_~+/*=-])[A-Za-z0-9.%_~+/*=-]{8,}/giu,
    replace: (groups: Record<string, string>) =>
      `${groups['lead']}${groups['scheme']}${groups['sep']}[redacted]`,
  },
  {
    name: 'url-userinfo',
    // Redact URL usernames and passwords.
    re: /(?<proto>(?:git\+ssh|https?|ssh):\/\/)[^\s/@]+@/giu,
    replace: (groups: Record<string, string>) =>
      `${groups['proto']}[redacted]@`,
  },
  {
    name: 'url-query',
    // Redact secret-like URL query parameters, including encoded separators.
    re: /(?<param>(?:%26|%3F|[?&])(?:(?!%26|%3D|%3F)[A-Za-z0-9_.%[\]-]){0,64}(?:api(?:%2D|%5F|[_-])?key|access(?:%2D|%5F|[_-])?key(?:(?:%2D|%5F|[_-])?id)?|token|secret|credential|signature|sig|password|passwd)(?:%5D|\])?(?:%3D|=))(?!\[redacted\])(?:(?!%26)[^&\s])+/giu,
    replace: (groups: Record<string, string>) => `${groups['param']}[redacted]`,
  },
]

export function redactDiagnosticText(text: string): string {
  let output = text
  for (const { re, replace } of SECRET_PATTERNS) {
    output = output.replaceAll(re, (...args: unknown[]) => {
      const tail = args.at(-1)
      const groups =
        typeof tail === 'object' && tail !== null
          ? (tail as Record<string, string>)
          : {}
      return replace(groups)
    })
  }
  return output
}
