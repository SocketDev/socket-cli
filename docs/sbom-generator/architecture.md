# SBOM Generator - Architecture & API Design

## Core Philosophy

**SBOM is the canonical format. CodeT5 format is a derived optimization.**

### Pipeline Flow

```
┌─────────────┐
│ Lockfiles   │
│ (50,000     │
│  tokens)    │
└──────┬──────┘
       │ Parse
       ▼
┌─────────────┐
│ SBOM        │  ◄─── Canonical Format (CycloneDX v1.5)
│ (Standard)  │       • Industry standard
│ (~50KB)     │       • Interoperable
└──────┬──────┘       • Cacheable
       │ Enrich
       ▼
┌─────────────┐
│ Enriched    │  ◄─── + Socket Security Data
│ SBOM        │       • Vulnerability data
│ (~75KB)     │       • Security scores
└──────┬──────┘       • Supply chain risks
       │ Format
       ▼
┌─────────────┐
│ CodeT5      │  ◄─── Optimized for ML
│ Format      │       • 600x token reduction
│ (~300       │       • Task-specific
│  tokens)    │       • Context-prioritized
└─────────────┘
```

## Why SBOM as Canonical Format?

### 1. Industry Standard
- **CycloneDX v1.5** is widely adopted security standard
- Compatible with: Grype, Syft, Trivy, Dependency-Track, OWASP tools
- Can be consumed by external security tools

### 2. Single Source of Truth
- Parse lockfiles once → Generate SBOM
- Convert SBOM → Multiple formats (CodeT5, JSON, XML, etc.)
- No duplicate parsing logic to maintain

### 3. Flexibility
Generate different CodeT5 formats for different tasks:
```typescript
const sbom = await generateSbom('./project')  // Parse once
const enriched = await enrichSbomWithSocket(sbom, { apiToken })

// Generate task-specific formats
const securityPrompt = formatSbomForCodeT5(enriched, { task: 'security-analysis' })
const vulnPrompt = formatSbomForCodeT5(enriched, { task: 'vulnerability-detection' })
const auditPrompt = formatSbomForCodeT5(enriched, { task: 'dependency-audit' })
```

### 4. Cacheability
- Store SBOM in database/cache
- Regenerate CodeT5 format on-demand
- No need to re-parse lockfiles

### 5. Debuggability
- Inspect full SBOM to troubleshoot issues
- Validate against CycloneDX schema
- Audit what data was sent to CodeT5

### 6. Evolution Path
- Add new enrichment sources (NVD, GitHub Advisory)
- Add new output formats (SPDX, custom)
- Add new optimization strategies

## Format Comparison

| Format | Size | Use Case | Audience |
|--------|------|----------|----------|
| **Lockfiles** | 50,000 tokens | Source data | Package managers |
| **SBOM (CycloneDX)** | ~50KB (12,500 tokens) | Standard interchange | Security tools, APIs |
| **Enriched SBOM** | ~75KB (18,750 tokens) | + Security data | Internal processing |
| **CodeT5 Format** | ~1KB (300 tokens) | ML analysis | CodeT5 model |

**Token reduction: Raw → SBOM = 4x, Raw → CodeT5 = 166x**

## API Design Options

### Option A: SBOM-Only API (Standard)

**Endpoint:**
```typescript
POST /api/v1/sbom/analyze
Content-Type: application/vnd.cyclonedx+json

{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "components": [...],
  "dependencies": [...]
}
```

**Server Processing:**
1. Receive SBOM
2. Enrich with Socket data (if not already enriched)
3. Convert to CodeT5 format
4. Send to CodeT5 model
5. Return analysis

**PROS:**
- ✅ Standard format, widely supported
- ✅ Other tools can send SBOMs
- ✅ Can validate against CycloneDX schema
- ✅ Easy to debug (inspect SBOM)

**CONS:**
- ⚠️ Larger payload (~50KB)
- ⚠️ Conversion overhead on server

### Option B: CodeT5-Optimized API (Fast)

**Endpoint:**
```typescript
POST /api/v1/codet5/analyze
Content-Type: application/json

{
  "task": "security-analysis",
  "project": {
    "name": "my-app",
    "version": "1.0.0"
  },
  "criticalIssues": [...],
  "components": [...]  // Minimal data
}
```

**Server Processing:**
1. Receive pre-optimized format
2. Send directly to CodeT5 model
3. Return analysis

**PROS:**
- ✅ Small payload (~1KB)
- ✅ Fast transmission
- ✅ No conversion overhead

**CONS:**
- ❌ Non-standard format
- ❌ Tightly coupled to CodeT5
- ❌ Hard to debug (no full SBOM)
- ❌ Can't use with other tools

### Option C: Hybrid API (Recommended) ✅

**Accept both formats:**

```typescript
// Standard format for integrations
POST /api/v1/sbom/analyze
Content-Type: application/vnd.cyclonedx+json
{ "bomFormat": "CycloneDX", ... }

// Optimized format for performance
POST /api/v1/codet5/analyze
Content-Type: application/json
{ "task": "security-analysis", ... }

// Unified endpoint with auto-detection
POST /api/v1/analyze
Content-Type: application/vnd.cyclonedx+json OR application/json
{ ... }
```

**PROS:**
- ✅ Flexibility for different clients
- ✅ Standard format for integrations
- ✅ Optimized format for CLI/performance
- ✅ Future-proof

**CONS:**
- ⚠️ More endpoints to maintain

## Client-Side Flow

### Flow 1: Socket CLI (Local Analysis)

