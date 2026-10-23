package tech.coana.socket;

import org.apache.maven.RepositoryUtils;
import org.apache.maven.execution.MavenSession;
import org.apache.maven.model.Resource;
import org.apache.maven.project.DefaultDependencyResolutionRequest;
import org.apache.maven.project.DependencyResolutionException;
import org.apache.maven.project.DependencyResolutionRequest;
import org.apache.maven.project.DependencyResolutionResult;
import org.apache.maven.project.MavenProject;
import org.apache.maven.project.ProjectDependenciesResolver;
import org.eclipse.aether.RepositorySystem;
import org.eclipse.aether.RequestTrace;
import org.eclipse.aether.artifact.Artifact;
import org.eclipse.aether.graph.Dependency;
import org.eclipse.aether.graph.DependencyFilter;
import org.eclipse.aether.graph.DependencyNode;
import org.eclipse.aether.resolution.ArtifactDescriptorException;
import org.eclipse.aether.resolution.ArtifactDescriptorRequest;
import org.eclipse.aether.resolution.ArtifactResult;
import org.eclipse.aether.resolution.DependencyRequest;
import org.eclipse.aether.resolution.VersionRangeRequest;
import org.eclipse.aether.resolution.VersionRangeResolutionException;
import org.slf4j.Logger;

import java.io.File;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * Emits each reactor module's resolved dependency graph as line-protocol records for the TS assembler
 * (same contract as the Gradle/SBT scripts; no JSON/hashing here). Per module: a prod root
 * (compile/runtime/system) and a dev root (test/provided). A reactor module becomes a component only
 * where another depends on it, by its bare {@code groupId:artifactId:version} id.
 *
 * <p>Resolution goes through {@link ProjectDependenciesResolver} — the same component Maven's own
 * lifecycle uses to build a project's classpath — so the graph, the scope and management semantics,
 * the per-node repository lists and the reactor substitution are Maven's, not an approximation of
 * them. Resolving a dependency against only its root module's repositories, as a hand-rolled walk
 * does, loses the repositories a dependency's own POM contributes and then cannot see artifacts
 * cached from them (Aether's local repository tracks each file's origin repository).
 */
public final class SocketFactsRecordsEngine {

  public static final class Options {
    public boolean withFiles;
    public String populateFilesFor;
    public String includeConfigs;
    public String excludeConfigs;
    // Scan-root-relative `--exclude-paths` (CSV): a wholly excluded reactor module is skipped.
    public String excludePaths;
    public String recordsFile;
  }

  private static final List<String> ALL_SCOPES =
      Arrays.asList("compile", "provided", "runtime", "system", "test");

  // Aether's ArtifactProperties.TYPE: Maven's `type` (jar, test-jar, ...) as opposed to the file
  // extension, carried as an artifact property once a Maven dependency becomes an Aether one.
  private static final String ARTIFACT_PROPERTY_TYPE = "type";
  // ConflictResolver.NODE_DATA_WINNER, inlined so nothing here needs maven-resolver-util.
  private static final String NODE_DATA_CONFLICT_WINNER = "conflict.winner";

  private final ProjectDependenciesResolver dependenciesResolver;
  private final RepositorySystem repositorySystem;
  private final String mavenVersion;
  private final CollectionObserver observer;
  private final Logger log;
  // Maven 3.2's collector (aether 1.0.0) leaves a dependency whose POM failed out of the graph; from
  // aether 1.0.2 (Maven 3.3) on it stays, minus its children.
  private final boolean collectorDropsFailedNodes;
  // The resolver caches a failed POM build-wide, keyed by artifact alone, so only the first module to
  // reach one sees the failure; every later module gets the node without children and no error.
  // Keyed by GAV.
  private final Map<String, FailedRequest> brokenDescriptors = new LinkedHashMap<>();

  public SocketFactsRecordsEngine(
      ProjectDependenciesResolver dependenciesResolver, RepositorySystem repositorySystem, String mavenVersion,
      CollectionObserver observer, Logger log) {
    this.dependenciesResolver = dependenciesResolver;
    this.repositorySystem = repositorySystem;
    this.mavenVersion = mavenVersion;
    this.observer = observer;
    this.log = log;
    this.collectorDropsFailedNodes = mavenVersion != null && mavenVersion.startsWith("3.2.");
  }

