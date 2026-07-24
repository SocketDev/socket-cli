/**
 * @file Keep generic agent guidance cross-agent. Fleet rules, hooks, generated
 *   messages, and docs are consumed by Codex, Claude Code, OpenCode, and other
 *   agent runners. Product-specific references are allowed when they name a
 *   real integration (`Claude Code`, `CLAUDE_PROJECT_DIR`, `claude -p`,
 *   `CLAUDE.md`), but generic instructions should say "the agent" / "agents"
 *   instead of assuming the reader is Claude.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const GENERIC_CLAUDE_PATTERNS: readonly RegExp[] = [
  // Matches "Claude" followed by a verb (blocks, can, chooses, ...) describing generic agent behavior.
  /\bClaude\s+(?:blocks?|can|chooses?|loads?|must|needs?|reads?|reports?|runs?|sees|should|uses?|will|writes?)\b/i,
  // Matches "Claude" (optionally possessive) followed by a generic noun like agent/context/session/tool.
  /\bClaude(?:'s)?\s+(?:agent|assistant|context|output|response|session|tool|tools|turn|workflow)\b/i,
  /\bthe\s+Claude\s+agent\b/i,
]

// Matches real Claude-specific integrations (package name, config file, env var, product name, CLI flags) that are exempt from the generic-phrase check.
const PRODUCT_SPECIFIC_RE =
  /\b(?:@anthropic-ai\/claude|CLAUDE\.md|CLAUDE_PROJECT_DIR|Claude Code|claude\s+(?:--print|-p|CLI|SDK))\b/i

function genericClaudePhrase(text: string): string | undefined {
  if (PRODUCT_SPECIFIC_RE.test(text)) {
    return undefined
  }
  for (let i = 0, { length } = GENERIC_CLAUDE_PATTERNS; i < length; i += 1) {
    const match = GENERIC_CLAUDE_PATTERNS[i]!.exec(text)
    if (match) {
      return match[0]
    }
  }
  return undefined
}

function literalText(node: AstNode): string | undefined {
  if (typeof node.value === 'string') {
    return node.value
  }
  return undefined
}

function templateText(node: AstNode): string | undefined {
  const cooked = node.value?.cooked
  return typeof cooked === 'string' ? cooked : undefined
}

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Keep generic agent guidance cross-agent: say "the agent" unless the text names a real Claude-specific integration.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      brandAssumption:
        'Generic agent guidance says "{{phrase}}". Use "the agent" / "agents" unless this is a real Claude-specific integration.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    function reportIfGeneric(node: AstNode, text: string): void {
      const phrase = genericClaudePhrase(text)
      if (!phrase) {
        return
      }
      context.report({
        node,
        messageId: 'brandAssumption',
        data: { phrase },
      })
    }

    return {
      Program(node: AstNode) {
        const sourceCode = context.getSourceCode
          ? context.getSourceCode()
          : context.sourceCode
        const comments = sourceCode?.getAllComments?.() ?? []
        for (let i = 0, { length } = comments; i < length; i += 1) {
          const comment = comments[i]!
          reportIfGeneric(node, comment.value)
        }
      },

      Literal(node: AstNode) {
        const text = literalText(node)
        if (text) {
          reportIfGeneric(node, text)
        }
      },

      TemplateElement(node: AstNode) {
        const text = templateText(node)
        if (text) {
          reportIfGeneric(node, text)
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
