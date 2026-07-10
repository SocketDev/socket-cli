package tech.coana.socket;

import org.apache.maven.artifact.Artifact;
import org.apache.maven.artifact.handler.ArtifactHandler;
import org.apache.maven.execution.MavenSession;
import org.apache.maven.model.Resource;
import org.apache.maven.project.DefaultProjectBuildingRequest;
import org.apache.maven.project.MavenProject;
import org.apache.maven.project.ProjectBuildingRequest;
import org.apache.maven.shared.dependency.graph.DependencyGraphBuilder;
import org.apache.maven.shared.dependency.graph.DependencyGraphBuilderException;
import org.apache.maven.shared.dependency.graph.DependencyNode;
import org.eclipse.aether.RepositorySystem;
import org.eclipse.aether.RepositorySystemSession;
import org.eclipse.aether.artifact.DefaultArtifact;
import org.eclipse.aether.repository.RemoteRepository;
import org.eclipse.aether.resolution.ArtifactRequest;
import org.eclipse.aether.resolution.ArtifactResolutionException;
import org.eclipse.aether.resolution.ArtifactResult;
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

  private final RepositorySystem repoSystem;
  private final DependencyGraphBuilder dependencyGraphBuilder;
  private final String mavenVersion;
  private final Logger log;

  public SocketFactsRecordsEngine(
      RepositorySystem repoSystem,
      DependencyGraphBuilder dependencyGraphBuilder,
      String mavenVersion,
      Logger log) {
    this.repoSystem = repoSystem;
    this.dependencyGraphBuilder = dependencyGraphBuilder;
    this.mavenVersion = mavenVersion;
    this.log = log;
  }

  public void run(MavenSession session, List<MavenProject> reactor, File rootDir, Options opts)
      throws IOException {
    RepositorySystemSession repoSession = session.getRepositorySession();
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
    List<java.nio.file.PathMatcher> excludes = SocketSupport.parseExcludeMatchers(opts.excludePaths);

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
      collectModule(session, repoSession, module, passingScopes, reactorGavs, populateGavs, opts, nodes, directIds, failures);
      rootIdx = emitModuleRoots(lines, rootIdx, ws, nodes, directIds);
    }

    for (Failure f : failures) rec(lines, "failure", f.coord, f.detail, f.config);

    write(opts.recordsFile, lines);
  }

  // ---- resolution (mirrors the reference engine's visit, minus JSON shaping) ----

  private void collectModule(
      MavenSession session,
      RepositorySystemSession repoSession,
      MavenProject module,
      Set<String> passingScopes,
      Set<String> reactorGavs,
      Set<String> populateGavs,
      Options opts,
      Map<String, Node> nodes,
      Set<String> directIds,
      Set<Failure> failures) {
    DependencyNode root;
    try {
      ProjectBuildingRequest req = new DefaultProjectBuildingRequest(session.getProjectBuildingRequest());
      req.setProject(module);
      root = dependencyGraphBuilder.buildDependencyGraph(req, null);
    } catch (DependencyGraphBuilderException e) {
      String coord = module.getGroupId() + ":" + module.getArtifactId() + ":" + module.getVersion();
      failures.add(new Failure(coord, rootMessage(e), "graph"));
      log.warn("[socket-facts] could not build dependency graph for " + coord + ": " + rootMessage(e));
      return;
    }
    List<RemoteRepository> repos = module.getRemoteProjectRepositories();
    Set<String> visited = new HashSet<>();
    for (DependencyNode child : root.getChildren()) {
      String id = visit(repoSession, child, passingScopes, reactorGavs, populateGavs, opts, repos, nodes, visited, failures);
      if (id != null) directIds.add(id);
    }
  }

  private String visit(
      RepositorySystemSession repoSession,
      DependencyNode dn,
      Set<String> passingScopes,
      Set<String> reactorGavs,
      Set<String> populateGavs,
      Options opts,
      List<RemoteRepository> repos,
      Map<String, Node> nodes,
      Set<String> visited,
      Set<Failure> failures) {
    Artifact artifact = dn.getArtifact();
    String scope = artifact.getScope();
    if (scope == null || scope.isEmpty()) scope = "compile";
    if (!passingScopes.contains(scope)) return null;

    String gav = artifact.getGroupId() + ":" + artifact.getArtifactId() + ":" + artifact.getVersion();
    boolean internal = reactorGavs.contains(gav);
    String type = artifact.getType();
    String classifier = artifact.getClassifier();
    String id = internal
        ? SocketSupport.bareId(artifact.getGroupId(), artifact.getArtifactId(), artifact.getVersion())
        : SocketSupport.coordId(artifact.getGroupId(), artifact.getArtifactId(), type, classifier, artifact.getVersion());

    // One walk per node per module traversal: a shared subtree reached via another edge is already
    // fully recorded (node, children, resolved file), and the resolve below is a download-on-miss —
    // so hand back the id without re-resolving or re-descending. Keeps reconverging graphs linear.
    if (!visited.add(id)) return id;

    Node node = internal
        ? upsert(nodes, id, artifact.getGroupId(), artifact.getArtifactId(), "", "", artifact.getVersion())
        : upsert(nodes, id, artifact.getGroupId(), artifact.getArtifactId(),
            type == null ? "" : type, classifier == null ? "" : classifier, artifact.getVersion());
    // `a.file` downloads if uncached, so scope to the requested GAVs (null = all).
    if (!internal && opts.withFiles && (populateGavs == null || populateGavs.contains(gav))) {
      String file = resolveArtifactFile(repoSession, artifact, scope, repos, failures);
      if (file != null) node.files.add(file);
    }
    if (isProd(scope)) node.prod = true;

    for (DependencyNode child : dn.getChildren()) {
      String childId = visit(repoSession, child, passingScopes, reactorGavs, populateGavs, opts, repos, nodes, visited, failures);
      if (childId != null) node.children.add(childId);
    }
    return id;
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

  private String resolveArtifactFile(
      RepositorySystemSession repoSession, Artifact artifact, String scope, List<RemoteRepository> repos, Set<Failure> failures) {
    if ("system".equals(scope)) {
      return SocketSupport.existingAbsolutePath(artifact.getFile());
    }
    ArtifactHandler handler = artifact.getArtifactHandler();
    String extension = handler != null ? handler.getExtension() : artifact.getType();
    String classifier = artifact.getClassifier();
    try {
      ArtifactRequest request = new ArtifactRequest()
          .setArtifact(new DefaultArtifact(
              artifact.getGroupId(),
              artifact.getArtifactId(),
              classifier == null ? "" : classifier,
              extension,
              artifact.getVersion()))
          .setRepositories(repos);
      ArtifactResult result = repoSystem.resolveArtifact(repoSession, request);
      File file = result.getArtifact() != null ? result.getArtifact().getFile() : null;
      return SocketSupport.existingAbsolutePath(file);
    } catch (ArtifactResolutionException e) {
      String coord = artifact.getGroupId() + ":" + artifact.getArtifactId() + ":" + artifact.getVersion();
      failures.add(new Failure(coord, rootMessage(e), scope));
      log.debug("[socket-facts] could not materialize " + artifact + ": " + rootMessage(e));
      return null;
    }
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