  public void run(MavenSession session, List<MavenProject> reactor, File rootDir, Options opts)
      throws IOException {
    Set<String> passingScopes = computePassingScopes(opts.includeConfigs, opts.excludeConfigs);
    // GAVs to materialize under --with-files (null = all). Scopes artifact downloads so reachability
    // doesn't fetch the whole dependency universe. Module src/tgt dirs are emitted regardless (no download).
    Set<String> populateGavs = readPopulateGavs(opts);
    // reactorGavs stays complete (all modules) so a KEPT module depending on an excluded one still
    // recognizes it as internal; `excludes` only gates resolution + the project record.
    Set<String> reactorGavs = new HashSet<>();
    for (MavenProject p : reactor) {
      reactorGavs.add(p.getGroupId() + ":" + p.getArtifactId() + ":" + p.getVersion());
    }
    List<Pattern> excludes = SocketSupport.parseExcludePatterns(opts.excludePaths);

    List<String> lines = new ArrayList<>();
    rec(lines, "meta", "maven", mavenVersion, System.getProperty("java.version"));
    rec(lines, "buildRoot", rootDir.getAbsolutePath());
    // The POM Maven was invoked on (`-f`, else the default it located), which names the facts file.
    File entryPom = session.getRequest().getPom();
    if (entryPom != null) rec(lines, "entry", SocketSupport.relativePath(rootDir.toPath(), entryPom.getAbsoluteFile().toPath()));

    for (MavenProject module : reactor) {
      // No basedir: Maven's stand-in project for a directory without a POM. Skipping it lets Maven's
      // own "no POM in this directory" error surface instead of an NPE.
      if (module.getBasedir() == null) continue;
      String ws = SocketSupport.workspace(rootDir.toPath(), module.getBasedir().toPath());
      String key = projectKey(module);
      boolean excluded = SocketSupport.isExcludedPath(ws, excludes);
      if (excluded) {
        // Not analysed on its own, but a kept module depending on it is analysed with its code.
        if (opts.withFiles) rec(lines, "excludedProject", key);
      } else {
        rec(lines, "project", key, module.getGroupId(), module.getArtifactId(), module.getVersion(), ws);
        File pom = module.getFile();
        if (pom != null && pom.isFile()) rec(lines, "projectBuild", key, SocketSupport.relativePath(rootDir.toPath(), pom.toPath()));
      }
      if (opts.withFiles) {
        for (String s : collectSources(module)) rec(lines, "projectSrc", key, s);
        for (String t : collectTargets(module)) rec(lines, "projectTgt", key, t);
      }
    }

    for (String scope : passingScopes) rec(lines, "scanned", scope);

    Set<Failure> failures = new LinkedHashSet<>();
    Set<Unscannable> unscannable = new LinkedHashSet<>();
    int rootIdx = 0;
    for (MavenProject module : reactor) {
      if (module.getBasedir() == null) continue;
      String ws = SocketSupport.workspace(rootDir.toPath(), module.getBasedir().toPath());
      // A wholly excluded reactor module is not resolved (matches the project-record skip above).
      if (SocketSupport.isExcludedPath(ws, excludes)) continue;
      Map<String, Node> nodes = new LinkedHashMap<>();
      Set<String> directIds = new HashSet<>();
      // Which direct dependencies are prod-scoped: seeds the prod/dev root split (see emitModuleRoots).
      Set<String> directProdIds = new HashSet<>();
      collectModule(session, module, passingScopes, reactorGavs, populateGavs, opts, nodes, directIds, directProdIds, failures, unscannable);
      rootIdx = emitModuleRoots(lines, rootIdx, projectKey(module), nodes, directIds, directProdIds);
    }

    for (Failure f : failures) rec(lines, "failure", f.coord, f.detail, f.config, f.project);
    for (Unscannable u : unscannable) rec(lines, "unscannable", "", u.detail, u.project);

    write(opts.recordsFile, lines);
  }

  // Not the directory, which `<module>x/a.xml</module>` and `<module>x/b.xml</module>` share; Maven
  // rejects a reactor with a duplicate GAV. Surfaces as the facts project id.
  private static String projectKey(MavenProject module) {
    return module.getGroupId() + ":" + module.getArtifactId() + ":" + module.getVersion();
  }

  // ---- resolution ----

