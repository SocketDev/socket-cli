using System.Text.Json;
using Microsoft.Build.Construction;

namespace Socket.Facts.Dotnet;

// A solution entry: its MSBuild-format members, and the global properties
// MSBuild's solution metaproject passes each of them (Solution* properties
// and the project configuration the active solution configuration maps to).
internal sealed class SolutionContext {
  public readonly Dictionary<string, ProjectInSolution> Members = new(StringComparer.Ordinal);
  private readonly string _solutionPath;
  private readonly string _configurationKey;

  public SolutionContext(string entry, IReadOnlyDictionary<string, string> globalProperties) {
    // A filter (.slnf) names its solution; the Solution* properties describe
    // that solution, as when MSBuild builds the filter.
    HashSet<string>? filtered = null;
    _solutionPath = entry;
    if (entry.EndsWith(".slnf", StringComparison.OrdinalIgnoreCase)) {
      (_solutionPath, filtered) = ReadFilter(entry);
    }
    var solution = SolutionFile.Parse(_solutionPath);
    var configuration = globalProperties.TryGetValue("Configuration", out var c) && c.Length > 0
      ? c
      : solution.GetDefaultConfigurationName();
    var platform = globalProperties.TryGetValue("Platform", out var p) && p.Length > 0
      ? p
      : solution.GetDefaultPlatformName();
    _configurationKey = $"{configuration}|{platform}";
    // Like the solution's own build, restore covers only the projects the
    // active solution configuration builds; a solution without
    // configurations builds them all.
    var configured = solution.SolutionConfigurations.Count > 0;
    foreach (var project in solution.ProjectsInOrder) {
      if (!IsMSBuildProject(project)) continue;
      if (configured
          && !(project.ProjectConfigurations.TryGetValue(_configurationKey, out var mapping) && mapping.IncludeInBuild)) {
        continue;
      }
      var full = Path.GetFullPath(project.AbsolutePath);
      if (filtered != null && !filtered.Contains(full)) continue;
      if (File.Exists(full)) Members[full] = project;
    }
  }

  public void Apply(string projectPath, Dictionary<string, string> props) {
    props["SolutionDir"] = Path.GetDirectoryName(_solutionPath) + Path.DirectorySeparatorChar;
    props["SolutionExt"] = Path.GetExtension(_solutionPath);
    props["SolutionFileName"] = Path.GetFileName(_solutionPath);
    props["SolutionName"] = Path.GetFileNameWithoutExtension(_solutionPath);
    props["SolutionPath"] = _solutionPath;
    if (Members.TryGetValue(projectPath, out var member)
        && member.ProjectConfigurations.TryGetValue(_configurationKey, out var mapped)) {
      props["Configuration"] = mapped.ConfigurationName;
      props["Platform"] = mapped.PlatformName;
    }
  }

  // A temporary solution filter over `members`, for restoring a subset of the
  // solution with the solution's own context.
  public string WriteFilter(IReadOnlyList<string> members) {
    var solutionDir = Path.GetDirectoryName(_solutionPath)!;
    var path = Path.Combine(Path.GetTempPath(), $"socket-facts-{Guid.NewGuid():N}.slnf");
    var doc = new {
      solution = new {
        path = _solutionPath,
        projects = members
          .Select(m => Members.TryGetValue(m, out var p) ? p.RelativePath : Path.GetRelativePath(solutionDir, m))
          .ToArray(),
      },
    };
    File.WriteAllText(path, JsonSerializer.Serialize(doc));
    return path;
  }

  // Solution folders, website folders and shared projects (.shproj, imported
  // into others) are not projects MSBuild builds on their own.
  private static bool IsMSBuildProject(ProjectInSolution project) {
    return project.ProjectType == SolutionProjectType.KnownToBeMSBuildFormat
      || (project.ProjectType == SolutionProjectType.Unknown
        && project.AbsolutePath.EndsWith("proj", StringComparison.OrdinalIgnoreCase));
  }

  // A solution filter: {"solution": {"path": <sln>, "projects": [<paths
  // relative to the solution>]}}.
  private static (string Solution, HashSet<string> Projects) ReadFilter(string filter) {
    using var doc = JsonDocument.Parse(File.ReadAllText(filter));
    var solution = doc.RootElement.GetProperty("solution");
    var solutionPath = FullPath(Path.GetDirectoryName(filter)!, solution.GetProperty("path").GetString() ?? "");
    var solutionDir = Path.GetDirectoryName(solutionPath)!;
    var projects = new HashSet<string>(StringComparer.Ordinal);
    if (solution.TryGetProperty("projects", out var list)) {
      foreach (var p in list.EnumerateArray()) {
        if (p.GetString() is { Length: > 0 } rel) projects.Add(FullPath(solutionDir, rel));
      }
    }
    return (solutionPath, projects);
  }

  private static string FullPath(string dir, string rel) {
    return Path.GetFullPath(Path.Combine(dir, rel.Replace('\\', Path.DirectorySeparatorChar)));
  }
}
