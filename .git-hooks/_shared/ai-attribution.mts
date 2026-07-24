// AI-attribution matcher — shared by the commit-msg git-stage backstop + the
// pre-push hook (commit messages) AND the Claude-side
// no-github-ai-attribution-guard (PR/issue/comment/release/discussion prose).
// Gate-free (no Node-25 hard-exit, unlike helpers.mts) so the Claude hook can
// import it on the operator's Node, mirroring external-issue-ref.mts.
//
// Matches BOILERPLATE attribution patterns ("Generated with Claude",
// "Co-Authored-By: Claude", "Assisted-by: Claude Code:opus-4-8", emoji
// prefixes, vendor email addresses, the auto-appended `Claude-Session:`
// trailer / session-URL) — NOT legitimate product / directory references.
// Bare "Claude" / "Claude Code" / ".claude/" are valid prose; only the
// attribution-verb-anchored forms, the hyphenated trailer keys
// (`Co-Authored-By:` / `Assisted-by:`, never legitimate prose), and the
// `claude.ai/code/session_` URL shape trigger.

// CRLF-tolerant line split. Inlined (not imported from helpers.mts) so this
// module stays free of the Node-25 hard-exit gate helpers.mts carries — a
// Claude hook importing it must run on the operator's (possibly older) Node.
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

// Verb branch: "<verb> with/by <vendor>" (Generated with Claude, Written by AI).
// Trailer branch: "Co-Authored-by:" / "Assisted-by:" <vendor> — the
//   `<engine>:<model>` footer (e.g. "Assisted-by: Claude Code:opus-4-8") that
//   leaked into a PR summary matches via the leading "Assisted-by: Claude".
// Plus emoji/AI-generated/vendor-email/session-trailer/Assistant: line forms.
export const AI_ATTRIBUTION_RE =
  /(?:(?:Authored|Built|Crafted|Created|Generated|Made|Powered|Written)\s+(?:by|with)\s+(?:AI|Bard|ChatGPT|Claude|Copilot|Cursor|GPT|Gemini)|(?:Assisted|Co-Authored)[\s-]?by:?\s+(?:AI|Bard|ChatGPT|Claude|Copilot|Cursor|GPT|Gemini)|🤖\s+Generated|AI[\s-]generated|Machine[\s-]generated|@(?:anthropic|openai)\.com|^[ \t]*Claude-Session:|claude\.ai\/code\/session_|^Assistant:)/im

export const containsAiAttribution = (text: string): boolean =>
  AI_ATTRIBUTION_RE.test(text)

export const stripAiAttribution = (
  text: string,
): { cleaned: string; removed: number } => {
  const lines = splitLines(text)
  const kept: string[] = []
  let removed = 0
  for (const line of lines) {
    if (AI_ATTRIBUTION_RE.test(line)) {
      removed++
    } else {
      kept.push(line)
    }
  }
  return { cleaned: kept.join('\n'), removed }
}
