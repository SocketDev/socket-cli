using System.Text.Json;
using Microsoft.Build.Definition;
using Microsoft.Build.Evaluation;
using Microsoft.Build.Evaluation.Context;
using Microsoft.Build.Exceptions;

namespace Socket.Facts.Dotnet;

internal enum RestoreStyle {
  PackageReference,
  PackagesConfig,
  ProjectJson,
  Unknown,
}

internal sealed class ProjectInfo {
  public string FullPath = "";
  public string Key = "";
  public Dictionary<string, string> GlobalProperties = new();
  public bool Excluded;
  public RestoreStyle Style = RestoreStyle.Unknown;
  public string? PackagesConfigPath;
}

// Evaluate -> `dotnet restore` -> re-evaluate and read. Never throws for a
// project-level problem: those become failure/unscannable records, which the
// CLI renders and turns into the exit code.
internal static class FactsRunner {
  public static int Run(ToolOptions opts, string sdkVersion) {
    using var records = new RecordsWriter(opts.RecordsPath);
    try {
      records.Meta(sdkVersion);
      new Session(opts, records).Execute();
      return 0;
    } catch (Exception e) {
      // The record keeps a partially written run from reading as complete.
      records.Failure(
        Path.GetFileName(opts.EntryPath),
        $"socket-facts-dotnet failed: {e.GetType().Name}: {Text.FirstLine(e.Message)}",
        "",
        ""
      );
      Console.Error.WriteLine($"socket-facts-dotnet: {e}");
      return 1;
    }
  }
}

internal sealed partial class Session {
  private readonly ToolOptions _opts;
  private readonly RecordsWriter _records;
  private readonly string _buildRoot;
  private readonly string _excludeBase;
  private readonly Globs _configs;
  private readonly PathExcludes _excludes;
  private readonly HashSet<string> _scanned = new(StringComparer.Ordinal);
  private readonly Dictionary<string, ProjectInfo> _projects = new(StringComparer.Ordinal);
  private SolutionContext? _solution;
  private RestoreOutcome? _restore;

  public Session(ToolOptions opts, RecordsWriter records) {
    _opts = opts;
    _records = records;
    _buildRoot = Path.GetDirectoryName(opts.EntryPath)!;
    _excludeBase = string.IsNullOrEmpty(opts.ExcludeBase) ? _buildRoot : opts.ExcludeBase;
    _configs = new Globs(opts.IncludeConfigs, opts.ExcludeConfigs);
    _excludes = new PathExcludes(opts.ExcludePaths);
  }

  public void Execute() {
    _records.BuildRoot(_buildRoot);
    _records.Entry(Path.GetFileName(_opts.EntryPath));
    if (!File.Exists(_opts.EntryPath)) {
      Fail(Path.GetFileName(_opts.EntryPath), "entry file does not exist", "");
      return;
    }

    var entryProjects = EntryProjects();
    if (entryProjects == null) return;
    if (_opts.Members) {
      foreach (var path in entryProjects) {
        if (!IsExcludedProject(path)) _records.Member(Rel(path));
      }
      return;
    }

    // Listing workspaces evaluates the projects as they are before restore;
    // a scan leaves finding them to restore, which follows every reference,
    // conditional per target framework or not.
    if (_opts.Workspaces) {
      var preRestore = new ProjectCollection();
      _evaluation = EvaluationContext.Create(EvaluationContext.SharingPolicy.Shared);
      var queue = new Queue<string>(entryProjects);
      while (queue.Count > 0) {
        var path = queue.Dequeue();
        if (_projects.ContainsKey(path)) continue;
        var info = Register(path);
        if (info.Excluded) continue;
        var project = Evaluate(info, preRestore, reportFailure: true);
        if (project == null) continue;
        info.Style = StyleOf(project, out info.PackagesConfigPath);
        EmitProject(info, project);
        foreach (var reference in ProjectReferences(project, innerBuilds: true)) queue.Enqueue(reference);
      }
      return;
    }

    RunRestore();

    // One evaluation context for every project read: its file-system and SDK
    // resolution caches are shared, and it starts after restore wrote the
    // files evaluation imports.
    var postRestore = new ProjectCollection();
    _evaluation = EvaluationContext.Create(EvaluationContext.SharingPolicy.Shared);
    var read = new HashSet<string>(StringComparer.Ordinal);
    var pending = new Queue<string>(
      entryProjects.Concat(_projects.Keys).Distinct(StringComparer.Ordinal).OrderBy(p => p, StringComparer.Ordinal)
    );
    while (pending.Count > 0) {
      var path = pending.Dequeue();
      if (!read.Add(path)) continue;
      var info = _projects.TryGetValue(path, out var known) ? known : Register(path);
      foreach (var reference in ReadProject(info, postRestore)) {
        if (!read.Contains(reference)) pending.Enqueue(reference);
      }
      foreach (var loaded in postRestore.GetLoadedProjects(path).ToList()) postRestore.UnloadProject(loaded);
    }
    EndDesignTimeBuilds();
    ReportRestoreErrors();
  }

