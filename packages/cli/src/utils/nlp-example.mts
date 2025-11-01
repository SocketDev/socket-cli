/**
 * Example usage of progressive enhancement NLP API.
 *
 * Shows how the API gracefully falls back from:
 * CodeT5 → MiniLM → compromise
 */

import {
  analyzeCode,
  explainVulnerability,
  generateCode,
  getNLPCapabilities,
  getSentiment,
  semanticSimilarity,
  tokenize,
} from './nlp.mts'

/**
 * Example: Analyze package code for security issues.
 */
export async function analyzePackageSecurity(packageCode: string) {
  // Check what capabilities are available.
  const capabilities = await getNLPCapabilities()

  console.log('NLP Capabilities:')
  console.log(`  Baseline (compromise): ${capabilities.baseline}`)
  console.log(`  Enhanced (MiniLM): ${capabilities.enhanced}`)
  console.log(`  CodeT5: ${capabilities.codet5}`)
  console.log()

  // Analyze code (uses CodeT5 if available, otherwise baseline).
  const analysis = await analyzeCode(packageCode, 'javascript')
  console.log('Code Analysis:')
  console.log(`  Summary: ${analysis.summary}`)
  console.log(`  Complexity: ${analysis.complexity}`)
  console.log()

  // If vulnerability found, explain it.
  if (packageCode.includes('eval(')) {
    const explanation = await explainVulnerability('Code Injection', packageCode)
    console.log('Vulnerability Explanation:')
    console.log(`  ${explanation}`)
    console.log()
  }

  return analysis
}

/**
 * Example: Find similar packages using semantic search.
 */
export async function findSimilarPackages(
  query: string,
  packages: Array<{ name: string; description: string }>
) {
  const capabilities = await getNLPCapabilities()

  console.log(`Searching for packages similar to: "${query}"`)
  console.log(`Using: ${capabilities.enhanced ? 'MiniLM embeddings' : 'compromise term overlap'}`)
  console.log()

  // Calculate similarity scores.
  const results = await Promise.all(
    packages.map(async pkg => ({
      name: pkg.name,
      score: await semanticSimilarity(query, pkg.description),
    }))
  )

  // Sort by similarity.
  results.sort((a, b) => b.score - a.score)

  console.log('Top 5 Similar Packages:')
  for (const result of results.slice(0, 5)) {
    console.log(`  ${result.name}: ${(result.score * 100).toFixed(1)}% match`)
  }

  return results
}

/**
 * Example: Generate fix code for vulnerability.
 */
export async function generateVulnerabilityFix(
  vulnerableCode: string,
  vulnerabilityType: string
) {
  const capabilities = await getNLPCapabilities()

  if (!capabilities.codet5) {
    console.log('⚠️  CodeT5 not available - code generation unavailable')
    console.log('   Install AI models for enhanced features')
    return null
  }

  console.log(`Generating fix for ${vulnerabilityType} vulnerability...`)

  const fixDescription = `Fix ${vulnerabilityType} in this code: ${vulnerableCode}`
  const fixedCode = await generateCode(fixDescription, 'javascript')

  if (fixedCode) {
    console.log('Generated Fix:')
    console.log(fixedCode)
  } else {
    console.log('❌ Code generation failed')
  }

  return fixedCode
}

/**
 * Example: Analyze package metadata sentiment.
 */
export async function analyzePackageMetadata(packageName: string, readme: string) {
  console.log(`Analyzing ${packageName} metadata...`)
  console.log()

  // Tokenize README.
  const tokens = await tokenize(readme)
  console.log(`README tokens: ${tokens.length}`)

  // Get sentiment.
  const sentiment = await getSentiment(readme)
  console.log(`Sentiment: ${sentiment.label} (${sentiment.score.toFixed(2)})`)

  return {
    sentiment,
    tokens: tokens.length,
  }
}

/**
 * Example: Progressive enhancement in action.
 */
export async function demonstrateProgressiveEnhancement() {
  console.log('='.repeat(60))
  console.log('Progressive Enhancement NLP Demo')
  console.log('='.repeat(60))
  console.log()

  const capabilities = await getNLPCapabilities()

  // Feature tier indicator.
  const tier = capabilities.codet5
    ? 'PREMIUM (CodeT5 + MiniLM + compromise)'
    : capabilities.enhanced
      ? 'ENHANCED (MiniLM + compromise)'
      : 'BASELINE (compromise only)'

  console.log(`Current Tier: ${tier}`)
  console.log()

  console.log('Available Features:')
  console.log(`  ✓ Tokenization: ${capabilities.features.tokenization}`)
  console.log(`  ${capabilities.features.embeddings ? '✓' : '✗'} Embeddings: ${capabilities.features.embeddings}`)
  console.log(`  ✓ Semantic Similarity: ${capabilities.features.semanticSimilarity}`)
  console.log(`  ✓ Named Entities: ${capabilities.features.namedEntities}`)
  console.log(`  ✓ Sentiment: ${capabilities.features.sentiment}`)
  console.log(`  ✓ Code Analysis: ${capabilities.features.codeAnalysis}`)
  console.log(`  ✓ Vulnerability Explanation: ${capabilities.features.vulnerabilityExplanation}`)
  console.log(`  ${capabilities.features.codeGeneration ? '✓' : '✗'} Code Generation: ${capabilities.features.codeGeneration}`)
  console.log()

  if (!capabilities.enhanced) {
    console.log('💡 Tip: Install MiniLM model for semantic search')
  }
  if (!capabilities.codet5) {
    console.log('💡 Tip: Install CodeT5 model for code generation')
  }

  console.log()
  console.log('='.repeat(60))
}
