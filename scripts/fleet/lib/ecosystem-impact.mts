/*
 * @file The reachability math behind `measure-ecosystem-impact` — pure, no I/O,
 *   no network, so every rule below is unit-testable against a synthetic graph.
 *   The question the fleet actually asks is not "how popular is this package"
 *   but "if we ship a zero-dependency drop-in for it, what disappears from the
 *   install tree". Answering that needs three things, and skipping any one of
 *   them produces a confidently wrong number:
 *
 *   1. A ROOT SET. "Reachable" is meaningless without naming what it is reachable
 *      FROM. Two runs over different root sets are not comparable — re-walking
 *      every cached package instead of the original candidate set once turned
 *      `get-intrinsic` 18→12 into 31→25 and looked like a regression. Every
 *      result here carries the root set that produced it.
 *   2. A CUT SIMULATION. Overriding a package with a zero-dep drop-in deletes its
 *      OUT-edges, not the package itself — consumers still depend on it.
 *      `simulateOverrideCut` zeroes the overridden set's dependencies and
 *      recomputes reachability.
 *   3. SURVIVING GATEWAYS + CLIQUE DETECTION. A cut percentage on its own invites
 *      the wrong conclusion. Leaf-pruning eight es-abstract predicates was
 *      predicted to drive the plumbing to ~0 and delivered 29–43%, because the
 *      plumbing packages are each other's gateways: a mutually-reinforcing
 *      strongly-connected component, not a tree hanging off prunable leaves.
 *      Consumer-side overriding can never empty a clique — only overriding its
 *      members can. `findSurvivingGateways` and `findTargetCliques` make that
 *      visible in the same breath as the number.
 */

/**
 * A dependency graph: package name → the packages it directly depends on.
 * Edges point from dependent to dependency, so a walk from the roots follows
 * the same direction an installer does.
 */
export type DependencyGraph = ReadonlyMap<string, readonly string[]>

/**
 * One target's before/after reachability under a cut.
 */
export interface TargetCutResult {
  // Roots that can still reach the target after the cut.
  readonly after: number
  // Roots that could reach the target before the cut.
  readonly before: number
  // Fraction of reaching roots removed, 0–1. Zero when nothing reached it.
  readonly cutFraction: number
  // Still-live packages with a direct edge into the target, strongest first.
  readonly survivingGateways: readonly GatewayCount[]
  // True when the target sits in a multi-member cycle that survived the cut,
  // so no amount of consumer-side overriding removes it.
  readonly inSurvivingClique: boolean
  readonly target: string
}

/**
 * A still-live direct dependent of a target, with how many roots reach it.
 */
export interface GatewayCount {
  // The gateway package name.
  readonly gateway: string
  // Roots that reach this gateway after the cut — its routing weight.
  readonly reachingRoots: number
}

/**
 * The whole simulation result. `roots` is carried through deliberately: a
 * consumer that reports the cut without it hands the reader an incomparable
 * number.
 */
export interface OverrideCutReport {
  // Strongly-connected groups among the targets that survived the cut.
  readonly cliques: ReadonlyArray<readonly string[]>
  // The packages whose dependencies were zeroed.
  readonly overridden: readonly string[]
  // Packages reachable from the roots after the cut.
  readonly reachableAfter: number
  // Packages reachable from the roots before the cut.
  readonly reachableBefore: number
  // The exact root set the numbers were measured from.
  readonly roots: readonly string[]
  readonly targets: readonly TargetCutResult[]
}

/**
 * Options for `simulateOverrideCut`. Every field is optional; the defaults
 * measure the full graph with nothing overridden.
 */
export interface OverrideCutOptions {
  // How many gateways to keep per target. Default 10.
  readonly gatewayLimit?: number | undefined
  // Packages replaced by a zero-dependency drop-in — their out-edges are cut.
  readonly overridden?: readonly string[] | undefined
}

/**
 * The graph with `overridden`'s out-edges removed. A drop-in replacement still
 * occupies its slot in the tree; what it stops doing is pulling its own
 * dependencies in. Nodes are preserved so consumers of an overridden package
 * still resolve.
 */