  private ProjectInfo Register(string path) {
    var info = new ProjectInfo {
      FullPath = path,
      Key = Rel(path),
      GlobalProperties = PropertiesFor(path),
    };
    info.Excluded = IsExcludedProject(path);
    _projects[path] = info;
    return info;
  }

  // Relative to --exclude-base when given; a project outside it never matches.
  private bool IsExcludedProject(string path) {
    var rel = RelTo(_excludeBase, Path.GetDirectoryName(path)!);
    return rel != ".." && !rel.StartsWith("../", StringComparison.Ordinal) && _excludes.IsExcluded(rel);
  }

  // The solution's members its active configuration builds, or the entry
  // project itself.
  private List<string>? EntryProjects() {
    var entry = _opts.EntryPath;
    if (!IsSolution(entry)) return new List<string> { entry };
    try {
      _solution = new SolutionContext(entry, _opts.GlobalProperties);
      return _solution.Members.Keys.OrderBy(p => p, StringComparer.Ordinal).ToList();
    } catch (Exception e) when (e is InvalidProjectFileException or IOException or JsonException) {
      Fail(Rel(entry), $"could not read the solution: {Text.FirstLine(e.Message)}", "");
      return null;
    }
  }

  private Dictionary<string, string> PropertiesFor(string projectPath) {
    var props = new Dictionary<string, string>(_opts.GlobalProperties, StringComparer.OrdinalIgnoreCase);
    _solution?.Apply(projectPath, props);
    return props;
  }

  // NuGet's GetRestoreProjectStyleTask (fed by NuGet.targets'
  // _GetRestoreProjectStyle): an explicit RestoreProjectStyle wins (the .NET
  // SDK sets PackageReference), then PackageReference items, then
  // project.json, then a packages config file.
  private static RestoreStyle StyleOf(Project project, out string? packagesConfig) {
    packagesConfig = FindPackagesConfig(project);
    var explicitStyle = project.GetPropertyValue("RestoreProjectStyle");
    if (!string.IsNullOrEmpty(explicitStyle)) {
      return Enum.TryParse<RestoreStyle>(explicitStyle, ignoreCase: true, out var style)
        ? style
        : RestoreStyle.Unknown;
    }
    if (project.GetItems("PackageReference").Count > 0) return RestoreStyle.PackageReference;
    var dir = project.DirectoryPath;
    if (File.Exists(Path.Combine(dir, "project.json"))
        || File.Exists(Path.Combine(dir, $"{project.GetPropertyValue("MSBuildProjectName")}.project.json"))) {
      return RestoreStyle.ProjectJson;
    }
    return packagesConfig != null ? RestoreStyle.PackagesConfig : RestoreStyle.Unknown;
  }

  // packages.config wins over packages.<MSBuildProjectName>.config, as in
  // GetRestoreProjectStyleTask and NuGet.targets' _GenerateRestoreProjectSpec.
  private static string? FindPackagesConfig(Project project) {
    var dir = project.DirectoryPath;
    var shared = Path.Combine(dir, "packages.config");
    if (File.Exists(shared)) return shared;
    var named = Path.Combine(dir, $"packages.{project.GetPropertyValue("MSBuildProjectName")}.config");
    return File.Exists(named) ? named : null;
  }

  // As MSBuild's static graph finds them: a multi-targeting project's
  // references are those of each of its inner builds, which may differ by
  // target framework.
  private IEnumerable<string> ProjectReferences(Project project, bool innerBuilds) {
    var builds = new List<Project> { project };
    if (innerBuilds) {
      foreach (var tfm in Frameworks(project)) {
        try {
          builds.Add(LoadInnerBuild(project, tfm));
        } catch (InvalidProjectFileException) {
          // Its references surface from restore output instead.
        }
      }
    }
    return builds
      .SelectMany(b => b.GetItems("ProjectReference"))
      .Select(item => item.GetMetadataValue("FullPath"))
      .Where(full => !string.IsNullOrEmpty(full) && File.Exists(full))
      .Select(full => Path.GetFullPath(full))
      .Distinct(StringComparer.Ordinal)
      .ToList();
  }

