using System.Diagnostics;
using System.Text.RegularExpressions;

namespace Socket.Facts.Dotnet;

internal sealed record RestoreError(string Code, string Message, string ProjectFile);

internal sealed record RestoreOutcome(
  int ExitCode,
  bool TimedOut,
  DateTime StartedUtc,
  List<RestoreError> Errors
) {
  public bool Succeeded => !TimedOut && ExitCode == 0;
}

// Runs the user's own `dotnet restore`: the same host, SDK selection
// (global.json), environment, nuget.config hierarchy and credential providers
// as when they run it themselves, so whatever restores for them restores here.
internal static class Restorer {
  // Bounds a restore that hangs, e.g. on an unreachable feed.
  public const int TimeoutSec = 1800;

  // MSBuild's canonical error format: `origin: error CODE: text [project]`,
  // which the file logger prefixes with the building node's id (`1>`).
  private static readonly Regex ErrorLine = new(
    @"^(?<origin>.*?):\s*error\s*(?<code>[A-Za-z]+\d+)?\s*:\s*(?<text>.*?)(?:\s+\[(?<project>[^\[\]]+)\])?\s*$",
    RegexOptions.Compiled
  );

  public static RestoreOutcome Run(ToolOptions opts, string target, Action<string> log) {
    var errorLog = Path.Combine(Path.GetTempPath(), $"socket-facts-restore-{Guid.NewGuid():N}.log");
    var psi = new ProcessStartInfo(opts.Dotnet) {
      UseShellExecute = false,
      // Inherit stdout/stderr: the output reaches the user as their own
      // restore output would, and no pipe can be held open by a child.
      RedirectStandardInput = true,
      WorkingDirectory = Path.GetDirectoryName(opts.EntryPath)!,
    };
    psi.ArgumentList.Add("restore");
    psi.ArgumentList.Add(target);
    // Socket reports advisories itself; auditing only adds network calls and
    // NU190x warnings a project may promote to errors.
    psi.ArgumentList.Add("-p:NuGetAudit=false");
    // No lingering MSBuild nodes holding this process's handles.
    psi.ArgumentList.Add("-nodeReuse:false");
    psi.ArgumentList.Add("-fileLogger");
    psi.ArgumentList.Add($"-fileLoggerParameters:LogFile={errorLog};ErrorsOnly;Encoding=UTF-8");
    foreach (var arg in opts.RestoreArgs) psi.ArgumentList.Add(arg);
    log($"running: {opts.Dotnet} {string.Join(' ', psi.ArgumentList)}");

    var started = DateTime.UtcNow;
    using var process = Process.Start(psi)
      ?? throw new InvalidOperationException($"could not start `{opts.Dotnet}`");
    process.StandardInput.Close();
    var timedOut = !process.WaitForExit(TimeoutSec * 1000);
    if (timedOut) {
      try {
        process.Kill(entireProcessTree: true);
      } catch (InvalidOperationException) {
        // Exited between the timeout and the kill.
      }
      process.WaitForExit();
    }
    var errors = ReadErrors(errorLog);
    Text.TryDelete(errorLog);
    return new RestoreOutcome(timedOut ? -1 : process.ExitCode, timedOut, started, errors);
  }

  private static bool IsProjectFile(string path) =>
    path.EndsWith("proj", StringComparison.OrdinalIgnoreCase);

  private static List<RestoreError> ReadErrors(string path) {
    var errors = new List<RestoreError>();
    if (!File.Exists(path)) return errors;
    foreach (var line in File.ReadAllLines(path)) {
      var m = ErrorLine.Match(Regex.Replace(line.Trim().TrimStart('\uFEFF'), @"^\d+>", ""));
      if (!m.Success) continue;
      // The error's origin is the file it points into, the project for a
      // NuGet error; the bracketed file is what was being built, which for a
      // solution restore is the solution.
      var origin = Regex.Replace(m.Groups["origin"].Value.Trim(), @"\(\d+(,\d+)*\)$", "");
      var built = m.Groups["project"].Value;
      var project = IsProjectFile(origin) && File.Exists(origin)
        ? origin
        : IsProjectFile(built) && File.Exists(built) ? built : "";
      errors.Add(new RestoreError(m.Groups["code"].Value, m.Groups["text"].Value, project));
    }
    return errors;
  }
}
