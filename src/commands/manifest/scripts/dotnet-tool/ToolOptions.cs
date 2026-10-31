namespace Socket.Facts.Dotnet;

internal sealed class ToolOptions {
  public const string Usage = """
    Usage: socket-facts-dotnet --records <file> --entry <file> [options] [-- <dotnet restore args>]

    Options:
      --records <file>             Records output file (TSV line protocol). Required.
      --entry <file>               Solution (.sln/.slnx/.slnf) or project file to scan. Required.
      --dotnet <path>              dotnet executable that runs `dotnet restore` (default: dotnet).
      --with-files                 Also emit resolved artifact and source paths.
      --include-configs <csv>      Target framework globs; only matching ones are read.
      --exclude-configs <csv>      Target framework globs to skip (applied after includes).
      --exclude-paths <csv>        Anchored regex sources over build-root-relative project dirs.
      --exclude-base <dir>         Directory --exclude-paths is relative to (default: the build root).
      --workspaces                 Only list the projects (no restore, no dependencies).
      --members                    Only list the projects the entry builds (no evaluation).
      --verbose                    Log progress to stderr.

    Arguments after `--` go to `dotnet restore` verbatim. MSBuild properties among
    them (-p:K=V, --property:K=V, /p:K=V) and --runtime/-r also apply to project
    evaluation, so evaluation and restore see the same build.
    """;

  public string RecordsPath = "";
  public string EntryPath = "";
  public string Dotnet = "dotnet";
  public bool WithFiles;
  public string IncludeConfigs = "";
  public string ExcludeConfigs = "";
  public string ExcludePaths = "";
  public string ExcludeBase = "";
  public bool Workspaces;
  public bool Members;
  public bool Verbose;
  public List<string> RestoreArgs = new();
  public Dictionary<string, string> GlobalProperties = new(StringComparer.OrdinalIgnoreCase);

  public static ToolOptions Parse(string[] args) {
    var opts = new ToolOptions();
    var i = 0;
    for (; i < args.Length; i += 1) {
      var arg = args[i];
      if (arg == "--") {
        i += 1;
        break;
      }
      switch (arg) {
        case "--records":
          opts.RecordsPath = Next(args, ref i, arg);
          break;
        case "--entry":
          opts.EntryPath = Next(args, ref i, arg);
          break;
        case "--dotnet":
          opts.Dotnet = Next(args, ref i, arg);
          break;
        case "--with-files":
          opts.WithFiles = true;
          break;
        case "--include-configs":
          opts.IncludeConfigs = Next(args, ref i, arg);
          break;
        case "--exclude-configs":
          opts.ExcludeConfigs = Next(args, ref i, arg);
          break;
        case "--exclude-paths":
          opts.ExcludePaths = Next(args, ref i, arg);
          break;
        case "--exclude-base":
          opts.ExcludeBase = RealPaths.Dir(Path.GetFullPath(Next(args, ref i, arg)));
          break;
        case "--workspaces":
          opts.Workspaces = true;
          break;
        case "--members":
          opts.Members = true;
          break;
        case "--verbose":
          opts.Verbose = true;
          break;
        default:
          throw new ArgumentException($"Unknown argument `{arg}`");
      }
    }
    var runtimes = new List<string>();
    for (; i < args.Length; i += 1) {
      var arg = args[i];
      opts.RestoreArgs.Add(arg);
      if (TryParseProperty(arg, out var props)) {
        foreach (var (key, value) in props) opts.GlobalProperties[key] = value;
        continue;
      }
      string? rid = null;
      if ((arg == "--runtime" || arg == "-r") && i + 1 < args.Length) {
        i += 1;
        rid = args[i];
        opts.RestoreArgs.Add(rid);
      } else if (arg.StartsWith("--runtime=", StringComparison.Ordinal)) {
        rid = arg.Substring("--runtime=".Length);
      }
      if (!string.IsNullOrEmpty(rid)) runtimes.Add(rid);
    }
    // What `dotnet restore --runtime` forwards: the RuntimeIdentifiers property.
    if (runtimes.Count > 0) opts.GlobalProperties["RuntimeIdentifiers"] = string.Join(';', runtimes);
    if (string.IsNullOrEmpty(opts.RecordsPath) || string.IsNullOrEmpty(opts.EntryPath)) {
      throw new ArgumentException("--records and --entry are required");
    }
    opts.EntryPath = RealPaths.Of(opts.EntryPath);
    return opts;
  }

  private static string Next(string[] args, ref int i, string arg) {
    i += 1;
    if (i >= args.Length) throw new ArgumentException($"{arg} expects a value");
    return args[i];
  }

  // MSBuild's property switch: `-p:A=1;B=2`, also spelled /p:, -property:,
  // --property: (case-insensitive). Per the MSBuild command-line reference,
  // `;` or `,` separates properties; a quoted value keeps its separators.
  private static bool TryParseProperty(string arg, out List<(string Key, string Value)> props) {
    props = new();
    string? rest = null;
    foreach (var prefix in new[] { "-p:", "/p:", "--property:", "-property:", "/property:" }) {
      if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
        rest = arg.Substring(prefix.Length);
        break;
      }
    }
    if (rest == null) return false;
    foreach (var part in SplitUnquoted(rest)) {
      var eq = part.IndexOf('=');
      if (eq <= 0) continue;
      props.Add((part.Substring(0, eq).Trim(), Unquote(part.Substring(eq + 1).Trim())));
    }
    return props.Count > 0;
  }

  private static IEnumerable<string> SplitUnquoted(string s) {
    var start = 0;
    var quoted = false;
    for (var i = 0; i < s.Length; i += 1) {
      if (s[i] == '"') {
        quoted = !quoted;
      } else if (!quoted && (s[i] == ';' || s[i] == ',')) {
        yield return s.Substring(start, i - start);
        start = i + 1;
      }
    }
    yield return s.Substring(start);
  }

  private static string Unquote(string v) {
    return v.Length >= 2 && v[0] == '"' && v[^1] == '"' ? v.Substring(1, v.Length - 2) : v;
  }
}
