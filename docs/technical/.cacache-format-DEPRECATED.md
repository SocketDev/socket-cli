# Cacache On-Disk Format

## How Cacache Actually Stores Data

Cacache uses a **two-level storage system**: index + content

## Directory Structure

```
~/.socket/_cacache/
├── index-v5/           # Key → Content mapping
│   └── 22/
│       └── 7e/
│           └── e53b1010c5d4...  # Hashed key file
├── content-v2/         # Actual content by hash
│   ├── sha256/
│   │   └── ab/
│   │       └── cd/
│   │           └── efgh...  # Content file
│   └── sha512/
│       └── 11/
│           └── 66/
│               └── aee8...  # Content file
└── tmp/                # Temporary files during writes
```

## How Keys Are Stored

### Index Files

**Keys are hashed to create file paths**:

```
Key: "socket:patch:backup:abc-123:path-hash-1"
       ↓ (hash with sha256)
Index hash: f9a050c918ad397764136710465e0b51fbde7d5f
       ↓ (split into buckets)
Path: index-v5/22/7e/e53b1010c5d44486927f573cd77cd862e9ecd5d91ce871962fd08aae7384
```

**Index file contains**: Tab-separated values
```
<content-integrity-hash>\t<JSON metadata>
```

Example index file content:
```
f9a050c918ad397764136710465e0b51fbde7d5f	{"key":"socket:patch:backup:abc-123:hash1","integrity":"sha512-EWau6B13+oGFDQ024TTT82SRfBkD8v5cKIRDGPbbGm4VRiWAUeKqGTucffEk/20OTU6+xC3z6LQfqlezjLTD6A==","time":1760458765523,"size":48,"metadata":{"originalPath":"node_modules/lodash/index.js"}}
```

JSON fields:
- `key`: The original key string
- `integrity`: ssri hash of content (points to content file)
- `time`: Timestamp when created
- `size`: Content size in bytes
- `metadata`: Custom metadata object

### Content Files

**Content is stored by its integrity hash**:

```
Integrity: "sha512-EWau6B13+oGFDQ..."
             ↓ (decode base64 to hex)
Hex: 1166aee81d77fa81850d0d36e134d3f364917c1903f2fe5c2884...
             ↓ (split into buckets: first 2 chars, next 2 chars)
Path: content-v2/sha512/11/66/aee81d77fa81850d0d36e134d3f364917c1903f2fe5c28844318f6db1a6e1546258051e2aa193b9c7df124ff6d0e4d4ebec42df3e8b41faa57b38cb4c3e8
```

**Content file contains**: Raw bytes of the original data

## Why You Can't Glob Keys

### Problem: Keys Are Hashed

Your key: `socket:patch:backup:abc-123:*`

What you want to match:
```
socket:patch:backup:abc-123:hash1
socket:patch:backup:abc-123:hash2
socket:patch:backup:abc-123:hash3
```

**But on disk**, these become:
```
index-v5/22/7e/e53b1010c5d4...  (contains key: socket:patch:backup:abc-123:hash1)
index-v5/a4/3f/91b2c83af491...  (contains key: socket:patch:backup:abc-123:hash2)
index-v5/67/d8/52e9f103bd26...  (contains key: socket:patch:backup:abc-123:hash3)
```

**The file paths are not related to the key string!**

Each key is independently hashed, so:
- `socket:patch:backup:abc-123:hash1` → random path A
- `socket:patch:backup:abc-123:hash2` → random path B
- No pattern in the paths!

### You Can't Use Filesystem Glob

```bash
# This WON'T work:
ls ~/.socket/_cacache/index-v5/socket:patch:backup:abc-123:*
# Error: No such directory

# The actual paths are:
ls ~/.socket/_cacache/index-v5/22/7e/e53b1010c5d4...
ls ~/.socket/_cacache/index-v5/a4/3f/91b2c83af491...
# No pattern relationship!
```

## How to Query Keys: cacache.ls()

Cacache provides `cacache.ls()` to list all entries:

```typescript
import cacache from 'cacache'

const allEntries = await cacache.ls('~/.socket/_cacache')

// Returns object like:
{
  "socket:patch:backup:abc-123:hash1": {
    key: "socket:patch:backup:abc-123:hash1",
    integrity: "sha512-...",
    time: 1760458765523,
    size: 12345,
    metadata: { originalPath: "..." }
  },
  "socket:patch:backup:abc-123:hash2": { ... },
  "expire-test:key1": { ... },
  "other:unrelated:key": { ... }
}
```

**To filter, you must**:
1. Read ALL index files (expensive!)
2. Parse JSON from each file
3. Filter by key pattern in memory

```typescript
// Expensive operation:
async function findKeysStartingWith(prefix: string) {
  const allEntries = await cacache.ls(cacheDir)
  return Object.entries(allEntries)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, info]) => ({ key, ...info }))
}

// For large cache with thousands of entries, this is SLOW
```

## The Core Issue: Content-Addressable Design

Cacache is designed for **content-addressable storage**, not **key-based queries**.

