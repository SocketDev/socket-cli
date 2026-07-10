namespace Socket.Facts.Dotnet;

internal sealed class ToolOptions {
  public const string Usage = """
    Usage: socket-facts-dotnet --records <file> --root <dir> [options] [-p:Key=Value ...]

    Options:
      --records <file>            Records output file (TSV line protocol). Required.
      --root <dir>                Project root to scan (top-level *.sln/*.slnx, else *proj). Required.
      --with-files                Also emit resolved artifact/source paths.
      --include-configs <csv>     Comma-separated anchored regex patterns for target framework names.
      --exclude-configs <csv>     Comma-separated anchored regex patterns; applied after includes.
      --no-restore                Skip the in-process restore (use existing restore output).
      --restore-timeout-sec <n>   Cancel restore after n seconds (default 900).
      --verbose                   Log progress to stderr.
      -p:Key=Value                MSBuild global property, applied to the WHOLE session
                                  (evaluation, restore, and reading). Also accepts --property:.
    """;

  public string RecordsPath = "";
  public string RootDir = "";
  public bool WithFiles;
  public string IncludeConfigs = "";
  public string ExcludeConfigs = "";
  public bool NoRestore;
  public int RestoreTimeoutSec = 900;
  public bool Verbose;
  public Dictionary<string, string> GlobalProperties = new(StringComparer.OrdinalIgnoreCase);

  public static ToolOptions Parse(string[] args) {
    var opts = new ToolOptions();
    for (var i = 0; i < args.Length; i += 1) {
      var arg = args[i];
      switch (arg) {
        case "--records":
          opts.RecordsPath = Next(args, ref i, arg);
          break;
        case "--root":
          opts.RootDir = Next(args, ref i, arg);
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
        case "--no-restore":
          opts.NoRestore = true;
          break;
        case "--restore-timeout-sec":
          if (!int.TryParse(Next(args, ref i, arg), out opts.RestoreTimeoutSec) || opts.RestoreTimeoutSec <= 0) {
            throw new ArgumentException("--restore-timeout-sec expects a positive integer");
          }
          break;
        case "--verbose":
          opts.Verbose = true;
          break;
        default:
          if (TryParseProperty(arg, out var key, out var value)) {
            opts.GlobalProperties[key] = value;
          } else {
            throw new ArgumentException(
              $"Unknown argument `{arg}`. --dotnet-opts accepts MSBuild property tokens only (-p:Key=Value or --property:Key=Value)."
            );
          }
          break;
      }
    }
    if (string.IsNullOrEmpty(opts.RecordsPath) || string.IsNullOrEmpty(opts.RootDir)) {
      throw new ArgumentException("--records and --root are required");
    }
    opts.RootDir = Path.GetFullPath(opts.RootDir);
    return opts;
  }

  private static string Next(string[] args, ref int i, string arg) {
    i += 1;
    if (i >= args.Length) throw new ArgumentException($"{arg} expects a value");
    return args[i];
  }

  private static bool TryParseProperty(string arg, out string key, out string value) {
    key = "";
    value = "";
    string? rest = null;
    foreach (var prefix in new[] { "-p:", "/p:", "--property:", "-property:" }) {
      if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
        rest = arg.Substring(prefix.Length);
        break;
      }
    }
    if (rest == null) return false;
    var eq = rest.IndexOf('=');
    if (eq <= 0) return false;
    key = rest.Substring(0, eq);
    value = rest.Substring(eq + 1);
    return true;
  }
}
