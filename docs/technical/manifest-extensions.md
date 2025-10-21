# Socket Manifest Extensions

## Current Schema

```json
{
  "patches": { ... }
}
```

## Potential Extensions

### 1. Schema Version (RECOMMENDED)

**Problem**: Need to handle schema evolution
**Solution**: Add version field

```json
{
  "version": "1.0.0",
  "patches": { ... }
}
```

**Benefits**:
- Graceful schema migration
- Backward compatibility detection
- Clear error messages for old clients

**Usage**:
```typescript
if (manifest.version !== CURRENT_VERSION) {
  await migrateManifest(manifest)
}
```

---

### 2. Overrides/Registry Configuration

**Problem**: Projects may want to force specific package versions or Socket registry packages
**Solution**: Centralized override configuration

```json
{
  "version": "1.0.0",
  "patches": { ... },
  "overrides": {
    "lodash": "npm:@socketregistry/lodash@4.17.21",
    "minimatch": "npm:@socketregistry/minimatch@9.0.5"
  }
}
```

**Benefits**:
- Team shares same override configuration
- Committed to git (reproducible builds)
- Works with npm/pnpm/yarn overrides
- Can be auto-applied by socket-cli

**Related**: This is similar to what's in socket-registry's package.json `pnpm.overrides`

---

### 3. Ignored Vulnerabilities

**Problem**: Some vulnerabilities may be false positives or not applicable
**Solution**: Document why vulnerabilities are ignored

```json
{
  "version": "1.0.0",
  "patches": { ... },
  "ignored": {
    "GHSA-xxxx-yyyy-zzzz": {
      "reason": "False positive - we don't use this code path",
      "ignoredBy": "developer@example.com",
      "ignoredAt": "2025-01-14T12:00:00Z",
      "expiresAt": "2025-04-14T12:00:00Z"
    }
  }
}
```

**Benefits**:
- Document why vulnerabilities are ignored
- Temporary ignores with expiration
- Audit trail (who/when/why)

---

### 4. Policy Configuration

**Problem**: Teams want consistent security policies
**Solution**: Store Socket policy settings

```json
{
  "version": "1.0.0",
  "patches": { ... },
  "policy": {
    "alertThreshold": "high",
    "blockOnCritical": true,
    "autoApplyPatches": false,
    "allowedLicenses": ["MIT", "Apache-2.0", "BSD-3-Clause"]
  }
}
```

**Benefits**:
- Consistent CI behavior across team
- Policy as code (versioned, reviewed)
- Override Socket API defaults per-project

---

### 5. Applied Overrides History

**Problem**: Track when overrides were applied vs. just configured
**Solution**: Record override application

```json
{
  "version": "1.0.0",
  "patches": { ... },
  "overrides": { ... },
  "appliedOverrides": {
    "npm:lodash@4.17.20": {
      "replacedWith": "npm:@socketregistry/lodash@4.17.21",
      "appliedAt": "2025-01-14T12:00:00Z",
      "reason": "Security hardening"
    }
  }
}
```

**Benefits**:
- Audit trail of package replacements
- Understand what changed and why
- Rollback information

---

### 6. Metadata / Project Info

**Problem**: Socket CLI needs project context
**Solution**: Store project metadata

```json
{
  "version": "1.0.0",
  "metadata": {
    "projectName": "my-app",
    "orgSlug": "my-company",
    "lastScanAt": "2025-01-14T12:00:00Z",
    "socketVersion": "1.1.25"
  },
  "patches": { ... }
}
```

**Benefits**:
- Remember org slug (no need to pass --org every time)
- Track when project was last scanned
- Detect if manifest created with old CLI version

---

### 7. Custom Scripts / Hooks

**Problem**: Projects may need pre/post patch actions
**Solution**: Define lifecycle hooks

```json
{
  "version": "1.0.0",
  "patches": { ... },
  "hooks": {
    "prePatch": "npm run lint",
    "postPatch": "npm test",
    "preRestore": "npm run backup",
    "postRestore": "npm install"
  }
}
```

**Benefits**:
- Run tests after patching
- Rebuild after restore
- Project-specific workflows

---

### 8. Dependencies Metadata

**Problem**: Track which dependencies have known issues
**Solution**: Document dependency status

```json
{
  "version": "1.0.0",
  "patches": { ... },
  "dependencies": {
    "npm:lodash@4.17.20": {
      "knownVulnerabilities": ["GHSA-xxxx-yyyy-zzzz"],
      "patchAvailable": true,
      "lastCheckedAt": "2025-01-14T12:00:00Z"
    }
  }
}
```

**Benefits**:
- Quick lookup of package status
- Avoid re-scanning on every run
- Show staleness (when last checked)

---

### 9. Rollback Information

**Problem**: Need to undo patches sometimes
**Solution**: Track patch history

