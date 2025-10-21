# Why We Need Metadata Files (Not Just Cacache)

## The Question

**Why can't we just glob cacache keys like `socket:patch:backup:abc-123:*` to find all backups for a patch?**

## The Answer: Keys Are Cryptographically Hashed

### What You Might Expect (But Doesn't Happen)

```
~/.socket/_cacache/keys/
├── socket:patch:backup:abc-123:hash1
├── socket:patch:backup:abc-123:hash2
├── socket:patch:backup:abc-123:hash3
└── socket:patch:backup:xyz-789:hash1
```

Then you could: `ls ~/.socket/_cacache/keys/socket:patch:backup:abc-123:*`

### What Actually Happens

Cacache **hashes each key** to create a file path:

```
Key: "socket:patch:backup:abc-123:hash1"
     ↓ SHA-256 hash
     "f9a050c918ad397764136710465e0b51fbde7d5f"
     ↓ Bucket by first 4 chars
Path: index-v5/f9/a0/50c918ad397764136710465e0b51fbde7d5f
```

```
Key: "socket:patch:backup:abc-123:hash2"
     ↓ SHA-256 hash (COMPLETELY DIFFERENT)
     "a43f91b2c83af49176d8e9f103bd2652"
     ↓ Bucket by first 4 chars
Path: index-v5/a4/3f/91b2c83af49176d8e9f103bd2652
```

**Result**: Keys with similar strings produce completely unrelated file paths!

### Actual Disk Structure

```
~/.socket/_cacache/
├── index-v5/
│   ├── f9/a0/50c918ad...  ← contains key "socket:patch:backup:abc-123:hash1"
│   ├── a4/3f/91b2c83a...  ← contains key "socket:patch:backup:abc-123:hash2"
│   ├── 7e/22/e53b1010...  ← contains key "socket:patch:backup:abc-123:hash3"
│   └── d6/18/92f5b24c...  ← contains key "socket:patch:backup:xyz-789:hash1"
└── content-v2/
    └── sha256/...
```

**You cannot glob these paths!** They're random with respect to the key string.

## Why Cacache Does This

### Design Goals:
1. **Scale to millions of entries** - Hash bucketing prevents huge directories
2. **Handle special characters** - Keys can have `/`, `:`, `?`, etc. - filesystem unsafe
3. **O(1) lookups** - Hash key → file path directly
4. **Atomic operations** - Write to temp, rename (filesystem atomic operation)
5. **Deduplication** - Content stored by hash, not by key

### Trade-off:
- ✅ Fast exact key lookup: `O(1)`
- ❌ Pattern matching: `O(n)` - must scan all entries

## How to Find Keys: cacache.ls()

Cacache provides `cacache.ls()` but it's **expensive**:

```typescript
import cacache from 'cacache'

// This reads EVERY index file in the cache!
const allEntries = await cacache.ls('~/.socket/_cacache')
// Returns: { "key1": {...}, "key2": {...}, ... "keyN": {...} }

// Filter in memory
const matchingKeys = Object.keys(allEntries)
  .filter(key => key.startsWith('socket:patch:backup:abc-123:'))

// For a cache with 10,000 entries, this reads 10,000 index files
// Just to find 3 keys for one patch!
```

**Performance**:
- 100 cache entries → Read 100 files to find 3 matches
- 1,000 cache entries → Read 1,000 files to find 3 matches
- 10,000 cache entries → Read 10,000 files to find 3 matches

**This is O(n) where n = total cache size!**

## Solution: Metadata Files

Store a **small index file per patch**:

### Metadata File: `~/.socket/_patches/manifests/abc-123.json`

```json
{
  "uuid": "abc-123",
  "appliedAt": "2025-01-14T12:00:00Z",
  "files": {
    "node_modules/lodash/index.js": {
      "integrity": "sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=",
      "size": 12345
    },
    "node_modules/lodash/package.json": {
      "integrity": "sha256-abc123...",
      "size": 678
    }
  }
}
```

