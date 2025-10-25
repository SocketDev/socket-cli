# SBOM Generator - Ecosystem Support

Based on **depscan** ecosystem definitions from `/workspaces/lib/dist/ecosystems/`.

## Complete Ecosystem List

| Ecosystem | Display Name | Registry | PURL Type | Parse Strategy | Priority |
|-----------|--------------|----------|-----------|----------------|----------|
| **npm** | npm | npmjs.org | npm | Parse lockfiles | ✅ Tier 1 |
| **pypi** | PyPI | pypi.org | pypi | Parse lockfiles | ⏳ Tier 2 |
| **cargo** | Cargo | crates.io | cargo | Parse Cargo.lock | ⏳ Tier 2 |
| **go** | Go | proxy.golang.org | golang | Parse go.mod/go.sum | ⏳ Tier 2 |
| **maven** | Maven | repo1.maven.org | maven | Parse pom.xml OR convert gradle | ⏳ Tier 2 |
| **rubygems** | Rubygems | rubygems.org | gem | Parse Gemfile.lock | ⏳ Tier 2 |
| **nuget** | NuGet | nuget.org | nuget | Parse .csproj/packages.config | ⏳ Tier 2 |
| **actions** | GitHub Actions | github.com | github | Parse workflow YAML | ⏳ Tier 3 |
| **huggingface** | Hugging Face | huggingface.co | huggingface | API-based | ⏳ Tier 3 |
| **chrome** | Chrome | chromewebstore.google.com | chrome | API-based | ⏳ Tier 3 |
| **openvsx** | OpenVSX | open-vsx.org | vscode | API-based | ⏳ Tier 3 |

**Note on Gradle**: Gradle is a **build tool**, not a separate ecosystem. Gradle projects publish to Maven repositories (repo1.maven.org), so they use the **maven** ecosystem. Socket-CLI already has gradle-to-maven conversion built-in (`socket manifest gradle`).

## Implementation Strategy

### Tier 1 - Implemented (1/11)
- ✅ **npm** - Full support for package-lock.json, yarn.lock, pnpm-lock.yaml

### Tier 2 - High Priority (6/11)
Parse-first strategy for all traditional package managers:

1. **pypi** (Python)
   - **Files**: requirements.txt, Pipfile.lock, poetry.lock
   - **Parser**: TOML (@iarna/toml), JSON
   - **Priority**: High (2nd most common after npm)

2. **cargo** (Rust)
   - **Files**: Cargo.toml, Cargo.lock
   - **Parser**: TOML (@iarna/toml)
   - **Priority**: High (growing ecosystem)

3. **go** (Go)
   - **Files**: go.mod, go.sum
   - **Parser**: Custom text format
   - **Priority**: High (enterprise usage)

4. **maven** (Java/JVM)
   - **Files**: pom.xml, build.gradle, build.gradle.kts
   - **Parser**: XML (fast-xml-parser) for pom.xml, gradle conversion for gradle files
   - **Priority**: High (enterprise usage)
   - **Note**: Gradle is a build tool that publishes to Maven repositories. Socket-CLI already has gradle support that converts to pom.xml format

5. **rubygems** (Ruby)
   - **Files**: Gemfile.lock
   - **Parser**: Custom text format
   - **Priority**: Medium

6. **nuget** (.NET)
   - **Files**: packages.config, .csproj
   - **Parser**: XML (fast-xml-parser)
   - **Priority**: Medium (enterprise usage)

### Tier 3 - Additional Ecosystems (4/11)
API-based or special-case ecosystems:

