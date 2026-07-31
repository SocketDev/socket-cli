package tech.coana.socket;

import org.apache.maven.project.MavenProject;

import java.io.File;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.PathMatcher;
import java.util.ArrayList;
import java.util.List;

/**
 * Lightweight sibling of {@link SocketFactsRecordsEngine}: emits only `meta`/`project` records
 * from {@code session.getProjects()} (Maven's own reactor list, already populated before any
 * lifecycle phase runs) - no dependency graph is ever built, so no {@code RepositorySystem} or
 * {@code DependencyGraphBuilder} is needed. Used for cheap workspace discovery (e.g.
 * `socket manifest setup --recursive`) without paying for a full facts-generation build.
 */
public final class SocketWorkspacesRecordsEngine {

  public static final class Options {
    // Scan-root-relative `--exclude-paths` (CSV): a wholly excluded reactor module is skipped.
    public String excludePaths;
    public String recordsFile;
  }

  private SocketWorkspacesRecordsEngine() {}

  public static void run(List<MavenProject> reactor, File rootDir, Options opts, String mavenVersion)
      throws IOException {
    List<PathMatcher> excludes = SocketSupport.parseExcludeMatchers(opts.excludePaths);

    List<String> lines = new ArrayList<>();
    rec(lines, "meta", "maven", mavenVersion, System.getProperty("java.version"));

    for (MavenProject module : reactor) {
      String ws = SocketSupport.workspace(rootDir.toPath(), module.getBasedir().toPath());
      if (SocketSupport.isExcludedPath(ws, excludes)) continue;
      rec(lines, "project", ws, module.getGroupId(), module.getArtifactId(), module.getVersion(), ws);
    }

    write(opts.recordsFile, lines);
  }

  private static void rec(List<String> lines, String... fields) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < fields.length; i++) {
      if (i > 0) sb.append('\t');
      sb.append(SocketSupport.escapeField(fields[i]));
    }
    lines.add(sb.toString());
  }

  private static void write(String recordsFile, List<String> lines) throws IOException {
    File out = new File(recordsFile);
    if (out.getParentFile() != null) Files.createDirectories(out.getParentFile().toPath());
    try (PrintWriter writer = new PrintWriter(out, StandardCharsets.UTF_8.name())) {
      for (String line : lines) writer.print(line + "\n");
    }
  }
}