  private void collectModule(
      MavenSession session,
      MavenProject module,
      Set<String> passingScopes,
      Set<String> reactorGavs,
      Set<String> populateGavs,
      Options opts,
      Map<String, Node> nodes,
      Set<String> directIds,
      Set<String> directProdIds,
      Set<Failure> failures,
      Set<Unscannable> unscannable) {
    String moduleCoord = module.getGroupId() + ":" + module.getArtifactId() + ":" + module.getVersion();
    DependencyResolutionResult result;
    DependencyResolutionException thrown = null;
    DependencyFilter resolutionFilter = materializationFilter(opts, passingScopes, reactorGavs, populateGavs);
    observer.reset();
    try {
      DependencyResolutionRequest request =
          new DefaultDependencyResolutionRequest(module, session.getRepositorySession());
      request.setResolutionFilter(resolutionFilter);
      result = dependenciesResolver.resolve(request);
    } catch (DependencyResolutionException e) {
      // Maven attaches the partial result — graph plus per-dependency errors — to the exception, so
      // one unresolvable artifact still yields a complete graph and a precise failure record.
      thrown = e;
      result = e.getResult();
      if (result == null) {
        unscannable.add(new Unscannable(rootMessage(e), moduleCoord));
        log.warn("[socket-facts] could not resolve dependencies for " + moduleCoord + ": " + rootMessage(e));
        return;
      }
    }
    boolean reported = false;
    DependencyNode graph = result.getDependencyGraph();
    List<FailedRequest> collectionFailures = new ArrayList<>();
    for (Exception e : result.getCollectionErrors()) {
      FailedRequest failed = failedRequest(e);
      if (failed == null) {
        unscannable.add(new Unscannable(rootMessage(e), moduleCoord));
      } else {
        collectionFailures.add(failed);
        if (failed.descriptor) {
          brokenDescriptors.put(gav(failed.artifact), failed);
        }
      }
      log.warn("[socket-facts] could not build dependency graph for " + moduleCoord + ": " + rootMessage(e));
      reported = true;
    }
    Map<String, String> incompleteDescriptors = observer.incompleteDescriptors();
    // Dependencies whose own resolution failed are reported, not emitted, as Gradle and sbt do. One
    // whose POM was missing or invalid is still emitted: its own artifact may be fine.
    Set<String> unresolved = new HashSet<>();
    Map<String, Set<String>> scopesByGav =
        brokenDescriptors.isEmpty() && incompleteDescriptors.isEmpty() && collectionFailures.isEmpty()
            ? Collections.<String, Set<String>>emptyMap()
            : scopesByGav(graph);
    for (Map.Entry<String, FailedRequest> e : brokenDescriptors.entrySet()) {
      Set<String> scopes = scopesByGav.get(e.getKey());
      if (scopes == null) continue;
      unresolved.add(e.getKey());
      reported |= addFailures(failures, e.getKey(), e.getValue().detail, scopes, passingScopes, moduleCoord);
    }
    for (Map.Entry<String, String> e : incompleteDescriptors.entrySet()) {
      // A strict descriptor policy also throws for it: already reported above.
      if (brokenDescriptors.containsKey(e.getKey())) continue;
      Set<String> scopes = scopesByGav.get(e.getKey());
      if (scopes != null) reported |= addFailures(failures, e.getKey(), e.getValue(), scopes, passingScopes, moduleCoord);
    }
    Set<String> placed = new HashSet<>();
    Set<DependencyNode> onClasspath = null;
    for (FailedRequest failed : collectionFailures) {
      String coord = gav(failed.artifact);
      if (scopesByGav.containsKey(coord)) continue;
      if (onClasspath == null) onClasspath = onClasspath(graph);
      String scope = absentScope(session, module, failed, onClasspath);
      placed.add(coord);
      if (scope == null) {
        log.debug("[socket-facts] " + coord + " failed but sits on no classpath of " + moduleCoord);
      } else if (scope.isEmpty() || passingScopes.contains(scope)) {
        failures.add(new Failure(coord, failed.detail, scope, moduleCoord));
      }
    }
    if (collectorDropsFailedNodes) {
      // An earlier module's cached failure leaves no trace in this graph; only a direct dependency
      // can still be placed.
      for (Map.Entry<String, FailedRequest> e : brokenDescriptors.entrySet()) {
        if (scopesByGav.containsKey(e.getKey()) || placed.contains(e.getKey())) continue;
        String scope = declaredScope(session, module, e.getValue().artifact);
        if (scope != null && passingScopes.contains(scope)) {
          failures.add(new Failure(e.getKey(), e.getValue().detail, scope, moduleCoord));
          reported = true;
        }
      }
    }
    // Maven throws on a collection error before it fetches any artifact, which would leave every
    // healthy node of the partial graph without its file.
    Set<String> unfetched = new HashSet<>();
    if (!result.getCollectionErrors().isEmpty() && graph != null && opts.withFiles) {
      materialize(session, graph, resolutionFilter, unresolved, moduleCoord, failures, unfetched);
    }
    for (Dependency dep : result.getUnresolvedDependencies()) {
      Artifact artifact = dep.getArtifact();
      if (artifact == null || unresolved.contains(gav(artifact))) continue;
      reportUnfetched(dep, result.getResolutionErrors(dep), moduleCoord, failures, unfetched);
      reported = true;
    }
    // Fail closed: a throw whose result named nothing must still surface, or an unresolved dependency
    // would silently leave the reachability analysis blind to whatever that artifact contains.
    if (thrown != null && !reported) {
      unscannable.add(new Unscannable(rootMessage(thrown), moduleCoord));
      log.warn("[socket-facts] could not resolve dependencies for " + moduleCoord + ": " + rootMessage(thrown));
    }
    if (graph == null) return;
    Set<String> visited = new HashSet<>();
    for (DependencyNode child : graph.getChildren()) {
      String id = visit(child, passingScopes, reactorGavs, unresolved, opts, nodes, visited);
      if (id != null) {
        directIds.add(id);
        // A direct dependency's effective scope is its declared scope (Aether's scope selector keeps
        // a depth-1 item's scope), so it reliably seeds the prod/dev split. The node's own `prod` flag
        // does NOT: conflict resolution can keep a node under a dev parent while its effective scope
        // is prod (or vice versa).
        if (isProd(scopeOf(child.getDependency()))) directProdIds.add(id);
      }
    }
    for (String id : unfetched) {
      Node node = nodes.get(id);
      if (node != null) node.unfetched = true;
    }
  }

