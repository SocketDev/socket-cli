import path from 'node:path'

export const SEA_COANA_VFS_PATHS = Object.freeze({
  analyzers: 'tools/coana/analyzers',
  cli: 'tools/coana/cli',
  cliWrapper: 'tools/coana/cli/cli-wrapper.mjs',
  manifest: 'tools/coana/manifest.json',
  node: 'tools/coana/node',
  nodeDigest: 'tools/coana/node.sha256',
  root: 'tools/coana',
})

export function seaCoanaPaths(root: string) {
  const directory = path.join(root, ...SEA_COANA_VFS_PATHS.root.split('/'))
  const fromRoot = (relative: string) => path.join(root, ...relative.split('/'))
  return {
    analyzers: fromRoot(SEA_COANA_VFS_PATHS.analyzers),
    cli: fromRoot(SEA_COANA_VFS_PATHS.cli),
    cliWrapper: fromRoot(SEA_COANA_VFS_PATHS.cliWrapper),
    manifest: fromRoot(SEA_COANA_VFS_PATHS.manifest),
    node: fromRoot(SEA_COANA_VFS_PATHS.node),
    nodeDigest: fromRoot(SEA_COANA_VFS_PATHS.nodeDigest),
    repos: path.join(fromRoot(SEA_COANA_VFS_PATHS.analyzers), 'repos'),
    root: directory,
  }
}