### It's optimized for:
✅ Get by exact key: `O(1)` - hash key, read one file
✅ Get by integrity: `O(1)` - hash integrity, read one file
✅ Deduplicate content: Same content = same hash = same file

### It's NOT optimized for:
❌ List keys by pattern: `O(n)` - must read ALL index files
❌ Delete by pattern: `O(n)` - must scan all entries
❌ Query by key prefix: `O(n)` - must read everything

## Alternative: Could We Use a Better Structure?

### Option A: Flat Key Storage (what you might expect)

```
~/.socket/_cacache/keys/
├── socket:patch:backup:abc-123:hash1
├── socket:patch:backup:abc-123:hash2
├── socket:patch:backup:abc-123:hash3
└── other:keys:here
```

**Pros**: Could glob with `socket:patch:backup:abc-123:*`
**Cons**:
- Doesn't scale (millions of files in one directory)
- Special characters in keys cause filesystem issues
- No bucketing/sharding

### Option B: Hierarchical Key Storage

```
~/.socket/_cacache/keys/
└── socket/
    └── patch/
        └── backup/
            └── abc-123/
                ├── hash1
                ├── hash2
                └── hash3
```

**Pros**: Natural hierarchy, easy to glob
**Cons**:
- Keys must follow rigid structure
- Colons, slashes in keys cause issues
- Deep directory trees (performance issues)

### Option C: Key Database (SQLite)

```sql
CREATE TABLE cacache_index (
  key TEXT PRIMARY KEY,
  integrity TEXT,
  time INTEGER,
  size INTEGER,
  metadata JSON
);

CREATE INDEX idx_key_prefix ON cacache_index(key);

-- Fast query:
SELECT * FROM cacache_index
WHERE key LIKE 'socket:patch:backup:abc-123:%';
```

**Pros**: Fast queries, real indexes, transactions
**Cons**:
- More complex
- Concurrent access requires locking
- Not the npm standard

## Why Cacache Uses Hash-Based Index

**Design goals**:
1. **Scale to millions of entries** - Hash bucketing prevents huge directories
2. **Avoid filesystem limits** - No special characters in paths
3. **Fast exact lookups** - O(1) hash to path
4. **Deduplication** - Content-addressable by design
5. **Atomic writes** - Write to temp, rename (atomic)

**Trade-off**: Pattern matching requires scanning all entries

## Solution: Maintain Your Own Index

This is why we need **metadata files**:

```typescript
// Metadata file: ~/.socket/_patches/manifests/abc-123.json
{
  "uuid": "abc-123",
  "backups": {
    "node_modules/lodash/index.js": {
      "cacheKey": "socket:patch:backup:abc-123:hash1",
      "integrity": "sha256-..."
    },
    "node_modules/lodash/package.json": {
      "cacheKey": "socket:patch:backup:abc-123:hash2",
      "integrity": "sha256-..."
    }
  }
}
```

**Now we can**:
```typescript
// O(1) - read one metadata file
const metadata = JSON.parse(fs.readFileSync(metadataPath))

// O(k) where k = number of backups for this patch
for (const [path, info] of Object.entries(metadata.backups)) {
  await cacache.get(cacheDir, info.cacheKey)
}

// Instead of O(n) where n = ALL cache entries
```

## Could We Use a Different Cache Library?

### npm's `make-fetch-happen` + `cacache`
- Industry standard
- Used by npm, pnpm, yarn, pacote
- Proven at scale
- ❌ No pattern queries

### `node-cache` or `lru-cache`
- In-memory only
- ❌ Lost on restart
- ❌ Not persistent

### `better-sqlite3`
- SQL database
- ✅ Pattern queries
- ✅ Indexes
- ⚠️ More complex than needed
- ⚠️ Not standard for package managers

### Custom filesystem structure
- Could design for glob support
- ⚠️ Reinventing the wheel
- ⚠️ Need to handle all edge cases
- ⚠️ Won't benefit from npm ecosystem

## Recommendation: Embrace Cacache Design

**Accept**: Cacache is content-addressable, not query-friendly

**Solution**: Maintain lightweight index separately
- ✅ Metadata files (one per patch)
- ✅ Small, fast to read
- ✅ Can be browsed/debugged
- ✅ No scanning required

**Total cost**:
- 1 metadata file per patch (~1KB each)
- 100 patches = 100KB of metadata
- Negligible overhead

## Summary

**Why no glob?**
- Keys are cryptographically hashed to file paths
- No relationship between key string and file path
- `socket:patch:backup:abc-123:*` → random scattered paths

**Why is this OK?**
- Cacache optimized for content-addressable storage
- We maintain our own index (metadata files)
- Index lookups are O(1), cache gets are O(1)
- Total performance: O(1) for any patch operation

**The 3-tier architecture is correct**:
1. **Metadata** (filesystem) - Query layer, one per patch
2. **Cacache index** (hashed) - Key → content mapping
3. **Cacache content** (hashed) - Deduplicated storage

Each layer does what it's best at!