  /**
   * Which nodes Maven should MATERIALIZE (fetch the artifact for). Everything else is still collected
   * — the graph stays complete — but never resolved, which is what keeps a plain {@code --facts} run
   * download-free and keeps us from requesting a reactor sibling's jar: at the {@code validate} phase
   * the CLI runs, no sibling has been packaged and none need be installed.
   *
   * <p>A node the filter rejects produces no {@code ArtifactResult}, so it lands in neither
   * {@code getResolvedDependencies()} nor {@code getUnresolvedDependencies()} and can never be
   * mistaken for a resolution failure.
   */
  private static DependencyFilter materializationFilter(
      final Options opts,
      final Set<String> passingScopes,
      final Set<String> reactorGavs,
      final Set<String> populateGavs) {
    if (!opts.withFiles) {
      return new DependencyFilter() {
        @Override
        public boolean accept(DependencyNode node, List<DependencyNode> parents) {
          return false;
        }
      };
    }
    return new DependencyFilter() {
      @Override
      public boolean accept(DependencyNode node, List<DependencyNode> parents) {
        Dependency dep = node == null ? null : node.getDependency();
        Artifact artifact = dep == null ? null : dep.getArtifact();
        if (artifact == null) return false;
        if (!passingScopes.contains(scopeOf(dep))) return false;
        String gav = gav(artifact);
        if (reactorGavs.contains(gav)) return false;
        return populateGavs == null || populateGavs.contains(gav);
      }
    };
  }

  /**
   * The artifact step Maven skipped, run on the partial graph the way the resolver's own
   * {@code resolveDependencies} continues past a collection failure. The failed dependencies are left
   * out: they are never emitted, and fetching them again would only repeat the failure.
   */
  private void materialize(
      MavenSession session,
      DependencyNode graph,
      final DependencyFilter resolutionFilter,
      final Set<String> unresolved,
      String moduleCoord,
      Set<Failure> failures,
      Set<String> unfetched) {
    DependencyFilter healthy = new DependencyFilter() {
      @Override
      public boolean accept(DependencyNode node, List<DependencyNode> parents) {
        return resolutionFilter.accept(node, parents) && !unresolved.contains(gav(node.getArtifact()));
      }
    };
    List<ArtifactResult> results;
    try {
      results = repositorySystem
          .resolveDependencies(session.getRepositorySession(), new DependencyRequest(graph, healthy))
          .getArtifactResults();
    } catch (org.eclipse.aether.resolution.DependencyResolutionException e) {
      results = e.getResult().getArtifactResults();
    }
    for (ArtifactResult ar : results) {
      if (ar.isResolved()) continue;
      reportUnfetched(ar.getRequest().getDependencyNode().getDependency(), ar.getExceptions(), moduleCoord, failures, unfetched);
    }
  }

  private void reportUnfetched(
      Dependency dep, List<Exception> errors, String moduleCoord, Set<Failure> failures, Set<String> unfetched) {
    String id = externalId(dep.getArtifact());
    failures.add(new Failure(id, rootMessage(errors.isEmpty() ? null : errors.get(0)), scopeOf(dep), moduleCoord));
    unfetched.add(id);
    log.debug("[socket-facts] could not materialize " + dep.getArtifact() + " (" + scopeOf(dep) + ")");
  }

