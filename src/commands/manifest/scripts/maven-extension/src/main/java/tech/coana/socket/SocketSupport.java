package tech.coana.socket;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Shared helpers kept byte-compatible with the Gradle/SBT scripts and the TS parsers: the
 * build-root-relative workspace path, path exclusion and record-field escaping.
 */
public final class SocketSupport {
  private SocketSupport() {}

  /** The module dir relative to the reactor (build) root; "." for the root. */
  public static String workspace(Path rootDir, Path projectDir) {
    return rootDir.equals(projectDir) ? "." : rootDir.relativize(projectDir).toString();
  }

  public static String relativePath(Path rootDir, Path file) {
    return rootDir.relativize(file).toString().replace(File.separatorChar, '/');
  }

  /**
   * Compile a comma-separated list of PRE-COMPILED {@code --exclude-paths} regex pattern sources
   * into {@link Pattern}s, used only to skip whole excluded reactor modules. The CLI compiles the
   * user-facing globs in {@code exclude-paths-glob.mts} (the single glob implementation, tested in
   * CI); this only {@code Pattern.compile()}s what it receives. A pattern that doesn't compile is
   * dropped, never thrown: the CLI emits a dialect-portable subset, so this only guards against a
   * broken transport.
   */
  public static List<Pattern> parseExcludePatterns(String csv) {
    List<Pattern> out = new ArrayList<>();
    if (csv == null || csv.trim().isEmpty()) return out;
    for (String raw : csv.split(",")) {
      String p = raw.trim();
      if (p.isEmpty()) continue;
      try {
        out.add(Pattern.compile(p));
      } catch (java.util.regex.PatternSyntaxException ignored) {
      }
    }
    return out;
  }

  /**
   * Whether a module directory is covered by an {@code --exclude-paths} pattern, which is relative
   * to {@code base} (the scan root). A module outside it, such as a {@code <module>../x</module>}
   * beyond the scan root, never is.
   */
  public static boolean isExcludedDir(Path base, Path dir, List<Pattern> patterns) {
    if (patterns == null || patterns.isEmpty()) return false;
    Path path = canonical(dir);
    // On another Windows drive than the scan root, so outside it.
    if (!java.util.Objects.equals(path.getRoot(), base.getRoot())) return false;
    String rel = base.relativize(path).toString().replace(File.separatorChar, '/');
    return !rel.equals("..") && !rel.startsWith("../") && isExcludedPath(rel.isEmpty() ? "." : rel, patterns);
  }

  /** The canonical {@code isExcludedDir} base: {@code socket.excludeBase}, else the build root. */
  public static Path excludeBase(String excludeBase, File rootDir) {
    return canonical((excludeBase != null && !excludeBase.isEmpty() ? new File(excludeBase) : rootDir).toPath());
  }

  private static Path canonical(Path p) {
    try {
      return p.toRealPath();
    } catch (java.io.IOException e) {
      return p.toAbsolutePath().normalize();
    }
  }

  /** Whether a scan-root-relative POSIX path is covered by any {@code --exclude-paths} pattern. */
  public static boolean isExcludedPath(String rel, List<Pattern> patterns) {
    if (patterns == null || patterns.isEmpty()) return false;
    String c = (rel == null ? "" : rel).replace("\\", "/");
    while (c.startsWith("./")) c = c.substring(2);
    while (c.startsWith("/")) c = c.substring(1);
    while (c.endsWith("/")) c = c.substring(0, c.length() - 1);
    if (c.isEmpty()) return false;
    for (Pattern p : patterns) {
      if (p.matcher(c).matches()) return true;
    }
    return false;
  }

  /** Backslash-escape a record field so it can never break line/field framing (see records.ts). */
  public static String escapeField(String v) {
    if (v == null) return "";
    return v.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r");
  }
}
