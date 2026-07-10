package tech.coana.socket;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Shared helpers kept byte-compatible with the Gradle/SBT scripts and the TS parsers: the
 * build-root-relative workspace path, the full-coordinate {@code id} key, and the config-pattern
 * parsing.
 */
public final class SocketSupport {
  private SocketSupport() {}

  /** The module dir relative to the reactor (build) root; "." for the root. */
  public static String workspace(Path rootDir, Path projectDir) {
    return rootDir.equals(projectDir) ? "." : rootDir.relativize(projectDir).toString();
  }

  /**
   * Full Maven coordinate {@code groupId:artifactId:type:classifier:version} with empty segments
   * dropped — the per-root node key the assembler uses. {@code type} is the Maven packaging (the
   * Gradle/SBT {@code ext}).
   */
  public static String coordId(String groupId, String artifactId, String type, String classifier, String version) {
    StringBuilder sb = new StringBuilder();
    for (String segment : new String[] {groupId, artifactId, type, classifier, version}) {
      if (segment == null || segment.isEmpty()) continue;
      if (sb.length() > 0) sb.append(':');
      sb.append(segment);
    }
    return sb.toString();
  }

  /** Bare {@code groupId:artifactId:version} id used for reactor (internal) module components. */
  public static String bareId(String groupId, String artifactId, String version) {
    return coordId(groupId, artifactId, null, null, version);
  }

  /**
   * Parse a comma-separated list of PRE-COMPILED anchored regex pattern sources. The CLI compiles
   * the user-facing globs in config-glob.mts (the single glob implementation, tested in CI); this
   * extension only {@code Pattern.compile()}s what it receives. A pattern that doesn't compile is
   * dropped, never thrown: the CLI emits a dialect-portable subset, so this only guards against a
   * broken transport.
   */
  public static List<Pattern> parsePatterns(String csv) {
    List<Pattern> out = new ArrayList<>();
    if (csv == null || csv.trim().isEmpty()) return out;
    for (String raw : csv.split(",")) {
      String p = raw.trim();
      if (p.isEmpty()) continue;
      try {
        out.add(Pattern.compile(p));
      } catch (java.util.regex.PatternSyntaxException ignored) {
        // Dropped; see contract above.
      }
    }
    return out;
  }

  /** Absolute path of a file if it exists, else null. */
  public static String existingAbsolutePath(File f) {
    return f != null && f.exists() ? f.getAbsolutePath() : null;
  }

  /** Backslash-escape a record field so it can never break line/field framing (see records.ts). */
  public static String escapeField(String v) {
    if (v == null) return "";
    return v.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r");
  }
}
