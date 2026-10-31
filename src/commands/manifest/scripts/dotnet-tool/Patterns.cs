using System.Text;
using System.Text.RegularExpressions;

namespace Socket.Facts.Dotnet;

// Target-framework name filters with the semantics of the JVM scripts'
// config globs: case-sensitive `*`, `?` and `[...]` (with `[!..]` negation);
// a malformed glob matches literally.
internal sealed class Globs {
  private readonly List<Regex> _includes;
  private readonly List<Regex> _excludes;

  public Globs(string includes, string excludes) {
    _includes = Parse(includes);
    _excludes = Parse(excludes);
  }

  // Matches when any of `names` matches an include (or there are none) and
  // none matches an exclude.
  public bool Matches(IReadOnlyCollection<string> names) {
    if (_excludes.Any(p => names.Any(p.IsMatch))) return false;
    return _includes.Count == 0 || _includes.Any(p => names.Any(p.IsMatch));
  }

  private static List<Regex> Parse(string csv) {
    return csv
      .Split(',')
      .Select(s => s.Trim())
      .Where(s => s.Length > 0)
      .Select(ToRegex)
      .ToList();
  }

  private static Regex ToRegex(string glob) {
    var sb = new StringBuilder("^(?:");
    var i = 0;
    while (i < glob.Length) {
      var ch = glob[i];
      if (ch == '*') {
        sb.Append(".*");
        i += 1;
      } else if (ch == '?') {
        sb.Append('.');
        i += 1;
      } else if (ch == '[') {
        var j = glob.IndexOf(']', i + 1);
        if (j <= i + 1) {
          sb.Append("\\[");
          i += 1;
        } else {
          var body = glob.Substring(i + 1, j - i - 1);
          var negated = body.StartsWith('!');
          if (negated) body = body.Substring(1);
          body = body.Replace("\\", "\\\\").Replace("[", "\\[");
          sb.Append('[').Append(negated ? "^" : "").Append(body).Append(']');
          i = j + 1;
        }
      } else {
        sb.Append(Regex.Escape(ch.ToString()));
        i += 1;
      }
    }
    sb.Append(")\\z");
    try {
      return new Regex(sb.ToString(), RegexOptions.CultureInvariant);
    } catch (ArgumentException) {
      return new Regex($"^{Regex.Escape(glob)}\\z", RegexOptions.CultureInvariant);
    }
  }
}

// --exclude-paths, pre-compiled by the CLI (exclude-paths-glob.mts) into
// anchored regex sources over build-root-relative directories; each already
// means "this directory or anything below it".
internal sealed class PathExcludes {
  private readonly List<Regex> _patterns = new();

  public PathExcludes(string csv) {
    foreach (var raw in csv.Split(',')) {
      var p = raw.Trim();
      if (p.Length == 0) continue;
      try {
        _patterns.Add(new Regex(p, RegexOptions.CultureInvariant));
      } catch (ArgumentException) {
        // The CLI only emits valid sources; this guards a broken transport.
      }
    }
  }

  // `rel` is build-root-relative with `/`; the build root itself (`.`) is
  // never excluded.
  public bool IsExcluded(string rel) => rel != "." && _patterns.Any(p => p.IsMatch(rel));
}

internal static class Text {
  public static string FirstLine(string s) {
    var idx = s.IndexOfAny(new[] { '\n', '\r' });
    return idx < 0 ? s : s.Substring(0, idx);
  }

  public static void TryDelete(string path) {
    try {
      File.Delete(path);
    } catch (IOException) {
      // Left in the temp dir.
    } catch (UnauthorizedAccessException) {
      // Left in the temp dir.
    }
  }
}

// Restore reports some paths through a symlinked directory's target (macOS's
// /var -> /private/var); the last segment keeps the name it was given.
internal static class RealPaths {
  private static readonly Dictionary<string, string> Dirs = new(StringComparer.Ordinal);

  public static string Of(string path) {
    var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
    var dir = Path.GetDirectoryName(full);
    return dir == null ? full : Path.Combine(Dir(dir), Path.GetFileName(full));
  }

  public static string Dir(string dir) {
    if (Dirs.TryGetValue(dir, out var known)) return known;
    var parent = Path.GetDirectoryName(dir);
    var real = parent == null ? dir : Path.Combine(Dir(parent), Path.GetFileName(dir));
    try {
      if (new DirectoryInfo(real).ResolveLinkTarget(returnFinalTarget: true) is { } target) real = Dir(target.FullName);
    } catch (Exception e) when (e is IOException or UnauthorizedAccessException) {
      // Unresolvable links stay as written.
    }
    Dirs[dir] = real;
    return real;
  }
}