```json
{
  "version": "1.0.0",
  "patches": { ... },
  "history": [
    {
      "action": "apply",
      "purl": "npm:lodash@4.17.20",
      "uuid": "abc-123",
      "timestamp": "2025-01-14T12:00:00Z",
      "appliedBy": "developer@example.com"
    },
    {
      "action": "remove",
      "purl": "npm:lodash@4.17.20",
      "uuid": "abc-123",
      "timestamp": "2025-01-15T09:00:00Z",
      "removedBy": "developer@example.com"
    }
  ]
}
```

**Benefits**:
- Audit trail of all patch operations
- Understand who made changes
- Debug patch issues

---

## Recommended Initial Extensions

For **Phase 1.2**, I recommend adding:

### Minimal Schema

```json
{
  "version": "1.0.0",
  "patches": { ... }
}
```

**Just add version field for future compatibility.**

### Enhanced Schema (Optional)

```json
{
  "version": "1.0.0",
  "metadata": {
    "orgSlug": "my-company",
    "createdAt": "2025-01-14T12:00:00Z",
    "updatedAt": "2025-01-14T12:00:00Z"
  },
  "patches": { ... }
}
```

**Add basic metadata for convenience.**

---

## Integration with Existing Tools

### npm/pnpm/yarn Overrides

Socket manifest could **generate** package manager configs:

```bash
# Read .socket/manifest.json overrides
socket sync overrides

# Generates pnpm-lock.yaml overrides section
# Generates package.json pnpm.overrides
# Generates .yarnrc.yml resolutions
```

### Socket Registry Integration

Projects using socket-registry could share override preferences:

```json
{
  "version": "1.0.0",
  "patches": { ... },
  "registry": {
    "prefer": "socket",
    "packages": {
      "lodash": "@socketregistry/lodash",
      "minimatch": "@socketregistry/minimatch"
    }
  }
}
```

---

## What Should NOT Go in Manifest

❌ **Developer-specific settings**
- Local file paths
- Personal API tokens
- Editor preferences

→ These go in `~/.socketrc` or environment variables

❌ **Large binary data**
- Patch tarballs
- Backup files
- Build artifacts

→ These go in cacache or ignored directories

❌ **Transient state**
- Current download progress
- Temporary locks
- Cache timestamps

→ These go in memory or temp files

❌ **Sensitive information**
- API keys
- Credentials
- Private URLs

→ These go in `.env` or secrets management

---

## Decision Framework

**Should this go in manifest?**

Questions to ask:
1. ✅ Should this be committed to git?
2. ✅ Should the whole team see it?
3. ✅ Is it project-specific (not developer-specific)?
4. ✅ Does it affect reproducible builds?
5. ✅ Is it human-readable JSON?

If all "yes" → Consider adding to manifest

---

## Example: Full Featured Manifest

```json
{
  "version": "1.0.0",
  "metadata": {
    "projectName": "my-app",
    "orgSlug": "my-company",
    "createdAt": "2025-01-14T12:00:00Z",
    "updatedAt": "2025-01-14T14:30:00Z"
  },
  "patches": {
    "npm:lodash@4.17.20": {
      "uuid": "abc-123",
      "exportedAt": "2025-01-14T12:00:00Z",
      "files": { ... },
      "vulnerabilities": { ... },
      "description": "Fixes command injection",
      "license": "MIT",
      "tier": "free"
    }
  },
  "overrides": {
    "minimatch": "npm:@socketregistry/minimatch@9.0.5"
  },
  "ignored": {
    "GHSA-false-positive-123": {
      "reason": "Not applicable to our use case",
      "ignoredBy": "security-team@example.com",
      "ignoredAt": "2025-01-14T12:00:00Z",
      "expiresAt": "2025-04-14T12:00:00Z"
    }
  },
  "policy": {
    "alertThreshold": "high",
    "blockOnCritical": true
  }
}
```

---

## My Recommendation

**Start simple, extend later:**

### Phase 1.2 (Now)
```json
{
  "version": "1.0.0",
  "patches": { ... }
}
```

### Phase 2 (Soon)
```json
{
  "version": "1.0.0",
  "metadata": {
    "orgSlug": "...",
    "updatedAt": "..."
  },
  "patches": { ... }
}
```

### Phase 3 (Future)
```json
{
  "version": "1.0.0",
  "metadata": { ... },
  "patches": { ... },
  "overrides": { ... },
  "ignored": { ... }
}
```

**Rationale**:
- Version field enables future extensions
- Add features as they're needed
- Keep manifest focused on patches initially

---

## Implementation Note

Use **optional fields** with Zod:

```typescript
export const PatchManifestSchema = z.object({
  version: z.string().default("1.0.0"),
  metadata: z.object({
    orgSlug: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }).optional(),
  patches: z.record(z.string(), PatchRecordSchema),
  overrides: z.record(z.string(), z.string()).optional(),
  ignored: z.record(z.string(), IgnoredVulnerabilitySchema).optional(),
})
```

This allows:
- Old manifests still valid (no version field)
- New features opt-in (optional)
- Graceful degradation