  private String visit(
      DependencyNode dn,
      Set<String> passingScopes,
      Set<String> reactorGavs,
      Set<String> unresolved,
      Options opts,
      Map<String, Node> nodes,
      Set<String> visited) {
    Dependency dep = dn.getDependency();
    Artifact artifact = dn.getArtifact();
    if (dep == null || artifact == null) return null;
    // A verbose collect — Maven's -X turns one on — keeps conflict-losing nodes in the graph, tagged
    // with the winner they lost to. Only the winner is on the classpath Maven would build.
    if (dn.getData().get(NODE_DATA_CONFLICT_WINNER) != null) return null;
    String scope = scopeOf(dep);
    if (!passingScopes.contains(scope)) return null;

    String gav = gav(artifact);
    if (unresolved.contains(gav)) return null;
    boolean internal = reactorGavs.contains(gav);
    String type = artifact.getProperty(ARTIFACT_PROPERTY_TYPE, artifact.getExtension());
    String classifier = artifact.getClassifier();
    String version = artifact.getBaseVersion();
    String id = internal
        ? SocketSupport.bareId(artifact.getGroupId(), artifact.getArtifactId(), version)
        : externalId(artifact);

    // One walk per node per module traversal: a shared subtree reached via another edge is already
    // fully recorded (node, children, resolved file), so hand back the id without re-descending.
    // Keeps reconverging graphs linear.
    if (!visited.add(id)) return id;

    Node node = internal
        ? upsert(nodes, id, artifact.getGroupId(), artifact.getArtifactId(), "", "", version, gav)
        : upsert(nodes, id, artifact.getGroupId(), artifact.getArtifactId(),
            type == null ? "" : type, classifier == null ? "" : classifier, version, "");
    // Maven wrote each accepted node's resolved file back onto the node; a reactor module reports its
    // own dirs through its `project` record instead of a `file` record.
    if (!internal && opts.withFiles) {
      String file = SocketSupport.existingAbsolutePath(artifact.getFile());
      if (file != null) node.files.add(file);
    }

    for (DependencyNode child : dn.getChildren()) {
      String childId = visit(child, passingScopes, reactorGavs, unresolved, opts, nodes, visited);
      if (childId != null) node.children.add(childId);
    }
    return id;
  }

  private static String externalId(Artifact artifact) {
    // Maven's `type` rather than aether's file extension, so a test-jar keeps the coordId the
    // assembler and the Gradle/SBT scripts already emit. Base version: a resolved remote snapshot's
    // `version` is the timestamped build, which would put a coordinate in the records that no
    // manifest ever names.
    return SocketSupport.coordId(
        artifact.getGroupId(), artifact.getArtifactId(),
        artifact.getProperty(ARTIFACT_PROPERTY_TYPE, artifact.getExtension()), artifact.getClassifier(),
        artifact.getBaseVersion());
  }

  static String gav(Artifact artifact) {
    return artifact.getGroupId() + ":" + artifact.getArtifactId() + ":" + artifact.getBaseVersion();
  }

  private static String scopeOf(Dependency dep) {
    String scope = dep == null ? null : dep.getScope();
    return scope == null || scope.isEmpty() ? "compile" : scope;
  }

  private static boolean isProd(String scope) {
    return scope.equals("compile") || scope.equals("runtime") || scope.equals("system");
  }

  private static Node upsert(
      Map<String, Node> nodes, String id, String groupId, String artifactId, String type, String classifier, String version,
      String project) {
    Node node = nodes.get(id);
    if (node == null) {
      node = new Node(id, groupId, artifactId, type, classifier, version, project);
      nodes.put(id, node);
    }
    return node;
  }

  // ---- emission ----

  // Split a module's resolved nodes into a prod root and a dev root. Membership is decided by which
  // direct dependency a node is REACHABLE from, not by the node's own effective scope: Maven's
  // conflict resolution can retain a node under a dev parent while its effective scope is prod (the
  // retained path came from a test/provided dep, but a removed deeper path had a compile scope, so
  // Aether's scope selector unions them to compile). Partitioning by scope would put that node in the
  // prod root while its only parent sits in the dev root, and emitRoot drops the cross-root edge —
  // leaving the node unreachable and non-direct (the "orphaned component" defect). Reachability also
  // keeps edges intra-root, because a node reached from a prod direct dependency stays prod.
  // Empty roots are skipped.
  private int emitModuleRoots(
      List<String> lines, int rootIdx, String projectKey, Map<String, Node> nodes,
      Set<String> directIds, Set<String> directProdIds) {
    Set<String> prodReachable = reachable(nodes, directProdIds);
    Map<String, Node> prod = new LinkedHashMap<>();
    Map<String, Node> dev = new LinkedHashMap<>();
    for (Node n : nodes.values()) (prodReachable.contains(n.id) ? prod : dev).put(n.id, n);
    if (!prod.isEmpty()) {
      rootIdx = emitRoot(lines, rootIdx, projectKey, "compile", true, prod, directIds);
    }
    if (!dev.isEmpty()) {
      rootIdx = emitRoot(lines, rootIdx, projectKey, "test", false, dev, directIds);
    }
    return rootIdx;
  }

  // Every node id reachable from `seeds` by following retained child edges.
  private static Set<String> reachable(Map<String, Node> nodes, Set<String> seeds) {
    Set<String> seen = new HashSet<>();
    Deque<String> stack = new ArrayDeque<>(seeds);
    while (!stack.isEmpty()) {
      String id = stack.pop();
      if (!seen.add(id)) continue;
      Node node = nodes.get(id);
      if (node == null) continue;
      for (String child : node.children) stack.push(child);
    }
    return seen;
  }

