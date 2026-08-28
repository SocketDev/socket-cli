package tech.coana.socket;

import org.apache.maven.execution.MavenSession;
import org.apache.maven.model.Resource;
import org.apache.maven.project.DefaultDependencyResolutionRequest;
import org.apache.maven.project.DependencyResolutionException;
import org.apache.maven.project.DependencyResolutionRequest;
import org.apache.maven.project.DependencyResolutionResult;
import org.apache.maven.project.MavenProject;
import org.apache.maven.project.ProjectDependenciesResolver;
import org.eclipse.aether.artifact.Artifact;
import org.eclipse.aether.graph.Dependency;
import org.eclipse.aether.graph.DependencyFilter;
import org.eclipse.aether.graph.DependencyNode;
import org.slf4j.Logger;

import java.io.File;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
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
  private final String mavenVersion;
  private final Logger log;

  public SocketFactsRecordsEngine(
      ProjectDependenciesResolver dependenciesResolver, String mavenVersion, Logger log) {
    this.dependenciesResolver = dependenciesResolver;
    this.mavenVersion = mavenVersion;
    this.log = log;
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

    for (MavenProject module : reactor) {
      String ws = SocketSupport.workspace(rootDir.toPath(), module.getBasedir().toPath());
      if (SocketSupport.isExcludedPath(ws, excludes)) continue;
      rec(lines, "project", ws, module.getGroupId(), module.getArtifactId(), module.getVersion(), ws);
      if (opts.withFiles) {
        for (String s : collectSources(module)) rec(lines, "projectSrc", ws, s);
        for (String t : collectTargets(module)) rec(lines, "projectTgt", ws, t);
      }
    }

    for (String scope : passingScopes) rec(lines, "scanned", scope);

    Set<Failure> failures = new LinkedHashSet<>();
    int rootIdx = 0;
    for (MavenProject module : reactor) {
      String ws = SocketSupport.workspace(rootDir.toPath(), module.getBasedir().toPath());
      // A wholly excluded reactor module is not resolved (matches the project-record skip above).
      if (SocketSupport.isExcludedPath(ws, excludes)) continue;
      Map<String, Node> nodes = new LinkedHashMap<>();
      Set<String> directIds = new HashSet<>();
      collectModule(session, module, passingScopes, reactorGavs, populateGavs, opts, nodes, directIds, failures);
      rootIdx = emitModuleRoots(lines, rootIdx, ws, nodes, directIds);
    }

    for (Failure f : failures) rec(lines, "failure", f.coord, f.detail, f.config);

    write(opts.recordsFile, lines);
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
      Set<Failure> failures) {
    String moduleCoord = module.getGroupId() + ":" + module.getArtifactId() + ":" + module.getVersion();
    DependencyResolutionResult result;
    DependencyResolutionException thrown = null;
    try {
      DependencyResolutionRequest request =
          new DefaultDependencyResolutionRequest(module, session.getRepositorySession());
      request.setResolutionFilter(materializationFilter(opts, passingScopes, reactorGavs, populateGavs));
      result = dependenciesResolver.resolve(request);
    } catch (DependencyResolutionException e) {
      // Maven attaches the partial result — graph plus per-dependency errors — to the exception, so
      // one unresolvable artifact still yields a complete graph and a precise failure record.
      thrown = e;
      result = e.getResult();
      if (result == null) {
        failures.add(new Failure(moduleCoord, rootMessage(e), "graph"));
        log.warn("[socket-facts] could not resolve dependencies for " + moduleCoord + ": " + rootMessage(e));
        return;
      }
    }
    // Tracked per call, not by `failures.size()`: the set is shared across modules and Failure has
    // value equality, so a sibling module failing on the same dependency absorbs this module's add.
    boolean reported = false;
    for (Exception e : result.getCollectionErrors()) {
      failures.add(new Failure(moduleCoord, rootMessage(e), "graph"));
      log.warn("[socket-facts] could not build dependency graph for " + moduleCoord + ": " + rootMessage(e));
      reported = true;
    }
    for (Dependency dep : result.getUnresolvedDependencies()) {
      Artifact artifact = dep.getArtifact();
      if (artifact == null) continue;
      List<Exception> errors = result.getResolutionErrors(dep);
      failures.add(new Failure(
          gav(artifact), rootMessage(errors.isEmpty() ? null : errors.get(0)), scopeOf(dep)));
      log.debug("[socket-facts] could not materialize " + artifact + " (" + scopeOf(dep) + ")");
      reported = true;
    }
    // Fail closed: a throw whose result named nothing must still surface, or an unresolved dependency
    // would silently leave the reachability analysis blind to whatever that artifact contains.
    if (thrown != null && !reported) {
      failures.add(new Failure(moduleCoord, rootMessage(thrown), "graph"));
      log.warn("[socket-facts] could not resolve dependencies for " + moduleCoord + ": " + rootMessage(thrown));
    }
    DependencyNode root = result.getDependencyGraph();
    if (root == null) return;
    Set<String> visited = new HashSet<>();
    for (DependencyNode child : root.getChildren()) {
      String id = visit(child, passingScopes, reactorGavs, opts, nodes, visited);
      if (id != null) directIds.add(id);
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
        String scope = scopeOf(dep);
        // A system-scope artifact carries its systemPath on the model and has no repository to be
        // fetched from; visit() reads the file straight off the node instead.
        if ("system".equals(scope) || !passingScopes.contains(scope)) return false;
        String gav = gav(artifact);
        if (reactorGavs.contains(gav)) return false;
        return populateGavs == null || populateGavs.contains(gav);
      }
    };
  }

  private String visit(
      DependencyNode dn,
      Set<String> passingScopes,
      Set<String> reactorGavs,
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
    boolean internal = reactorGavs.contains(gav);
    // Maven's `type` rather than aether's file extension, so a test-jar keeps the coordId the
    // assembler and the Gradle/SBT scripts already emit.
    String type = artifact.getProperty(ARTIFACT_PROPERTY_TYPE, artifact.getExtension());
    String classifier = artifact.getClassifier();
    // Base version: a resolved remote snapshot's `version` is the timestamped build, which would
    // put a coordinate in the records that no manifest ever names.
    String version = artifact.getBaseVersion();
    String id = internal
        ? SocketSupport.bareId(artifact.getGroupId(), artifact.getArtifactId(), version)
        : SocketSupport.coordId(artifact.getGroupId(), artifact.getArtifactId(), type, classifier, version);

    // One walk per node per module traversal: a shared subtree reached via another edge is already
    // fully recorded (node, children, resolved file), so hand back the id without re-descending.
    // Keeps reconverging graphs linear.
    if (!visited.add(id)) return id;

    Node node = internal
        ? upsert(nodes, id, artifact.getGroupId(), artifact.getArtifactId(), "", "", version)
        : upsert(nodes, id, artifact.getGroupId(), artifact.getArtifactId(),
            type == null ? "" : type, classifier == null ? "" : classifier, version);
    // Maven wrote each accepted node's resolved file back onto the node; a reactor module reports its
    // own dirs through its `project` record instead of a `file` record.
    if (!internal && opts.withFiles) {
      String file = SocketSupport.existingAbsolutePath(artifact.getFile());
      if (file != null) node.files.add(file);
    }
    if (isProd(scope)) node.prod = true;

    for (DependencyNode child : dn.getChildren()) {
      String childId = visit(child, passingScopes, reactorGavs, opts, nodes, visited);
      if (childId != null) node.children.add(childId);
    }
    return id;
  }

  private static String gav(Artifact artifact) {
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
      Map<String, Node> nodes, String id, String groupId, String artifactId, String type, String classifier, String version) {
    Node node = nodes.get(id);
    if (node == null) {
      node = new Node(id, groupId, artifactId, type, classifier, version);
      nodes.put(id, node);
    }
    return node;
  }

  // ---- emission ----

  // Split a module's resolved nodes into a prod root and a dev root (each artifact has one effective
  // scope, so the subgraphs are disjoint and edges stay intra-root). Empty roots are skipped.
  private int emitModuleRoots(List<String> lines, int rootIdx, String projectKey, Map<String, Node> nodes, Set<String> directIds) {
    Map<String, Node> prod = new LinkedHashMap<>();
    Map<String, Node> dev = new LinkedHashMap<>();
    for (Node n : nodes.values()) (n.prod ? prod : dev).put(n.id, n);
    if (!prod.isEmpty()) {
      rootIdx = emitRoot(lines, rootIdx, projectKey, "compile", true, prod, directIds);
    }
    if (!dev.isEmpty()) {
      rootIdx = emitRoot(lines, rootIdx, projectKey, "test", false, dev, directIds);
    }
    return rootIdx;
  }

  private int emitRoot(
      List<String> lines, int rootIdx, String projectKey, String config, boolean prod, Map<String, Node> nodeMap, Set<String> directIds) {
    String rootId = Integer.toString(rootIdx);
    rec(lines, "root", rootId, projectKey, config, prod ? "1" : "0");
    for (Node n : nodeMap.values()) {
      rec(lines, "node", rootId, n.id, n.groupId, n.artifactId, n.version, n.type, n.classifier,
          directIds.contains(n.id) ? "1" : "0");
      for (String child : n.children) {
        if (nodeMap.containsKey(child)) rec(lines, "edge", rootId, n.id, child);
      }
      for (String f : n.files) rec(lines, "file", rootId, n.id, f);
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

  private static String rootMessage(Throwable t) {
    Throwable cur = t;
    String msg = null;
    int guard = 0;
    while (cur != null && guard++ < 12) {
      if (cur.getMessage() != null) msg = cur.getMessage();
      cur = cur.getCause();
    }
    return (msg != null ? msg : "unknown resolution failure").trim();
  }

  private static final class Failure {
    final String coord;
    final String detail;
    final String config;

    Failure(String coord, String detail, String config) {
      this.coord = coord;
      this.detail = detail;
      this.config = config;
    }

    @Override
    public boolean equals(Object o) {
      if (this == o) return true;
      if (!(o instanceof Failure)) return false;
      Failure f = (Failure) o;
      return coord.equals(f.coord) && detail.equals(f.detail) && config.equals(f.config);
    }

    @Override
    public int hashCode() {
      return (coord + "|" + detail + "|" + config).hashCode();
    }
  }

  private static final class Node {
    final String id;
    final String groupId;
    final String artifactId;
    final String type;
    final String classifier;
    final String version;
    final TreeSet<String> children = new TreeSet<>();
    final TreeSet<String> files = new TreeSet<>();
    boolean prod = false;

    Node(String id, String groupId, String artifactId, String type, String classifier, String version) {
      this.id = id;
      this.groupId = groupId;
      this.artifactId = artifactId;
      this.type = type;
      this.classifier = classifier;
      this.version = version;
    }
  }
}
