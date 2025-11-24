/**
 * Pre-compute semantic embeddings for Socket CLI commands.
 * This runs at build time to generate embeddings that can be used
 * for semantic matching without requiring a runtime model.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { pipeline } from '@xenova/transformers'
import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillDir = path.join(
  path.dirname(__dirname),
  '../.claude/skills/socket-cli',
)

logger.log('🧠 Computing semantic embeddings for Socket CLI commands...')

// Load commands.
const commandsPath = path.join(skillDir, 'commands.json')
const commands = JSON.parse(readFileSync(commandsPath, 'utf-8'))

// Initialize embedding pipeline.
logger.log('📦 Loading paraphrase-MiniLM-L3-v2 model...')
const embedder = await pipeline(
  'feature-extraction',
  'Xenova/paraphrase-MiniLM-L3-v2',
)

/**
 * Get embedding for a text string.
 */
async function getEmbedding(text) {
  const result = await embedder(text, { pooling: 'mean', normalize: true })
  return Array.from(result.data)
}

// Compute embeddings for each command.
const embeddings = {
  commands: {},
  meta: {
    model: 'Xenova/paraphrase-MiniLM-L3-v2',
    dimension: 384,
    generatedAt: new Date().toISOString(),
  },
}

for (const [commandName, commandData] of Object.entries(commands.commands)) {
  logger.log(`  → Computing embedding for: ${commandName}`)

  // Embed the description (most semantic meaning).
  const embedding = await getEmbedding(commandData.description)

  embeddings.commands[commandName] = {
    description: commandData.description,
    embedding,
    keywords: commandData.keywords,
    examples: commandData.examples,
  }
}

// Also compute embeddings for all example queries.
logger.log('📝 Computing embeddings for example queries...')
embeddings.examples = {}

for (const [commandName, commandData] of Object.entries(commands.commands)) {
  for (const example of commandData.examples) {
    const embedding = await getEmbedding(example)
    embeddings.examples[example] = {
      command: commandName,
      embedding,
    }
  }
}

// Save embeddings.
const outputPath = path.join(skillDir, 'embeddings.json')
writeFileSync(outputPath, JSON.stringify(embeddings, null, 2), 'utf-8')

logger.log(`✓ Generated ${outputPath}`)
logger.log(`✓ Embedded ${Object.keys(embeddings.commands).length} commands`)
logger.log(
  `✓ Embedded ${Object.keys(embeddings.examples).length} example queries`,
)
logger.log(
  `✓ File size: ${(JSON.stringify(embeddings).length / 1024).toFixed(2)} KB`,
)
