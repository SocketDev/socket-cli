package tech.coana.socket;

import java.io.File;
import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.nio.file.Paths;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Shared helpers kept byte-compatible with the Gradle/SBT scripts and the TS parsers: the
 * build-root-relative workspace path, the full-coordinate {@code id} key, and the config-glob
 * translation.
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
   * Translate a config-name glob to a case-sensitive regex. Supports {@code *}, {@code ?}, and
   * {@code [...]} character classes: enumerations ({@code [cC]}), ranges ({@code [a-z]}), and
   * {@code [!..]}/{@code [^..]} negation. A malformed glob falls back to a literal match, never throws.
   */
  public static Pattern globToRegex(String glob) {
    StringBuilder sb = new StringBuilder();
    int i = 0;
    int n = glob.length();
    while (i < n) {
      char c = glob.charAt(i);
      if (c == '*') { sb.append(".*"); i++; }
      else if (c == '?') { sb.append('.'); i++; }
      else if (c == '[') {
        int j = glob.indexOf(']', i + 1);
        // Treat as a class only with a non-empty body; else a literal '['.
        if (j <= i + 1) { sb.append("\\["); i++; }
        else {
          String body = glob.substring(i + 1, j);
          boolean neg = body.startsWith("!");
          if (neg) body = body.substring(1);
          // Only literal chars and '-' ranges are meaningful; neutralize regex-class tricks.
          body = body.replace("\\", "\\\\").replace("[", "\\[").replace("&", "\\&");
          sb.append('[').append(neg ? "^" : "").append(body).append(']');
          i = j + 1;
        }
      } else if ("\\.^$|+(){}]".indexOf(c) >= 0) {
        sb.append('\\').append(c); i++;
      } else { sb.append(c); i++; }
    }
    try {
      return Pattern.compile(sb.toString());
    } catch (java.util.regex.PatternSyntaxException e) {
      return Pattern.compile(Pattern.quote(glob));
    }
  }

  /**
   * Compile a comma-separated list of {@code --exclude-paths} into glob {@link PathMatcher}s, used
   * only to skip whole excluded reactor modules. Each entry variant yields the entry itself and
   * {@code entry/**} so it matches the dir and its subtree (same expansion as the SCA ignore path).
   * A trailing {@code /**} is stripped first, so a user-written {@code dir/**} still excludes the
   * {@code dir} directory itself, not only its contents. Standard glob semantics (anchored to the
   * scan root, matching the CLI flag): {@code x} is root-level; {@code **}{@code /x} matches at any
   * depth. Mirrors the gradle/sbt producers.
   */
  public static List<PathMatcher> parseExcludeMatchers(String csv) {
    List<PathMatcher> out = new ArrayList<>();
    if (csv == null || csv.trim().isEmpty()) return out;
    for (String raw : csv.split(",")) {
      String g = raw.trim().replace("\\", "/");
      while (g.startsWith("/")) g = g.substring(1);
      while (g.endsWith("/")) g = g.substring(0, g.length() - 1);
      while (g.endsWith("/**")) {
        g = g.substring(0, g.length() - 3);
        while (g.endsWith("/")) g = g.substring(0, g.length() - 1);
      }
      if (g.isEmpty()) continue;
      for (String v : zeroDepthVariants(g)) {
        out.add(FileSystems.getDefault().getPathMatcher("glob:" + v));
        out.add(FileSystems.getDefault().getPathMatcher("glob:" + v + "/**"));
      }
    }
    return out;
  }

  /**
   * NIO glob requires a slash-adjacent {@code **} to consume at least one path segment, but the
   * CLI's micromatch lets it match zero ({@code **}{@code /x} matches root-level {@code x}). Emit
   * every variant with {@code **}{@code /} occurrences dropped so both semantics hold.
   */
  private static Set<String> zeroDepthVariants(String glob) {
    Set<String> out = new LinkedHashSet<>();
    Deque<String> work = new ArrayDeque<>();
    work.add(glob);
    while (!work.isEmpty()) {
      String cur = work.poll();
      if (!out.add(cur)) continue;
      int idx = cur.indexOf("**/");
      while (idx >= 0) {
        if (idx == 0 || cur.charAt(idx - 1) == '/') {
          String collapsed = cur.substring(0, idx) + cur.substring(idx + 3);
          if (!collapsed.isEmpty()) work.add(collapsed);
        }
        idx = cur.indexOf("**/", idx + 1);
      }
    }
    return out;
  }

  /** Whether a scan-root-relative POSIX path is covered by any {@code --exclude-paths} matcher. */
  public static boolean isExcludedPath(String rel, List<PathMatcher> matchers) {
    if (matchers == null || matchers.isEmpty()) return false;
    String c = (rel == null ? "" : rel).replace("\\", "/");
    while (c.startsWith("./")) c = c.substring(2);
    while (c.startsWith("/")) c = c.substring(1);
    while (c.endsWith("/")) c = c.substring(0, c.length() - 1);
    if (c.isEmpty()) return false;
    Path p = Paths.get(c);
    for (PathMatcher m : matchers) {
      if (m.matches(p)) return true;
    }
    return false;
  }

  /** Parse a comma-separated list of globs into case-sensitive patterns. */
  public static List<Pattern> parsePatterns(String csv) {
    List<Pattern> out = new ArrayList<>();
    if (csv == null || csv.trim().isEmpty()) return out;
    for (String raw : csv.split(",")) {
      String p = raw.trim();
      if (!p.isEmpty()) out.add(globToRegex(p));
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