export function cutOverriddenEdges(
  graph: DependencyGraph,
  overridden: ReadonlySet<string>,
): DependencyGraph {
  const cut = new Map<string, readonly string[]>()
  for (const [name, deps] of graph) {
    cut.set(name, overridden.has(name) ? [] : deps)
  }
  return cut
}

/**
 * Every package reachable from `roots`, roots included. Breadth-first so a
 * cyclic graph terminates.
 */
export function findReachablePackages(
  graph: DependencyGraph,
  roots: readonly string[],
): Set<string> {
  const seen = new Set<string>()
  const queue: string[] = []
  for (let i = 0, { length } = roots; i < length; i += 1) {
    const root = roots[i]!
    if (!seen.has(root)) {
      seen.add(root)
      queue.push(root)
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const deps = graph.get(queue[head]!)
    if (!deps) {
      continue
    }
    for (let i = 0, { length } = deps; i < length; i += 1) {
      const dep = deps[i]!
      if (!seen.has(dep)) {
        seen.add(dep)
        queue.push(dep)
      }
    }
  }
  return seen
}

/**
 * How many of `roots` can reach `target`, counted one root at a time. This is
 * the honest per-target metric: a single whole-graph reachability set answers
 * "is it in the tree at all", which stays `true` long after the package has
 * become a niche transitive dependency of one root.
 */
export function countRootsReaching(
  graph: DependencyGraph,
  roots: readonly string[],
  target: string,
): number {
  let count = 0
  for (let i = 0, { length } = roots; i < length; i += 1) {
    if (findReachablePackages(graph, [roots[i]!]).has(target)) {
      count += 1
    }
  }
  return count
}

/**
 * The packages that depend directly on `target`, i.e. the graph's reverse edges
 * for one node.
 */
export function findDirectDependents(
  graph: DependencyGraph,
  target: string,
): string[] {
  const dependents: string[] = []
  for (const [name, deps] of graph) {
    if (deps.includes(target)) {
      dependents.push(name)
    }
  }
  return dependents.toSorted()
}

/**
 * The still-live routes into `target` after a cut, ranked by how many roots
 * reach each one. This is the answer to "why is the cut only 30%" — a target
 * whose own siblings appear here is being kept alive by the very group the cut
 * was supposed to prune.
 */
export function findSurvivingGateways(
  graph: DependencyGraph,
  roots: readonly string[],
  target: string,
  options?: { limit?: number | undefined } | undefined,
): GatewayCount[] {
  const { limit } = { __proto__: null, ...options } as {
    limit?: number | undefined
  }
  const live = findReachablePackages(graph, roots)
  const counts: GatewayCount[] = []
  for (const gateway of findDirectDependents(graph, target)) {
    if (!live.has(gateway)) {
      continue
    }
    counts.push({
      gateway,
      reachingRoots: countRootsReaching(graph, roots, gateway),
    })
  }
  // Strongest route first; ties alphabetical so the report is deterministic.
  counts.sort(
    (a, b) =>
      b.reachingRoots - a.reachingRoots || a.gateway.localeCompare(b.gateway),
  )
  return limit === undefined ? counts : counts.slice(0, limit)
}

/**
 * The strongly-connected components of `graph`, each of size 2 or more, plus
 * any single node with a self-edge. Iterative Tarjan — a real npm graph is deep
 * enough to blow a recursive stack. A component is a group no consumer-side
 * override can break: every member is reachable from every other.
 */
export function findStronglyConnectedGroups(
  graph: DependencyGraph,
): string[][] {
  let nextIndex = 0
  const index = new Map<string, number>()
  const lowLink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const groups: string[][] = []

  for (const start of graph.keys()) {
    if (index.has(start)) {
      continue
    }
    // Each frame tracks how far through its dependency list it has walked, so
    // the traversal resumes where it left off after descending.
    const frames: Array<{ node: string; at: number }> = [{ at: 0, node: start }]
    index.set(start, nextIndex)
    lowLink.set(start, nextIndex)
    nextIndex += 1
    stack.push(start)
    onStack.add(start)

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!
      const deps = graph.get(frame.node) ?? []
      if (frame.at < deps.length) {
        const dep = deps[frame.at]!
        frame.at += 1
        if (!graph.has(dep)) {
          continue
        }
        if (!index.has(dep)) {
          index.set(dep, nextIndex)
          lowLink.set(dep, nextIndex)
          nextIndex += 1
          stack.push(dep)
          onStack.add(dep)
          frames.push({ at: 0, node: dep })
        } else if (onStack.has(dep)) {
          lowLink.set(
            frame.node,
            Math.min(lowLink.get(frame.node)!, index.get(dep)!),
          )
        }
        continue
      }
      frames.pop()
      const parent = frames[frames.length - 1]
      if (parent) {
        lowLink.set(
          parent.node,
          Math.min(lowLink.get(parent.node)!, lowLink.get(frame.node)!),
        )
      }
      if (lowLink.get(frame.node) === index.get(frame.node)) {
        const group: string[] = []
        for (;;) {
          const popped = stack.pop()!
          onStack.delete(popped)
          group.push(popped)
          if (popped === frame.node) {
            break
          }
        }
        const selfLooped =
          group.length === 1 && (graph.get(group[0]!) ?? []).includes(group[0]!)
        if (group.length > 1 || selfLooped) {
          groups.push(group.toSorted())
        }
      }
    }
  }
  return groups
}