  private int emitRoot(
      List<String> lines, int rootIdx, String projectKey, String config, boolean prod, Map<String, Node> nodeMap, Set<String> directIds) {
    String rootId = Integer.toString(rootIdx);
    rec(lines, "root", rootId, projectKey, config, prod ? "1" : "0");
    for (Node n : nodeMap.values()) {
      rec(lines, "node", rootId, n.id, n.groupId, n.artifactId, n.version, n.type, n.classifier,
          directIds.contains(n.id) ? "1" : "0", n.project);
      for (String child : n.children) {
        if (nodeMap.containsKey(child)) rec(lines, "edge", rootId, n.id, child);
      }
      for (String f : n.files) rec(lines, "file", rootId, n.id, f);
      if (n.unfetched) rec(lines, "unfetched", rootId, n.id);
    }
    return rootIdx + 1;
  }

  // ---- scopes / module files ----

  private Set<String> computePassingScopes(String includeConfigs, String excludeConfigs) {
    List<Pattern> includes = SocketSupport.parsePatterns(includeConfigs);
    List<Pattern> excludes = SocketSupport.parsePatterns(excludeConfigs);
    Set<String> passing = new TreeSet<>();
    for (String scope : ALL_SCOPES) {
      if (matchesAny(excludes, scope)) continue;
      if (!includes.isEmpty() && !matchesAny(includes, scope)) continue;
      passing.add(scope);
    }
    return passing;
  }

  private static boolean matchesAny(List<Pattern> patterns, String name) {
    for (Pattern p : patterns) if (p.matcher(name).matches()) return true;
    return false;
  }

  // Read the newline-delimited GAV file named by -Dsocket.populateFilesFor. Returns null (materialize
  // all) when not under --with-files, unset, or the file is missing/empty (a wiring slip, not a
  // deliberate "fetch nothing"), matching the Gradle/SBT scripts.
  private Set<String> readPopulateGavs(Options opts) throws IOException {
    if (!opts.withFiles || opts.populateFilesFor == null || opts.populateFilesFor.trim().isEmpty()) return null;
    File f = new File(opts.populateFilesFor.trim());
    if (!f.exists()) {
      log.warn("[socket-facts] populateFilesFor file not found; materializing files for all resolved artifacts");
      return null;
    }
    Set<String> gavs = new HashSet<>();
    for (String line : Files.readAllLines(f.toPath(), StandardCharsets.UTF_8)) {
      String t = line.trim();
      if (!t.isEmpty()) gavs.add(t);
    }
    if (gavs.isEmpty()) {
      log.warn("[socket-facts] populateFilesFor file empty; materializing files for all resolved artifacts");
      return null;
    }
    log.info("[socket-facts] --with-files scoped to " + gavs.size() + " artifact(s)");
    return gavs;
  }

  // Configured source roots, emitted unconditionally (like gradle's srcDirs / sbt's sourceDirectories):
  // the analysis never builds the project, so these need not exist yet.
  private List<String> collectSources(MavenProject module) {
    Set<String> sources = new TreeSet<>();
    addPaths(sources, module.getCompileSourceRoots());
    addPaths(sources, module.getTestCompileSourceRoots());
    for (Resource r : module.getBuild().getResources()) addPath(sources, r.getDirectory());
    for (Resource r : module.getBuild().getTestResources()) addPath(sources, r.getDirectory());
    // generated-source roots aren't on the model without a build; best-effort pick up the
    // conventional dirs only if a prior `mvn compile` already produced them (else they'd be guesses).
    String buildDir = module.getBuild().getDirectory();
    addExisting(sources, buildDir + File.separator + "generated-sources");
    addExisting(sources, buildDir + File.separator + "generated-test-sources");
    return new ArrayList<>(sources);
  }

  // Configured compiled-output dirs, emitted unconditionally (like gradle's classesDirs / sbt's
  // classDirectory): the analysis never builds the project, so these need not exist yet.
  private List<String> collectTargets(MavenProject module) {
    Set<String> targets = new TreeSet<>();
    addPath(targets, module.getBuild().getOutputDirectory());
    addPath(targets, module.getBuild().getTestOutputDirectory());
    return new ArrayList<>(targets);
  }

  private static void addPaths(Set<String> acc, List<String> dirs) {
    if (dirs == null) return;
    for (String d : dirs) addPath(acc, d);
  }

  // Existence-filtered: for speculative paths we only want to emit when they actually exist.
  private static void addExisting(Set<String> acc, String dir) {
    if (dir == null) return;
    String p = SocketSupport.existingAbsolutePath(new File(dir));
    if (p != null) acc.add(p);
  }

  private static void addPath(Set<String> acc, String dir) {
    if (dir == null) return;
    acc.add(new File(dir).getAbsolutePath());
  }

  // ---- records I/O ----

