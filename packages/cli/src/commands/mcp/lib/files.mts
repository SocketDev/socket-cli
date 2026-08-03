/**
 * Package file-manifest reads and tree rendering for the `package_files` tool.
 *
 * The API response is treated as untrusted input: every entry is re-derived
 * field by field, non-string paths are dropped, and paths are normalized before
 * they are split on `/` so a Windows-style separator cannot produce a bogus
 * tree node.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { fetchSocketPackageFileList } from './socket-api.mts'

export interface FileListEntry {
  hash?: string | undefined
  path: string
  size?: number | undefined
  type: 'dir' | 'file'
}

export interface FileListResult {
  fileCount: number
  files: FileListEntry[]
  purl: string
  totalBytes: number
  tree: string
}

export interface TreeNode {
  children: Map<string, TreeNode>
  hash?: string | undefined
  isFile: boolean
  name: string
  size?: number | undefined
}

export function buildFileTree(entries: FileListEntry[]): TreeNode {
  const root: TreeNode = { children: new Map(), isFile: false, name: '' }
  for (let e = 0, { length } = entries; e < length; e += 1) {
    const entry = entries[e]!
    const parts = normalizePath(entry.path).split('/').filter(Boolean)
    if (!parts.length) {
      continue
    }
    let cur = root
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!
      let next = cur.children.get(part)
      if (!next) {
        next = { children: new Map(), isFile: false, name: part }
        cur.children.set(part, next)
      }
      const isLeaf = i === parts.length - 1
      if (isLeaf && entry.type === 'file') {
        next.isFile = true
        if (entry.size !== undefined) {
          next.size = entry.size
        }
        if (entry.hash !== undefined) {
          next.hash = entry.hash
        }
      }
      cur = next
    }
  }
  return root
}

/**
 * Re-derive the `files` array from a raw API response into a sorted, typed
 * list. Entries without a usable string path are dropped; hashes are omitted
 * unless asked for.
 */
export function extractSocketFileList(
  response: unknown,
  options?: { includeHashes?: boolean | undefined } | undefined,
): FileListEntry[] {
  const opts = { __proto__: null, ...options } as {
    includeHashes?: boolean | undefined
  }
  const raw =
    typeof response === 'object' &&
    response !== null &&
    'files' in response &&
    Array.isArray(response.files)
      ? response.files
      : []
  const entries: FileListEntry[] = []
  for (let i = 0, { length } = raw; i < length; i += 1) {
    const item: unknown = raw[i]
    if (typeof item !== 'object' || item === null || !('path' in item)) {
      continue
    }
    const { path } = item
    if (typeof path !== 'string' || !path) {
      continue
    }
    const rawType = 'type' in item ? item.type : undefined
    const entry: FileListEntry = {
      path,
      type: rawType === 'dir' ? 'dir' : 'file',
    }
    const rawSize = 'size' in item ? item.size : undefined
    if (typeof rawSize === 'number') {
      entry.size = rawSize
    }
    const rawHash = 'hash' in item ? item.hash : undefined
    if (opts.includeHashes && typeof rawHash === 'string') {
      entry.hash = rawHash
    }
    entries.push(entry)
  }
  entries.sort((a, b) => a.path.localeCompare(b.path))
  return entries
}

/**
 * Fetch the file manifest for a PURL and render it as a tree.
 */
export async function fetchSocketFileList(
  apiToken: string,
  purl: string,
): Promise<FileListResult> {
  const data = await fetchSocketPackageFileList(apiToken, purl)
  const files = extractSocketFileList(data, { includeHashes: true })
  const fileEntries = files.filter(f => f.type === 'file')
  const totalBytes = fileEntries.reduce((sum, f) => sum + (f.size ?? 0), 0)
  const tree = renderFileTree(files, { showHash: true, showSize: true })

  return {
    fileCount: fileEntries.length,
    files,
    purl,
    totalBytes,
    tree,
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}K`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

/**
 * Render sorted entries as an indented tree. Directories sort before files;
 * siblings sort alphabetically. Files carry size and, optionally, their blob
 * hash inline — that hash is what `package_file_contents` takes.
 */
export function renderFileTree(
  entries: FileListEntry[],
  options?:
    | { showHash?: boolean | undefined; showSize?: boolean | undefined }
    | undefined,
): string {
  const opts = { __proto__: null, ...options } as {
    showHash?: boolean | undefined
    showSize?: boolean | undefined
  }
  const showSize = opts.showSize !== false
  const showHash = opts.showHash === true
  const root = buildFileTree(entries)
  const lines: string[] = []

  const walk = (node: TreeNode, prefix: string): void => {
    const kids = Array.from(node.children.values()).toSorted((a, b) => {
      if (a.isFile !== b.isFile) {
        return a.isFile ? 1 : -1
      }
      return a.name.localeCompare(b.name)
    })
    for (let i = 0; i < kids.length; i += 1) {
      const kid = kids[i]!
      const last = i === kids.length - 1
      const branch = last ? '└── ' : '├── '
      const cont = last ? '    ' : '│   '
      let line = prefix + branch + kid.name
      if (kid.isFile) {
        const meta: string[] = []
        if (showSize && kid.size !== undefined) {
          meta.push(formatFileSize(kid.size))
        }
        if (showHash && kid.hash) {
          meta.push(kid.hash)
        }
        if (meta.length) {
          line += `  ${meta.join('  ')}`
        }
      } else {
        line += '/'
      }
      lines.push(line)
      // A degenerate listing can name one path as both a file and a parent
      // (`a` and `a/b`); walk the children anyway so no leaf is dropped.
      if (kid.children.size > 0) {
        walk(kid, prefix + cont)
      }
    }
  }

  walk(root, '')
  return lines.join('\n')
}