### Operations Now:

**List backups for patch**:
```typescript
// O(1) - Read one small JSON file
const metadata = JSON.parse(
  await fs.readFile(`~/.socket/_patches/manifests/${uuid}.json`)
)
const filePaths = Object.keys(metadata.files)
// Result: ["node_modules/lodash/index.js", "node_modules/lodash/package.json"]
```

**Restore all backups**:
```typescript
// O(k) where k = files in this patch (not total cache size!)
for (const [path, info] of Object.entries(metadata.files)) {
  const key = `socket:patch:backup:${uuid}:${hashPath(path)}`
  const entry = await cacache.get(cacheDir, key, {
    integrity: info.integrity // Verify on retrieval
  })
  await fs.writeFile(path, entry.data)
}
```

**Cleanup patch**:
```typescript
// O(k) - Only delete this patch's entries
for (const path of Object.keys(metadata.files)) {
  await cacache.rm.entry(cacheDir, `socket:patch:backup:${uuid}:${hashPath(path)}`)
}
await fs.unlink(`~/.socket/_patches/manifests/${uuid}.json`)
```

## Comparison

| Operation | Without Metadata | With Metadata |
|-----------|------------------|---------------|
| List files for patch | O(n) - scan entire cache | O(1) - read one JSON file |
| Restore patch | O(n) - scan to find keys | O(k) - k = files in patch |
| Cleanup patch | O(n) - scan to find keys | O(k) - k = files in patch |
| Storage overhead | 0 bytes | ~1KB per patch |

**Example**: Cache with 10,000 entries, restoring patch with 3 files:
- Without metadata: Read 10,000 index files
- With metadata: Read 1 JSON file + 3 cache entries

## Additional Benefits of Metadata Files

1. **Human-readable**: `cat ~/.socket/_patches/manifests/abc-123.json`
2. **Debuggable**: Easy to inspect what's backed up
3. **Browsable**: `ls ~/.socket/_patches/manifests/` shows all patches
4. **Grep-able**: `grep "lodash" ~/.socket/_patches/manifests/*.json`
5. **No race conditions**: Each patch has its own file
6. **Backup-friendly**: Small files, easy to sync/backup

## Could We Use a Different Cacache Structure?

### Option: Store metadata in cacache itself

```typescript
// Metadata as cacache entry
await cacache.put(cacheDir, `socket:patch:meta:${uuid}`, JSON.stringify(metadata))
```

**Still can't glob!** Same problem:
- `socket:patch:meta:abc-123` → hashed to random path
- `socket:patch:meta:xyz-789` → hashed to different random path
- Still need to scan entire cache to find all metadata entries

### Option: Use SQLite for index

```sql
CREATE TABLE patch_metadata (
  uuid TEXT PRIMARY KEY,
  metadata JSON
);
```

**Pros**: Fast queries, proper indexes
**Cons**:
- More complex (need to manage database)
- Concurrent access requires locking
- Not the npm ecosystem standard
- Overkill for simple lookup table

## Conclusion

### Why 3 Storage Types:

1. **Metadata** (filesystem JSON):
   - Small index files (~1KB each)
   - Fast O(1) lookups by UUID
   - Human-readable and debuggable
   - One file per patch

2. **Cacache index** (hashed):
   - Key → content integrity mapping
   - Handled automatically by cacache
   - Optimized for exact key lookups

3. **Cacache content** (hashed by integrity):
   - Actual file contents
   - Deduplicated automatically
   - Integrity verified on retrieval

### The Architecture Makes Sense:

✅ **Metadata** = Query layer (what we want to find)
✅ **Cacache** = Storage layer (where content lives)

**Total cost**: ~1KB per patch for metadata
**Performance gain**: O(n) → O(1) for all patch operations

This is the standard pattern used throughout the npm ecosystem!
