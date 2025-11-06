# LLM & Semantic Understanding Scripts

Scripts for building semantic understanding capabilities for Socket CLI without heavy ML models.

## Scripts

### `generate-semantic-index.mjs`

**Purpose**: Generate semantic similarity index without ML models.

**What it does**:
- Reads Socket CLI command definitions
- Expands keywords using synonym dictionary
- Creates searchable word index for fast matching

**Output**: `~/.claude/skills/socket-cli/semantic-index.json`

**Usage**:
```bash
node scripts/llm/generate-semantic-index.mjs
```

### `generate-skill-embeddings.mjs` (deprecated)

**Status**: NOT USED - requires transformers.js (12MB+)

This was the original approach using ML embeddings. We've replaced it with the
lightweight semantic-index approach above.

### `compute-embeddings-pure.mjs` (deprecated)

**Status**: NOT USED - requires onnxruntime-node

Attempted to use pure ONNX without transformers.js wrapper, but still requires
native dependencies and model downloads.

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