/**
 * The strongly-connected groups that contain at least one target — the groups a
 * consumer-side override cannot dissolve. Reported so the cut percentage is
 * never read on its own.
 */
export function findTargetCliques(
  graph: DependencyGraph,
  targets: readonly string[],
): string[][] {
  const targetSet = new Set(targets)
  const cliques: string[][] = []
  for (const group of findStronglyConnectedGroups(graph)) {
    if (group.some(name => targetSet.has(name))) {
      cliques.push(group)
    }
  }
  // Widest group first so the most stubborn cluster leads the report.
  cliques.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!))
  return cliques
}

/**
 * Measure what overriding `overridden` removes, from `roots`, for each target.
 * The root set is echoed back in the report because a cut number measured from
 * a different root set is not comparable with this one.
 */
export function simulateOverrideCut(
  graph: DependencyGraph,
  roots: readonly string[],
  targets: readonly string[],
  options?: OverrideCutOptions | undefined,
): OverrideCutReport {
  const opts = { __proto__: null, ...options } as OverrideCutOptions
  const overridden = [...new Set(opts.overridden ?? [])].toSorted()
  const gatewayLimit = opts.gatewayLimit ?? 10
  const cutGraph = cutOverriddenEdges(graph, new Set(overridden))
  const liveAfter = findReachablePackages(cutGraph, roots)
  // Cliques are computed on the graph induced by what SURVIVED: a cycle whose
  // members all fell out of the tree is not a reason to keep porting.
  const survivingGraph = new Map<string, readonly string[]>()
  for (const [name, deps] of cutGraph) {
    if (liveAfter.has(name)) {
      survivingGraph.set(
        name,
        deps.filter(dep => liveAfter.has(dep)),
      )
    }
  }
  const cliques = findTargetCliques(survivingGraph, targets)
  const cliqueMembers = new Set(cliques.flat())

  const results: TargetCutResult[] = []
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
    const before = countRootsReaching(graph, roots, target)
    const after = countRootsReaching(cutGraph, roots, target)
    results.push({
      after,
      before,
      cutFraction: before === 0 ? 0 : (before - after) / before,
      inSurvivingClique: cliqueMembers.has(target),
      survivingGateways: findSurvivingGateways(cutGraph, roots, target, {
        limit: gatewayLimit,
      }),
      target,
    })
  }

  return {
    cliques,
    overridden,
    reachableAfter: liveAfter.size,
    reachableBefore: findReachablePackages(graph, roots).size,
    roots: [...roots],
    targets: results,
  }
}
