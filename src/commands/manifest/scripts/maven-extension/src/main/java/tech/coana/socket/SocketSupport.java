package tech.coana.socket;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
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