1. **actions** (GitHub Actions)
   - **Files**: .github/workflows/*.yml
   - **Parser**: YAML
   - **Priority**: Low (workflows, not traditional packages)

2. **huggingface** (ML Models)
   - **Strategy**: API-based (huggingface.co API)
   - **Priority**: Low (specialized use case)

3. **chrome** (Browser Extensions)
   - **Strategy**: API-based (Chrome Web Store API)
   - **Priority**: Low (specialized use case)

4. **openvsx** (VS Code Extensions)
   - **Strategy**: API-based (open-vsx.org API)
   - **Priority**: Low (specialized use case)

## Lockfile Formats by Ecosystem

### Text-Based (Custom Parsers)
- **npm/yarn**: yarn.lock (custom format via @yarnpkg/parsers)
- **go**: go.mod, go.sum (simple key-value text)
- **rubygems**: Gemfile.lock (custom Ruby-specific format)

### JSON
- **npm**: package-lock.json
- **pypi**: Pipfile.lock

### YAML
- **npm/pnpm**: pnpm-lock.yaml
- **actions**: workflow files (.github/workflows/*.yml)

### TOML
- **pypi**: poetry.lock
- **cargo**: Cargo.lock

### XML
- **maven**: pom.xml
- **nuget**: packages.config, .csproj

### API-Based (No Lockfiles)
- **huggingface**: Models/datasets via huggingface.co API
- **chrome**: Extensions via Chrome Web Store API
- **openvsx**: Extensions via open-vsx.org API

## Feature Matrix

Based on depscan's feature flags:

| Ecosystem | Alerts | AI Summary | Dependencies | Search | Scores | Show in Footer |
|-----------|--------|------------|--------------|--------|--------|----------------|
| npm | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| pypi | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| cargo | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| go | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| maven | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| rubygems | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| nuget | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| actions | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| huggingface | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| chrome | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| openvsx | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |

**Key Insights**:
- All ecosystems support alerts and search
- npm and cargo get AI summaries (highest priority ecosystems)
- Most ecosystems support dependency tracking
- Chrome has minimal feature support (extensions are simpler)

## Socket.dev Priority

Based on depscan features and ecosystem importance:

### Must-Have (Tier 1)
1. **npm** ✅ - Implemented
   - Most popular JavaScript ecosystem
   - Full feature support including AI summaries

### Should-Have (Tier 2)
2. **pypi** - Python packages
   - 2nd largest ecosystem
   - Critical for ML/data science

3. **cargo** - Rust crates
   - AI summary support
   - Growing security-conscious community

4. **go** - Go modules
   - Enterprise adoption
   - Security-focused language

5. **maven** - Java/JVM packages
   - Enterprise dominance
   - Large existing codebase

### Nice-to-Have (Tier 2-3)
6. **rubygems** - Ruby gems
7. **nuget** - .NET packages

### Future Consideration (Tier 3)
8. **actions** - GitHub Actions
9. **huggingface** - ML models
10. **chrome** - Browser extensions
11. **openvsx** - VS Code extensions

## Implementation Roadmap

### Phase 1 (Weeks 1-2) ✅ COMPLETE
- ✅ npm parser with full lockfile support
- ✅ Socket enrichment integration
- ✅ CodeT5 formatter

### Phase 2 (Weeks 3-4)
- ⏳ pypi parser (requirements.txt, Pipfile.lock, poetry.lock)
- ⏳ cargo parser (Cargo.toml, Cargo.lock)

### Phase 3 (Weeks 5-6)
- ⏳ go parser (go.mod, go.sum)
- ⏳ maven parser (pom.xml)

### Phase 4 (Weeks 7-8)
- ⏳ rubygems parser (Gemfile.lock)
- ⏳ nuget parser (packages.config, .csproj)

### Phase 5 (Future)
- ⏳ actions parser (workflow YAML)
- ⏳ API-based parsers (huggingface, chrome, openvsx)

## Dependencies Required

### Currently Used
- ✅ `@yarnpkg/parsers` - Parse yarn.lock
- ✅ `@iarna/toml` - Parse TOML (cargo, pypi)
- ✅ `fast-xml-parser` - Parse XML (maven, nuget)
- ✅ `yaml` - Parse YAML (pnpm, actions)

### Future Needs
- ⏳ Custom go.mod/go.sum parser (simple text format)
- ⏳ Custom Gemfile.lock parser (Ruby-specific format)
- ⏳ API clients for huggingface, chrome, openvsx

## References

- **depscan ecosystem types**: `/workspaces/lib/dist/ecosystems/types.d.ts`
- **depscan ecosystem constants**: `/workspaces/lib/dist/ecosystems/constants.d.ts`
- **CycloneDX spec**: https://cyclonedx.org/docs/1.5/json/
- **Package URL (PURL) spec**: https://github.com/package-url/purl-spec