```typescript
// 1. Generate SBOM locally
const sbom = await generateSbom('./project')

// 2. Enrich with Socket API
const enriched = await enrichSbomWithSocket(sbom, { apiToken })

// 3. Format for CodeT5
const prompt = formatSbomForCodeT5(enriched, { task: 'security-analysis' })

// 4. Send optimized format to CodeT5 API (small payload)
const analysis = await fetch('/api/v1/codet5/analyze', {
  method: 'POST',
  body: JSON.stringify({ prompt, task: 'security-analysis' })
})
```

**Benefits:**
- Small API payload (1KB vs 50KB)
- Client controls optimization
- Can cache SBOM locally

### Flow 2: CI/CD Integration (Standard)

```typescript
// 1. Generate SBOM locally
const sbom = await generateSbom('./project')

// 2. Send full SBOM to API (standard format)
const result = await fetch('/api/v1/sbom/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/vnd.cyclonedx+json' },
  body: JSON.stringify(sbom)
})

// Server handles enrichment and optimization
```

**Benefits:**
- Standard format, easy to integrate
- Server handles all processing
- Can use existing SBOM tools

### Flow 3: External Tools (Standard)

```bash
# Generate SBOM with other tools
cdxgen . -o sbom.json

# Send to Socket API
curl -X POST https://api.socket.dev/v1/sbom/analyze \
  -H "Content-Type: application/vnd.cyclonedx+json" \
  -d @sbom.json
```

**Benefits:**
- Works with existing tooling
- No Socket CLI required
- Standard CycloneDX format

## Conversion Performance

### SBOM → CodeT5 Conversion

**Benchmarks:**
- Parse SBOM: ~5ms
- Prioritize components: ~2ms
- Format output: ~3ms
- **Total: ~10ms**

**Negligible overhead compared to:**
- Parsing lockfiles: ~500ms
- Socket API enrichment: ~2,000ms
- CodeT5 model inference: ~3,000ms

### Caching Strategy

```typescript
// Cache SBOM for fast regeneration
const cacheKey = `sbom:${projectPath}:${lockfileHash}`

// Check cache
let sbom = await cache.get(cacheKey)
if (!sbom) {
  sbom = await generateSbom(projectPath)
  await cache.set(cacheKey, sbom, { ttl: 3600 })
}

// Convert to CodeT5 format (fast)
const prompt = formatSbomForCodeT5(sbom, { task })
```

## Alternative Considered: Separate Generators

### Why NOT Generate Both Separately

```typescript
// ❌ BAD: Two separate parsers
const sbom = await generateSbom('./project')
const codeT5Data = await generateCodeT5Format('./project')
```

**Problems:**
1. **Duplicate parsing** - Parse lockfiles twice (expensive)
2. **Two sources of truth** - Can diverge, hard to maintain
3. **Not reusable** - CodeT5 format only works for CodeT5
4. **Maintenance burden** - Keep two parsers in sync
5. **More code** - More complexity, more bugs

## Implementation Examples

### Example 1: CLI Tool

```typescript
#!/usr/bin/env node
import { generateSbom, enrichSbomWithSocket, formatSbomForCodeT5 } from '@socketsecurity/sbom-generator'

async function main() {
  // 1. Generate SBOM
  console.log('Generating SBOM...')
  const sbom = await generateSbom(process.cwd())

  // 2. Enrich with Socket
  console.log('Enriching with Socket data...')
  const enriched = await enrichSbomWithSocket(sbom, {
    apiToken: process.env.SOCKET_API_TOKEN
  })

  // 3. Format for CodeT5
  console.log('Optimizing for CodeT5...')
  const prompt = formatSbomForCodeT5(enriched, {
    task: 'security-analysis'
  })

  // 4. Send to API (small payload)
  console.log('Sending to CodeT5 API...')
  const response = await fetch('https://api.socket.dev/v1/codet5/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, task: 'security-analysis' })
  })

  const analysis = await response.json()
  console.log(analysis)
}

main()
```

### Example 2: API Server

```typescript
import express from 'express'
import { enrichSbomWithSocket, formatSbomForCodeT5 } from '@socketsecurity/sbom-generator'

const app = express()

// Accept standard SBOM format
app.post('/api/v1/sbom/analyze', async (req, res) => {
  const sbom = req.body  // CycloneDX SBOM

  // Enrich
  const enriched = await enrichSbomWithSocket(sbom, { apiToken })

  // Convert to CodeT5 format
  const prompt = formatSbomForCodeT5(enriched, {
    task: req.query.task || 'security-analysis'
  })

  // Send to CodeT5
  const analysis = await codeT5.generate(prompt)

  res.json({ analysis })
})

// Accept pre-optimized format
app.post('/api/v1/codet5/analyze', async (req, res) => {
  const { prompt } = req.body

  // Send directly to CodeT5
  const analysis = await codeT5.generate(prompt)

  res.json({ analysis })
})
```

## Recommendation

✅ **Keep current design: SBOM as canonical format, CodeT5 as derived format**

### Implement Hybrid API:
1. **Primary endpoint**: Accept CycloneDX SBOM (standard)
2. **Optimized endpoint**: Accept CodeT5-formatted data (performance)
3. **Server-side conversion**: SBOM → CodeT5 on server (flexible)

### Benefits:
- ✅ Standard format for interoperability
- ✅ Optimized format for performance
- ✅ Single source of truth (SBOM)
- ✅ Flexible, extensible, maintainable

### Trade-offs Accepted:
- ⚠️ 10ms conversion overhead (negligible)
- ⚠️ Larger intermediate format (cacheable)

This design provides the best balance of **standardization**, **performance**, and **flexibility**.
