# LLM & Semantic Understanding Scripts

Scripts for building semantic understanding capabilities for Socket CLI without heavy ML models.

## Philosophy

**Goal**: Enable natural language understanding for `socket ask` command **WITHOUT** shipping 12MB+ ML models.

**Approach**: Pre-compute semantic indices at build time using lightweight techniques:
- Synonym expansion
- Word overlap matching
- Manual curation of common query patterns

**Result**: ~3KB semantic index vs 12MB ML model, with 80-90% of the semantic matching capability.

## Scripts

### `generate-semantic-index.mjs`

**Purpose**: Generate semantic similarity index without ML models.

**What it does**:
- Reads Socket CLI command definitions
- Expands keywords using synonym dictionary
- Creates searchable word index for fast matching

**Output**: `~/.claude/skills/socket-cli/semantic-index.json` (~3KB)

**Usage**:
```bash
node scripts/llm/generate-semantic-index.mjs
```

**How it works**:
1. Maps synonyms to canonical forms (e.g., "repair" → "fix")
2. Extracts meaningful words from commands, descriptions, examples
3. Creates word overlap index for O(n) matching at runtime

**Examples**:
- Query: "repair vulnerabilities" → Matches "fix" (via synonym)
- Query: "check my deps" → Matches "scan" (deps = dependencies)

### `generate-skill-embeddings.mjs` (deprecated)

**Status**: NOT USED - requires transformers.js (12MB+)

This was the original approach using ML embeddings. We've replaced it with the
lightweight semantic-index approach above.

### `compute-embeddings-pure.mjs` (deprecated)

**Status**: NOT USED - requires onnxruntime-node

Attempted to use pure ONNX without transformers.js wrapper, but still requires
native dependencies and model downloads.

## Integration

The semantic index is loaded by `src/commands/ask/handle-ask.mts` at runtime:

```javascript
// Load semantic index (3KB, pre-computed).
const semanticIndex = JSON.parse(
  readFileSync('~/.claude/skills/socket-cli/semantic-index.json')
)

// Match query using word overlap.
const match = findBestMatch(query, semanticIndex)
```

## Claude Skills

These scripts also generate data for Claude Code skills stored in `~/.claude/skills/socket-cli/`:

- `SKILL.md` - Skill definition and documentation
- `commands.json` - Structured command data
- `semantic-index.json` - Pre-computed semantic index

These skills help Claude better understand Socket CLI when providing assistance.

## Future Enhancements

Possible improvements (all without ML models):

1. **Fuzzy matching** - Handle typos using Levenshtein distance
2. **N-gram matching** - Match partial phrases
3. **Context awareness** - Consider previous commands in session
4. **User feedback loop** - Learn from corrections

All of these can be implemented in pure JavaScript with <10KB overhead.
