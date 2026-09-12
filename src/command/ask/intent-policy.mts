export type AskRefusal = 'negated' | 'ambiguous' | 'invalid-query'

export function assessAskQuery(query: string): AskRefusal | undefined {
  if (query.trim() === '' || query.length > 4096) {
    return 'invalid-query'
  }
  // Whole-word negations and straight or curly apostrophes in don't.
  if (/\b(?:never|no|not|without)\b|\bdon['’]t\b/iu.test(query)) {
    return 'negated'
  }
  // Shell separators, command substitution, and embedded newlines are ambiguous.
  if (/[;\n\r]|&&|\|\||`|\$\(/u.test(query)) {
    return 'ambiguous'
  }
  // A comma or conjunction followed by a command verb requests another action.
  if (
    /(?:,\s*|\b(?:and|or|then)\s+)(?:(?:also|please)\s+)*(?:apply|audit|check|fix|inspect|list|optimize|patch|repair|review|scan|show|update|upgrade)\b/iu.test(
      query,
    )
  ) {
    return 'ambiguous'
  }
  const actions = [
    /\b(?:fix|remediate|repair|resolve|update|upgrade)\b/iu,
    /\b(?:analyze|audit|check|inspect|review|scan)\b/iu,
    /\b(?:enhance|improve|optimize|replace)\b/iu,
    /\bpatch\b/iu,
  ]
  if (actions.filter(pattern => pattern.test(query)).length > 1) {
    return 'ambiguous'
  }
  return undefined
}

export function isAskPackageName(value: string): boolean {
  return (
    value.length <= 214 &&
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(value)
  )
}