  private static void rec(List<String> lines, String... fields) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < fields.length; i++) {
      if (i > 0) sb.append('\t');
      sb.append(SocketSupport.escapeField(fields[i]));
    }
    lines.add(sb.toString());
  }

  private void write(String recordsFile, List<String> lines) throws IOException {
    File out = new File(recordsFile);
    if (out.getParentFile() != null) Files.createDirectories(out.getParentFile().toPath());
    try (PrintWriter writer = new PrintWriter(out, StandardCharsets.UTF_8.name())) {
      for (String line : lines) writer.print(line + "\n");
    }
    log.info("[socket-facts] records written to: " + out.getAbsolutePath());
  }

  static String rootMessage(Throwable t) {
    Throwable cur = t;
    String msg = null;
    int guard = 0;
    while (cur != null && guard++ < 12) {
      if (cur.getMessage() != null) msg = cur.getMessage();
      Throwable next = cur.getCause();
      // Maven 4 batches requests: BatchRequestException carries each failed request as a suppressed
      // exception, not as its cause.
      if (next == null && cur.getSuppressed().length > 0) next = cur.getSuppressed()[0];
      cur = next;
    }
    return (msg != null ? msg : "unknown resolution failure").trim();
  }

  private static Map<String, Set<String>> scopesByGav(DependencyNode root) {
    Map<String, Set<String>> scopes = new HashMap<>();
    if (root == null) return scopes;
    Set<DependencyNode> seen = Collections.newSetFromMap(new IdentityHashMap<>());
    Deque<DependencyNode> todo = new ArrayDeque<>(root.getChildren());
    while (!todo.isEmpty()) {
      DependencyNode dn = todo.pop();
      if (!seen.add(dn) || dn.getData().get(NODE_DATA_CONFLICT_WINNER) != null) continue;
      if (dn.getArtifact() != null) {
        scopes.computeIfAbsent(gav(dn.getArtifact()), k -> new TreeSet<>()).add(scopeOf(dn.getDependency()));
      }
      todo.addAll(dn.getChildren());
    }
    return scopes;
  }

  // The request a collection error is about, when the resolver names one.
  private static FailedRequest failedRequest(Exception e) {
    Throwable cur = e;
    int guard = 0;
    while (cur != null && guard++ < 12) {
      if (cur instanceof ArtifactDescriptorException) {
        ArtifactDescriptorException d = (ArtifactDescriptorException) cur;
        if (d.getResult() != null) {
          ArtifactDescriptorRequest request = d.getResult().getRequest();
          return new FailedRequest(request.getArtifact(), request.getTrace(), true, rootMessage(e));
        }
      } else if (cur instanceof VersionRangeResolutionException) {
        VersionRangeResolutionException r = (VersionRangeResolutionException) cur;
        if (r.getResult() != null) {
          VersionRangeRequest request = r.getResult().getRequest();
          return new FailedRequest(request.getArtifact(), request.getTrace(), false, rootMessage(e));
        }
      }
      cur = cur.getCause();
    }
    return null;
  }

  private static boolean addFailures(
      Set<Failure> failures, String coord, String detail, Set<String> scopes, Set<String> passingScopes,
      String moduleCoord) {
    boolean added = false;
    for (String scope : scopes) {
      if (passingScopes.contains(scope)) added |= failures.add(new Failure(coord, detail, scope, moduleCoord));
    }
    return added;
  }

  /**
   * The scope a failed dependency missing from the final graph would have had, as Maven derives it:
   * the declared scope for a direct dependency, else the parent's scope combined with the
   * dependency's own (JavaScopeDeriver). Null when it sits on no classpath: from Maven 3.3 on the
   * graph keeps a dependency whose POM failed, so one absent from it, or one whose parent is absent,
   * lost a version conflict. Empty when the position is unknown: Maven before 3.9 traces no collect
   * step.
   */
  private String absentScope(
      MavenSession session, MavenProject module, FailedRequest failed, Set<DependencyNode> onClasspath) {
    if (failed.descriptor && !collectorDropsFailedNodes) return null;
    DependencyNode parent = observer.parentOf(failed.trace);
    Dependency dependency = observer.dependencyOf(failed.trace);
    if (parent != null && dependency != null) {
      if (!onClasspath.contains(parent)) return null;
      if (parent.getDependency() == null) return scopeOf(dependency);
      String managed = managedScope(session, module, dependency.getArtifact());
      return derivedScope(parent.getDependency().getScope(), managed != null ? managed : scopeOf(dependency));
    }
    String declared = declaredScope(session, module, failed.artifact);
    return declared != null ? declared : "";
  }

  // ClassicDependencyManager: below the direct dependencies, only the root's dependencyManagement applies.
  private static String managedScope(MavenSession session, MavenProject module, Artifact artifact) {
    if (module.getDependencyManagement() == null) return null;
    org.apache.maven.model.Dependency d =
        modelDependency(session, module.getDependencyManagement().getDependencies(), artifact, false);
    return d == null || d.getScope() == null || d.getScope().isEmpty() ? null : d.getScope();
  }

  // maven-resolver's JavaScopeDeriver.
  private static String derivedScope(String parentScope, String childScope) {
    if ("system".equals(childScope) || "test".equals(childScope)) return childScope;
    if (parentScope == null || parentScope.isEmpty() || "compile".equals(parentScope)) return childScope;
    if ("test".equals(parentScope) || "runtime".equals(parentScope)) return parentScope;
    if ("system".equals(parentScope) || "provided".equals(parentScope)) return "provided";
    return "runtime";
  }

  // The module's own declaration of the artifact, with management applied.
  private static String declaredScope(MavenSession session, MavenProject module, Artifact artifact) {
    org.apache.maven.model.Dependency d = modelDependency(session, module.getDependencies(), artifact, true);
    if (d == null) return null;
    return d.getScope() == null || d.getScope().isEmpty() ? "compile" : d.getScope();
  }

  // The first of `deps` naming the artifact, compared as the resolver sees it: a `test-jar` type
  // becomes classifier `tests`. With `matchVersion`, a ranged version matches whichever it resolved to.
  private static org.apache.maven.model.Dependency modelDependency(
      MavenSession session, List<org.apache.maven.model.Dependency> deps, Artifact artifact, boolean matchVersion) {
    for (org.apache.maven.model.Dependency d : deps) {
      Artifact candidate =
          RepositoryUtils.toDependency(d, session.getRepositorySession().getArtifactTypeRegistry()).getArtifact();
      String version = candidate.getVersion();
      if (candidate.getGroupId().equals(artifact.getGroupId())
          && candidate.getArtifactId().equals(artifact.getArtifactId())
          && candidate.getClassifier().equals(artifact.getClassifier())
          && candidate.getExtension().equals(artifact.getExtension())
          && (!matchVersion
              || version.equals(artifact.getVersion()) || version.startsWith("[") || version.startsWith("("))) {
        return d;
      }
    }
    return null;
  }

  // The final graph's root and every node on its classpath, by identity.
  private static Set<DependencyNode> onClasspath(DependencyNode root) {
    Set<DependencyNode> seen = Collections.newSetFromMap(new IdentityHashMap<>());
    if (root == null) return seen;
    Deque<DependencyNode> todo = new ArrayDeque<>();
    todo.push(root);
    while (!todo.isEmpty()) {
      DependencyNode dn = todo.pop();
      if (dn.getData().get(NODE_DATA_CONFLICT_WINNER) != null || !seen.add(dn)) continue;
      todo.addAll(dn.getChildren());
    }
    return seen;
  }

  private static final class FailedRequest {
    final Artifact artifact;
    final RequestTrace trace;
    // The artifact's POM could not be read; else no version satisfied its range.
    final boolean descriptor;
    final String detail;

    FailedRequest(Artifact artifact, RequestTrace trace, boolean descriptor, String detail) {
      this.artifact = artifact;
      this.trace = trace;
      this.descriptor = descriptor;
      this.detail = detail;
    }
  }

  private static final class Failure {
    final String coord;
    final String detail;
    // Empty when the failure cannot be placed in a scope.
    final String config;
    final String project;

    Failure(String coord, String detail, String config, String project) {
      this.coord = coord;
      this.detail = detail;
      this.config = config;
      this.project = project;
    }

    @Override
    public boolean equals(Object o) {
      if (this == o) return true;
      if (!(o instanceof Failure)) return false;
      Failure f = (Failure) o;
      return coord.equals(f.coord) && detail.equals(f.detail) && config.equals(f.config)
          && project.equals(f.project);
    }

    @Override
    public int hashCode() {
      return (coord + "|" + detail + "|" + config + "|" + project).hashCode();
    }
  }

  // A module whose dependencies could not be resolved at all, with no failing artifact to name.
  private static final class Unscannable {
    final String detail;
    final String project;

    Unscannable(String detail, String project) {
      this.detail = detail;
      this.project = project;
    }

    @Override
    public boolean equals(Object o) {
      if (this == o) return true;
      if (!(o instanceof Unscannable)) return false;
      Unscannable u = (Unscannable) o;
      return detail.equals(u.detail) && project.equals(u.project);
    }

    @Override
    public int hashCode() {
      return (detail + "|" + project).hashCode();
    }
  }

  private static final class Node {
    final String id;
    final String groupId;
    final String artifactId;
    final String type;
    final String classifier;
    final String version;
    // The reactor module's project key when this is a sibling module, else empty.
    final String project;
    final TreeSet<String> children = new TreeSet<>();
    final TreeSet<String> files = new TreeSet<>();
    // Its artifact was requested but could not be fetched.
    boolean unfetched;

    Node(String id, String groupId, String artifactId, String type, String classifier, String version, String project) {
      this.id = id;
      this.groupId = groupId;
      this.artifactId = artifactId;
      this.type = type;
      this.classifier = classifier;
      this.version = version;
      this.project = project;
    }
  }
}
