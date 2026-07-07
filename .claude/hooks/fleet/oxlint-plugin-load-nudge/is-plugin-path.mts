// Pure predicate, split out of index.mts so the test can import it WITHOUT
// importing index.mts — index.mts runs `await withEditGuard` at module scope
// (it reads stdin on import), which hangs the node:test runner. A reminder/
// guard test must never self-import an index that runs its guard at top level;
// import the pure helpers from a sibling module like this one instead.
export function isPluginPath(filePath: string): boolean {
  return filePath.includes('.config/fleet/oxlint-plugin/')
}