  private void RunRestore() {
    // The entry exactly as the user restores it, or a solution filter of the
    // members --exclude-paths keeps, restored in the solution's own context.
    var target = _opts.EntryPath;
    string? filter = null;
    if (_solution != null) {
      var kept = _solution.Members.Keys
        .Where(m => !IsExcludedProject(m))
        .ToList();
      if (kept.Count == 0) return;
      if (kept.Count != _solution.Members.Count) {
        filter = _solution.WriteFilter(kept);
        target = filter;
      }
    }
    try {
      _restore = Restorer.Run(_opts, target, Log);
    } finally {
      if (filter != null) Text.TryDelete(filter);
    }
    if (_restore.TimedOut) {
      Fail(Rel(_opts.EntryPath), $"`dotnet restore` did not finish within {Restorer.TimeoutSec}s and was stopped", "");
    }
  }

  // As `dotnet restore` evaluates: a project it reads despite a bad import (a
  // web application's Visual Studio-only targets) is read here too.
  private const ProjectLoadSettings RestoreLoadSettings =
    ProjectLoadSettings.IgnoreMissingImports | ProjectLoadSettings.IgnoreEmptyImports | ProjectLoadSettings.IgnoreInvalidImports;

  private EvaluationContext? _evaluation;

  private Project Load(ProjectCollection collection, string path, IDictionary<string, string> properties) {
    foreach (var loaded in collection.GetLoadedProjects(path)) {
      if (loaded.GlobalProperties.Count == properties.Count
          && properties.All(kv => loaded.GlobalProperties.TryGetValue(kv.Key, out var v) && v == kv.Value)) {
        return loaded;
      }
    }
    return Project.FromFile(path, new ProjectOptions {
      EvaluationContext = _evaluation,
      GlobalProperties = properties,
      LoadSettings = RestoreLoadSettings,
      ProjectCollection = collection,
    });
  }

  private Project LoadInnerBuild(Project project, string targetFramework) {
    var props = new Dictionary<string, string>(project.GlobalProperties, StringComparer.OrdinalIgnoreCase) {
      ["TargetFramework"] = targetFramework,
    };
    return Load(project.ProjectCollection, project.FullPath, props);
  }

  private Project? Evaluate(ProjectInfo info, ProjectCollection collection, bool reportFailure) {
    try {
      return Load(collection, info.FullPath, info.GlobalProperties);
    } catch (InvalidProjectFileException e) {
      if (reportFailure) {
        _records.Unscannable("", $"could not evaluate the project: {Text.FirstLine(e.Message)}", info.Key);
      }
      return null;
    }
  }

  private void Fail(string coord, string detail, string config, string projectKey = "") {
    _records.Failure(coord, detail, config, projectKey);
  }

  // A failed restore's errors, except for projects whose assets file already
  // recorded its own (more precise) errors.
  private void ReportRestoreErrors() {
    if (_restore == null || _restore.Succeeded || _restore.TimedOut) return;
    var reported = 0;
    foreach (var error in _restore.Errors) {
      var key = string.IsNullOrEmpty(error.ProjectFile) ? "" : Rel(Path.GetFullPath(error.ProjectFile));
      if (key.Length > 0 && _assetsReportedErrors.Contains(key)) continue;
      var code = string.IsNullOrEmpty(error.Code) ? "" : $"{error.Code}: ";
      Fail(key.Length > 0 ? key : Rel(_opts.EntryPath), $"{code}{error.Message}", "", key);
      reported += 1;
    }
    if (reported == 0 && _assetsReportedErrors.Count == 0) {
      Fail(
        Rel(_opts.EntryPath),
        $"`dotnet restore` failed with exit code {_restore.ExitCode}; run with --verbose to see its output",
        ""
      );
    }
  }

  private void Log(string message) {
    if (_opts.Verbose) Console.Error.WriteLine($"socket-facts-dotnet: {message}");
  }

  // Build-root-relative with `/`, the shape every record path takes.
  private string Rel(string path) => RelTo(_buildRoot, path);

  private static string RelTo(string root, string path) {
    var rel = Path.GetRelativePath(root, Path.GetFullPath(path)).Replace('\\', '/');
    return string.IsNullOrEmpty(rel) ? "." : rel;
  }

  private static bool SamePath(string a, string b) {
    return string.Equals(
      RealPaths.Of(a),
      RealPaths.Of(b),
      OperatingSystem.IsLinux() ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase
    );
  }

  private static bool IsSolution(string path) {
    var ext = Path.GetExtension(path);
    return ext.Equals(".sln", StringComparison.OrdinalIgnoreCase)
      || ext.Equals(".slnx", StringComparison.OrdinalIgnoreCase)
      || ext.Equals(".slnf", StringComparison.OrdinalIgnoreCase);
  }
}
