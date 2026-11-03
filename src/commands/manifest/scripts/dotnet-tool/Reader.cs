using System.Xml.Linq;
using Microsoft.Build.Construction;
using Microsoft.Build.Evaluation;
using Microsoft.Build.Exceptions;
using NuGet.Common;
using NuGet.Frameworks;
using NuGet.LibraryModel;
using NuGet.Packaging;
using NuGet.Packaging.Core;
using NuGet.ProjectModel;
using NuGet.Versioning;

namespace Socket.Facts.Dotnet;

// What every target of one project.assets.json shares.
internal sealed record Assets(
  // NuGet's own choice of a package's directory among the package folders;
  // null when a fallback folder restore used is gone.
  FallbackPackagePathResolver? Resolver,
  // Package libraries by lowercased name and version.
  Dictionary<(string Name, NuGetVersion? Version), LockFileLibrary> Libraries,
  // Lowercased project library name -> the project's key, and back.
  Dictionary<string, string> ProjectKeys,
  Dictionary<string, string> ProjectNames
);

internal sealed partial class Session {
  // The project type GUID in the ProjectTypeGuids of Visual Studio unit test
  // projects.
  private const string TestProjectTypeGuid = "3AC096D0-A1C2-E12C-1390-A8335801FDAB";

  // Package and project identities NuGet compares case-insensitively.
  private static string CoordId(string name, string version) =>
    $"{name.ToLowerInvariant()}:{version}";

  // Keys of projects whose assets file recorded restore errors of its own,
  // which say more than the restore's console errors for that project.
  private readonly HashSet<string> _assetsReportedErrors = new(StringComparer.Ordinal);
  // Read without current assets after a failed restore; see ReportRestoreErrors.
  private readonly List<string> _notRestored = new();

  private IEnumerable<string> ReadProject(ProjectInfo info, ProjectCollection collection) {
    var references = new List<string>();
    var project = Evaluate(info, collection);
    if (project == null) return references;
    info.Style = StyleOf(project, out var packagesConfig);
    if (info.Excluded) {
      // Not resolved, but kept projects depending on it still need its paths.
      if (_opts.WithFiles) {
        EmitProject(info, project);
        _records.ExcludedProject(info.Key);
        EmitPaths(info, project);
      }
      return references;
    }
    references.AddRange(ProjectReferences(project, innerBuilds: false));
    switch (info.Style) {
      case RestoreStyle.PackageReference:
        references.AddRange(ReadAssets(info, project));
        break;
      case RestoreStyle.PackagesConfig when packagesConfig != null:
        ReadPackagesConfig(info, project, packagesConfig);
        break;
      case RestoreStyle.ProjectJson:
        EmitProject(info, project);
        _records.Unscannable("", "project.json projects are not supported; migrate the project to PackageReference", info.Key);
        break;
      default:
        // No NuGet dependencies; still a module whose sources matter.
        EmitProject(info, project);
        if (_opts.WithFiles) EmitPaths(info, project);
        break;
    }
    return references;
  }

  // NuGet.targets' _RestoreProjectName: PackageId, then AssemblyName, for
  // the PackageReference style; the project name otherwise.
  private static string RestoreName(Project project, RestoreStyle style) {
    if (style == RestoreStyle.PackageReference) {
      foreach (var property in new[] { "PackageId", "AssemblyName" }) {
        var value = project.GetPropertyValue(property);
        if (!string.IsNullOrEmpty(value)) return value;
      }
    }
    return project.GetPropertyValue("MSBuildProjectName");
  }

  // NuGet.targets' _RestoreProjectVersion.
  private static string RestoreVersion(Project project) {
    var v = project.GetPropertyValue("PackageVersion");
    if (string.IsNullOrEmpty(v)) v = project.GetPropertyValue("Version");
    return string.IsNullOrEmpty(v) ? "1.0.0" : v;
  }

  // Named as restore names the project, unless its restore spec says.
  private void EmitProject(ProjectInfo info, Project project, string? name = null, string? version = null) {
    _records.Project(
      info.Key,
      name ?? RestoreName(project, info.Style),
      version ?? RestoreVersion(project),
      Rel(project.DirectoryPath)
    );
    EmitBuildFiles(info, project);
  }

  private IEnumerable<string> ReadAssets(ProjectInfo info, Project project) {
    var assetsPath = project.GetPropertyValue("ProjectAssetsFile");
    if (string.IsNullOrEmpty(assetsPath)) {
      assetsPath = Path.Combine(project.GetPropertyValue("MSBuildProjectExtensionsPath"), "project.assets.json");
    }
    assetsPath = Path.GetFullPath(assetsPath, project.DirectoryPath);
    // Null detail: ReportRestoreErrors reports the project with the failed restore.
    string[] Unscannable(string? detail) {
      EmitProject(info, project);
      if (detail == null) {
        _notRestored.Add(info.Key);
      } else {
        _records.Unscannable("", detail, info.Key);
      }
      return Array.Empty<string>();
    }
    if (!RestoredByThisRun(info, assetsPath) || !File.Exists(assetsPath)) {
      return Unscannable(
        _restore == null || _restore.Succeeded ? "`dotnet restore` wrote no project.assets.json for this project" : null
      );
    }

    var lockFile = LockFileUtilities.GetLockFile(assetsPath, NullLogger.Instance);
    var spec = lockFile?.PackageSpec;
    if (lockFile == null || spec == null) return Unscannable($"could not read {Rel(assetsPath)}");
    var owner = spec.RestoreMetadata?.ProjectPath;
    if (!string.IsNullOrEmpty(owner) && !SamePath(owner, info.FullPath)) {
      return Unscannable(
        $"{Rel(assetsPath)} belongs to {Rel(owner)}: the projects share an intermediate output directory, so each overwrites the other's restore output; give each its own, e.g. <BaseIntermediateOutputPath>obj/$(MSBuildProjectName)/</BaseIntermediateOutputPath> in Directory.Build.props"
      );
    }

    EmitProject(info, project, spec.Name, spec.Version?.ToNormalizedString());
    var lockFilePath = PackagesLockFileUtilities.GetNuGetLockFilePath(spec);
    if (!string.IsNullOrEmpty(lockFilePath) && File.Exists(lockFilePath)) {
      _records.ProjectBuild(info.Key, Rel(lockFilePath));
    }
    ReportLogErrors(info, lockFile);

    // Project libraries are ProjectReferences as restore resolved them.
    var projectKeys = new Dictionary<string, string>(StringComparer.Ordinal);
    var projectNames = new Dictionary<string, string>(StringComparer.Ordinal);
    var references = new List<string>();
    var libraries = new Dictionary<(string, NuGetVersion?), LockFileLibrary>();
    foreach (var library in NuGetShim.Seq<LockFileLibrary>(lockFile, "Libraries")) {
      if (string.IsNullOrEmpty(library.Name)) continue;
      libraries[(library.Name.ToLowerInvariant(), library.Version)] = library;
      if (!IsProject(library.Type)) continue;
      if (string.IsNullOrEmpty(library.MSBuildProject)) continue;
      var path = Path.GetFullPath(library.MSBuildProject, project.DirectoryPath);
      var key = Rel(path);
      projectKeys[library.Name.ToLowerInvariant()] = key;
      projectNames[key] = library.Name.ToLowerInvariant();
      references.Add(path);
    }
    var assets = new Assets(PackageResolver(lockFile), libraries, projectKeys, projectNames);

    var isTest = IsTestProject(project);
    foreach (var target in NuGetShim.Seq<LockFileTarget>(lockFile, "Targets")) {
      EmitTarget(info, spec, target, assets, isTest);
    }
    if (_opts.WithFiles) EmitPaths(info, project);
    return references;
  }

  // The resolver the .NET SDK builds from an assets file's package folders:
  // the first is the user's, the rest fallbacks.
  private static FallbackPackagePathResolver? PackageResolver(LockFile lockFile) {
    var folders = NuGetShim.Seq<LockFileItem>(lockFile, "PackageFolders")
      .Select(f => f.Path)
      .Where(p => !string.IsNullOrEmpty(p))
      .ToList();
    if (folders.Count == 0) return null;
    try {
      return new FallbackPackagePathResolver(folders[0], folders.Skip(1));
    } catch (PackagingException) {
      // A fallback folder restore used no longer exists.
      return null;
    }
  }

  // An assets or cache file's error-level restore messages, as failures of the
  // package they name.
  private void ReportLogErrors(ProjectInfo info, object owner) {
    foreach (var message in NuGetShim.Seq<IAssetsLogMessage>(owner, "LogMessages")) {
      if (message.Level != LogLevel.Error) continue;
      _assetsReportedErrors.Add(info.Key);
      _records.Failure(
        string.IsNullOrEmpty(message.LibraryId) ? info.Key : message.LibraryId,
        $"{message.Code}: {message.Message}",
        "",
        info.Key
      );
    }
  }

  // FAT records write times to 2 s.
  // https://learn.microsoft.com/en-us/windows/win32/sysinfo/file-times
  private static readonly TimeSpan MtimeResolution = TimeSpan.FromSeconds(2);

  // NuGet rewrites project.nuget.cache on every restore it performs but not an
  // unchanged assets file, so only the cache says whether this run restored it.
  // It skips the cache of a project it found up to date too, so after a failed
  // restore an older cache cannot tell such a project from one the restore
  // never reached: both count as not restored.
  // https://github.com/NuGet/NuGet.Client/blob/aa539166b2ff5abf970ee44281d73c96e3dbaa1a/src/NuGet.Core/NuGet.Commands/RestoreCommand/RequestFactory/NoOpRestoreResult.cs#L34-L35
  private bool RestoredByThisRun(ProjectInfo info, string assetsPath) {
    if (_restore == null || _restore.Succeeded) return true;
    var cachePath = Path.Combine(Path.GetDirectoryName(assetsPath)!, "project.nuget.cache");
    if (!File.Exists(cachePath) || File.GetLastWriteTimeUtc(cachePath) < _restore.StartedUtc - MtimeResolution) return false;
    using (var stream = File.OpenRead(cachePath)) {
      ReportLogErrors(info, CacheFileFormat.Read(stream, NullLogger.Instance, cachePath));
    }
    return true;
  }

  private static bool IsTestProject(Project project) {
    return string.Equals(project.GetPropertyValue("IsTestProject"), "true", StringComparison.OrdinalIgnoreCase)
      || project.GetPropertyValue("ProjectTypeGuids").Contains(TestProjectTypeGuid, StringComparison.OrdinalIgnoreCase);
  }

  // One resolution root per (target framework [/ runtime], prod|dev).
  private void EmitTarget(ProjectInfo info, PackageSpec spec, LockFileTarget target, Assets assets, bool isTest) {
    var framework = NuGetShim.Seq<TargetFrameworkInformation>(spec, "TargetFrameworks")
      .FirstOrDefault(f => f.FrameworkName.Equals(target.TargetFramework));
    var alias = framework?.TargetAlias;
    if (string.IsNullOrEmpty(alias)) alias = target.TargetFramework.GetShortFolderName();
    var rid = target.RuntimeIdentifier;
    var config = string.IsNullOrEmpty(rid) ? alias : $"{alias}/{rid}";
    // A runtime-specific target also answers to its framework's name, so a
    // filter on `net8.0` covers `net8.0/win-x64`.
    var names = string.IsNullOrEmpty(rid) ? new[] { config } : new[] { config, alias };
    if (!_configs.Matches(names)) return;
    if (_scanned.Add(config)) _records.Scanned(config);

    var libraries = new Dictionary<string, LockFileTargetLibrary>(StringComparer.Ordinal);
    var idByName = new Dictionary<string, string>(StringComparer.Ordinal);
    foreach (var lib in NuGetShim.Seq<LockFileTargetLibrary>(target, "Libraries")) {
      if (string.IsNullOrEmpty(lib.Name)) continue;
      var id = CoordId(lib.Name, lib.Version?.ToNormalizedString() ?? "");
      libraries[id] = lib;
      idByName[lib.Name.ToLowerInvariant()] = id;
    }
    var children = new Dictionary<string, List<string>>(StringComparer.Ordinal);
    foreach (var (id, lib) in libraries) {
      var kids = new List<string>();
      foreach (var dep in NuGetShim.Seq<PackageDependency>(lib, "Dependencies")) {
        if (idByName.TryGetValue(dep.Id.ToLowerInvariant(), out var child) && child != id && !kids.Contains(child)) {
          kids.Add(child);
        }
      }
      children[id] = kids;
    }

    // Direct dependencies are the project's own PackageReferences and
    // ProjectReferences.
    var direct = new HashSet<string>(StringComparer.Ordinal);
    foreach (var dep in NuGetShim.Seq<LibraryDependency>(framework, "Dependencies")) {
      if (!string.IsNullOrEmpty(dep.Name) && idByName.TryGetValue(dep.Name.ToLowerInvariant(), out var id)) direct.Add(id);
    }
    var restoreFramework = NuGetShim.Seq<ProjectRestoreMetadataFrameworkInfo>(spec.RestoreMetadata, "TargetFrameworks")
      .FirstOrDefault(f => f.FrameworkName.Equals(target.TargetFramework));
    foreach (var reference in NuGetShim.Seq<ProjectRestoreReference>(restoreFramework, "ProjectReferences")) {
      if (string.IsNullOrEmpty(reference.ProjectPath)) continue;
      var key = Rel(Path.GetFullPath(reference.ProjectPath, Path.GetDirectoryName(info.FullPath)!));
      if (assets.ProjectNames.TryGetValue(key, out var name) && idByName.TryGetValue(name, out var id)) direct.Add(id);
    }

    var reached = Reach(direct, children);
    var unreached = libraries.Keys.Where(k => !reached.Contains(k)).OrderBy(k => k).ToList();
    if (unreached.Count > 0) {
      _records.Failure(
        info.Key,
        $"restore resolved packages no direct dependency leads to: {string.Join(", ", unreached)}",
        config,
        info.Key
      );
    }

    // Prod is what reaches the build output after the include flags, plus
    // metapackages and packages that bring a shipped one in.
    var parents = new Dictionary<string, List<string>>(StringComparer.Ordinal);
    foreach (var (id, kids) in children) {
      foreach (var kid in kids) {
        if (!parents.TryGetValue(kid, out var list)) parents[kid] = list = new List<string>();
        list.Add(id);
      }
    }
    var shipped = new HashSet<string>(reached.Where(id => Delivers(assets, libraries[id])), StringComparer.Ordinal);
    for (var grew = true; grew;) {
      grew = false;
      foreach (var id in reached) {
        if (!shipped.Contains(id) && children[id].Any(shipped.Contains) && IsMetapackage(assets, libraries[id])) {
          grew |= shipped.Add(id);
        }
      }
    }
    var shippedChildren = children.ToDictionary(
      kv => kv.Key, kv => kv.Value.Where(shipped.Contains).ToList(), StringComparer.Ordinal
    );
    var viaShipped = Reach(new HashSet<string>(direct.Where(shipped.Contains), StringComparer.Ordinal), shippedChildren);
    shipped.UnionWith(Reach(new HashSet<string>(shipped.Except(viaShipped), StringComparer.Ordinal), parents));
    shipped.IntersectWith(reached);

    void EmitRoot(string kind, bool prod, HashSet<string> ids, bool withFiles) {
      if (ids.Count == 0) return;
      var rootId = $"{info.Key}|{config}|{kind}";
      _records.Root(rootId, info.Key, config, prod, target.TargetFramework.GetShortFolderName(), rid ?? "", alias);
      foreach (var id in ids.OrderBy(k => k, StringComparer.Ordinal)) {
        var lib = libraries[id];
        var isProject = IsProject(lib.Type);
        var projectKey = isProject && assets.ProjectKeys.TryGetValue(lib.Name!.ToLowerInvariant(), out var k) ? k : "";
        _records.Node(rootId, id, lib.Name!, lib.Version?.ToNormalizedString() ?? "", direct.Contains(id), projectKey);
        if (withFiles && !isProject) EmitPackageAssemblies(info, rootId, id, config, assets, lib);
        foreach (var child in children[id]) {
          if (ids.Contains(child)) _records.Edge(rootId, id, child);
        }
      }
    }
    // The whole graph once as dev, its shipped part again as prod: a package
    // is prod when any build of any project ships it. Everything a test
    // project resolves is dev.
    EmitRoot("all", false, reached, _opts.WithFiles);
    if (!isTest) EmitRoot("prod", true, shipped, false);
  }

  // Runtime assemblies (lib/, runtimes/<rid>/lib/) carry the method bodies an
  // analysis follows; compile-time ones (often ref/) are what the project's
  // own sources compile against.
  private void EmitPackageAssemblies(
    ProjectInfo info, string rootId, string id, string config, Assets assets, LockFileTargetLibrary lib
  ) {
    var runtime = AssetPaths(NuGetShim.Seq<LockFileItem>(lib, "RuntimeAssemblies")
      .Concat(NuGetShim.Seq<LockFileRuntimeTarget>(lib, "RuntimeTargets")
        .Where(t => string.Equals(t.AssetType, "runtime", StringComparison.OrdinalIgnoreCase))))
      .ToList();
    var compile = AssetPaths(NuGetShim.Seq<LockFileItem>(lib, "CompileTimeAssemblies")).ToList();
    if (runtime.Count == 0 && compile.Count == 0) return;
    var packageDir = assets.Resolver != null && lib.Version != null
      ? assets.Resolver.GetPackageDirectory(lib.Name!, lib.Version)
      : null;
    var missing = new List<string>();
    string? Resolve(string item) {
      var path = packageDir == null ? null : Path.GetFullPath(Path.Combine(packageDir, item));
      if (path != null && File.Exists(path)) return path;
      missing.Add(item);
      return null;
    }
    foreach (var item in runtime) {
      if (Resolve(item) is { } path) _records.File(rootId, id, path);
    }
    // Without its runtime assemblies the package is not installed; a missing
    // compile-time one still fails the run but leaves those in place.
    if (missing.Count > 0) _records.Unfetched(rootId, id);
    foreach (var item in compile) {
      if (Resolve(item) is { } path) _records.CompileFile(rootId, id, path);
    }
    if (missing.Count > 0) {
      _records.Failure(
        $"{lib.Name}:{lib.Version?.ToNormalizedString()}",
        $"assemblies restore listed are missing from the package folders ({missing[0]}{(missing.Count > 1 ? $" and {missing.Count - 1} more" : "")}); re-run `dotnet restore`",
        config,
        info.Key
      );
    }
  }

  private static HashSet<string> Reach(HashSet<string> seeds, Dictionary<string, List<string>> edges) {
    var seen = new HashSet<string>(seeds, StringComparer.Ordinal);
    var stack = new Stack<string>(seen);
    while (stack.Count > 0) {
      if (!edges.TryGetValue(stack.Pop(), out var next)) continue;
      foreach (var n in next) {
        if (seen.Add(n)) stack.Push(n);
      }
    }
    return seen;
  }

  private static readonly string[] OutputAssets =
    { "RuntimeAssemblies", "RuntimeTargets", "NativeLibraries", "ResourceAssemblies", "ContentFiles" };

  // An asset restore excluded through the include flags is listed as `_._`.
  private static IEnumerable<string> AssetPaths(IEnumerable<LockFileItem> items) => items
    .Select(i => i.Path)
    .Where(p => !string.IsNullOrEmpty(p) && Path.GetFileName(p) != "_._")
    .Distinct(StringComparer.Ordinal);

  private static bool IsProject(string? libraryType) =>
    string.Equals(libraryType, "project", StringComparison.OrdinalIgnoreCase);

  private static readonly string[] BuildAssets = { "Build", "BuildMultiTargeting" };

  // Active build files can copy anything into the output, as SqlClient.SNI's
  // copy its native DLLs; only a developmentDependency declaration rules it out.
  private bool Delivers(Assets assets, LockFileTargetLibrary lib) =>
    IsProject(lib.Type)
    || AssetPaths(OutputAssets.SelectMany(member => NuGetShim.Seq<LockFileItem>(lib, member))).Any()
    || (AssetPaths(BuildAssets.SelectMany(member => NuGetShim.Seq<LockFileItem>(lib, member))).Any()
      && !IsDevelopmentDependency(assets, lib));

  private readonly Dictionary<string, bool> _developmentDependency = new(StringComparer.Ordinal);

  // Unreadable counts as not declared, which keeps the package prod.
  private bool IsDevelopmentDependency(Assets assets, LockFileTargetLibrary lib) {
    if (assets.Resolver == null || lib.Version == null || string.IsNullOrEmpty(lib.Name)) return false;
    var nuspec = assets.Resolver.GetPackageInfo(lib.Name, lib.Version)?.PathResolver.GetManifestFilePath(lib.Name, lib.Version);
    if (nuspec == null) return false;
    if (_developmentDependency.TryGetValue(nuspec, out var known)) return known;
    var result = false;
    try {
      result = File.Exists(nuspec) && new NuspecReader(nuspec).GetDevelopmentDependency();
    } catch (Exception e) when (e is System.Xml.XmlException or PackagingException or IOException) {
      Log($"{nuspec}: {Text.FirstLine(e.Message)}");
    }
    _developmentDependency[nuspec] = result;
    return result;
  }

  // A package with no content of its own: every file it holds is package
  // metadata at its root (nuspec, signature, readme, licence).
  private static bool IsMetapackage(Assets assets, LockFileTargetLibrary lib) {
    if (IsProject(lib.Type)) return false;
    if (!assets.Libraries.TryGetValue((lib.Name!.ToLowerInvariant(), lib.Version), out var library)) return false;
    return NuGetShim.Seq<string>(library, "Files").All(file => !file.Contains('/') && !file.Contains('\\'));
  }

  // packages.config holds the pinned closure NuGet installed, without edges
  // or a direct/transitive split, so every package is a direct dependency of
  // a flat graph. developmentDependency="true" marks dev packages.
  private void ReadPackagesConfig(ProjectInfo info, Project project, string packagesConfig) {
    EmitProject(info, project);
    _records.ProjectBuild(info.Key, Rel(packagesConfig));
    if (_opts.WithFiles) EmitPaths(info, project);

    List<NuGet.Packaging.PackageReference> packages;
    try {
      packages = new NuGet.Packaging.PackagesConfigReader(XDocument.Load(packagesConfig))
        .GetPackages(allowDuplicatePackageIds: true)
        .ToList();
    } catch (Exception e) when (e is System.Xml.XmlException or PackagingException or ArgumentException) {
      _records.Unscannable("", $"could not read {Rel(packagesConfig)}: {Text.FirstLine(e.Message)}", info.Key);
      return;
    }
    if (packages.Count == 0) return;
    var config = LegacyFrameworkName(project);
    if (!_configs.Matches(config)) return;
    if (_scanned.Add(config)) _records.Scanned(config);

    var isTest = IsTestProject(project);
    var hintPaths = _opts.WithFiles ? HintPaths(project) : new List<string>();
    foreach (var dev in new[] { false, true }) {
      var selected = packages.Where(p => p.IsDevelopmentDependency == dev).ToList();
      if (selected.Count == 0) continue;
      var rootId = $"{info.Key}|{config}|{(dev ? "dev" : "prod")}";
      _records.Root(rootId, info.Key, config, !dev && !isTest, config, "", config);
      foreach (var pkg in selected.OrderBy(p => p.PackageIdentity.Id, StringComparer.OrdinalIgnoreCase)) {
        var identity = pkg.PackageIdentity;
        var version = identity.Version?.ToNormalizedString() ?? "";
        _records.Node(rootId, CoordId(identity.Id, version), identity.Id, version, direct: true, project: "");
        if (_opts.WithFiles) EmitHintPathAssemblies(info, rootId, config, identity, hintPaths);
      }
    }
  }

  // A packages.config project consumes a package's assemblies only through
  // its Reference HintPaths into `<packages>/<Id>.<Version>/`.
  private void EmitHintPathAssemblies(
    ProjectInfo info, string rootId, string config, PackageIdentity identity, List<string> hintPaths
  ) {
    var version = identity.Version?.ToNormalizedString() ?? "";
    var id = CoordId(identity.Id, version);
    var missing = new List<string>();
    foreach (var path in hintPaths.Where(p => InPackageFolder(p, identity))) {
      if (File.Exists(path)) {
        // A HintPath reference is both what compiles and what runs.
        _records.File(rootId, id, path);
        _records.CompileFile(rootId, id, path);
      } else {
        missing.Add(path);
      }
    }
    if (missing.Count > 0) {
      _records.Unfetched(rootId, id);
      _records.Failure(
        $"{identity.Id}:{version}",
        $"referenced assembly is not installed ({Rel(missing[0])}); restore the packages.config packages (`nuget restore`, or `msbuild -t:restore -p:RestorePackagesConfig=true`)",
        config,
        info.Key
      );
    }
  }

  private static bool InPackageFolder(string path, PackageIdentity identity) {
    var prefix = identity.Id + ".";
    foreach (var segment in path.Split(Path.DirectorySeparatorChar)) {
      if (segment.Length <= prefix.Length || !segment.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
      if (NuGetVersion.TryParse(segment.Substring(prefix.Length), out var v) && v.Equals(identity.Version)) return true;
    }
    return false;
  }

  private static List<string> HintPaths(Project project) {
    return project.GetItems("Reference")
      .Select(item => NormalizeSlashes(item.GetMetadataValue("HintPath")))
      .Where(h => !string.IsNullOrEmpty(h))
      .Select(h => Path.GetFullPath(h, project.DirectoryPath))
      .Distinct(StringComparer.Ordinal)
      .ToList();
  }

  // MSBuild only turns `\` into `/` on Unix when a value's first segment is
  // an existing directory, so a HintPath into a missing packages folder keeps
  // its backslashes.
  private static string NormalizeSlashes(string path) {
    return Path.DirectorySeparatorChar == '/' ? path.Replace('\\', '/') : path;
  }

  // NuGet's short folder name of a build's framework, as restore derives it
  // from the two monikers; null when unrecognized.
  private static string? ShortFrameworkName(Project build) {
    var moniker = build.GetPropertyValue("TargetFrameworkMoniker");
    if (string.IsNullOrEmpty(moniker)) return null;
    try {
      return NuGetFramework.ParseComponents(moniker, build.GetPropertyValue("TargetPlatformMoniker")).GetShortFolderName();
    } catch (ArgumentException) {
      return null;
    }
  }

  // Short folder name of a legacy project's single framework, e.g. net48.
  private static string LegacyFrameworkName(Project project) {
    if (ShortFrameworkName(project) is { } name) return name;
    var version = project.GetPropertyValue("TargetFrameworkVersion");
    return string.IsNullOrEmpty(version) ? "unknown" : $"net{version.TrimStart('v').Replace(".", "")}";
  }

  // Split as Microsoft.Common.CrossTargeting.targets does: trimmed, distinct
  // ignoring case. Empty for a single-framework project.
  private static List<string> Frameworks(Project project) {
    var multi = project.GetPropertyValue("TargetFrameworks");
    if (string.IsNullOrEmpty(project.GetPropertyValue("TargetFramework")) && !string.IsNullOrEmpty(multi)) {
      return multi.Split(';').Select(f => f.Trim()).Where(f => f.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }
    return new List<string>();
  }

  // Per inner build of a multi-targeting project, whose outer evaluation has
  // no Compile items or TargetPath, or of the project's single framework.
  private void EmitPaths(ProjectInfo info, Project project) {
    var multi = Frameworks(project);
    if (multi.Count == 0) {
      var single = project.GetPropertyValue("TargetFramework");
      var config = string.IsNullOrEmpty(single) ? LegacyFrameworkName(project) : single;
      if (_configs.Matches(config)) EmitBuild(info, project, config);
      return;
    }
    foreach (var tfm in multi.Where(_configs.Matches)) {
      Project build;
      try {
        build = LoadInnerBuild(project, tfm);
      } catch (InvalidProjectFileException e) {
        _records.Unscannable(tfm, $"could not evaluate the {tfm} build: {ErrorText(e)}", info.Key);
        continue;
      }
      EmitBuild(info, build, tfm);
    }
  }

  // As evaluation leaves it: sources that targets generate are absent.
  private void EmitBuild(ProjectInfo info, Project build, string config) {
    var language = build.GetPropertyValue("Language");
    var isFSharp = string.Equals(language, "F#", StringComparison.OrdinalIgnoreCase);
    var isVb = string.Equals(language, "VB", StringComparison.OrdinalIgnoreCase);
    var sources = isFSharp ? FSharpCompileOrder(build) : build.GetItems("Compile");
    foreach (var source in FullPaths(sources)) _records.ProjectSrc(info.Key, source, config);
    var targetPath = NormalizeSlashes(build.GetPropertyValue("TargetPath"));
    if (!string.IsNullOrEmpty(targetPath)) {
      _records.ProjectTgt(info.Key, Path.GetFullPath(targetPath, build.DirectoryPath), config);
    }
    foreach (var property in new[] { "TargetFrameworkMoniker", "Language", "LangVersion", "AssemblyName", "Nullable" }) {
      var value = build.GetPropertyValue(property);
      if (!string.IsNullOrEmpty(value)) _records.ProjectInfo(info.Key, config, property, value);
    }
    // Unrecognized, the alias stands in.
    if (ShortFrameworkName(build) is { } framework) {
      _records.ProjectInfo(info.Key, config, "Framework", framework);
    }
    foreach (var reference in build.GetItems("FrameworkReference").Select(i => i.EvaluatedInclude).Distinct()) {
      _records.ProjectInfo(info.Key, config, "FrameworkReference", reference);
    }
    foreach (var item in build.GetItems("Using")) {
      _records.ProjectUsing(
        info.Key, config, item.EvaluatedInclude, item.GetMetadataValue("Alias"),
        string.Equals(item.GetMetadataValue("Static"), "true", StringComparison.OrdinalIgnoreCase)
      );
    }
    // Vbc takes FinalDefineConstants, Csc and Fsc DefineConstants.
    var finalDefines = isVb ? build.GetPropertyValue("FinalDefineConstants") : "";
    var defines = finalDefines.Length > 0 ? finalDefines : build.GetPropertyValue("DefineConstants");
    foreach (var symbol in defines
               .Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries)
               .Select(s => s.Trim())
               .Where(s => s.Length > 0)
               .Distinct(StringComparer.Ordinal)) {
      _records.ProjectInfo(info.Key, config, "DefineConstant", symbol);
    }
  }

  private static IEnumerable<string> FullPaths(IEnumerable<ProjectItem> items) => items
    .Select(item => item.GetMetadataValue("FullPath"))
    .Where(full => !string.IsNullOrEmpty(full))
    .Select(full => Path.GetFullPath(full))
    .Distinct(StringComparer.Ordinal);

  // As the F# SDK's FSharpSourceCodeCompileOrder target orders them for Fsc.
  private static IEnumerable<ProjectItem> FSharpCompileOrder(Project build) {
    IEnumerable<ProjectItem> Ordered(string order) =>
      build.GetItems("Compile").Where(item => item.GetMetadataValue("CompileOrder") == order);
    return Ordered("CompileFirst")
      .Concat(build.GetItems("CompileBefore"))
      .Concat(Ordered("CompileBefore"))
      .Concat(Ordered(""))
      .Concat(Ordered("CompileAfter"))
      .Concat(build.GetItems("CompileAfter"))
      .Concat(Ordered("CompileLast"));
  }

  // The repository files declaring the project's dependencies; SDK- and
  // package-provided definitions are not the user's to change.
  private void EmitBuildFiles(ProjectInfo info, Project project) {
    _records.ProjectBuild(info.Key, info.Key);
    var foreign = new[] {
      "NetCoreRoot", "MSBuildExtensionsPath", "MSBuildSDKsPath", "MSBuildToolsPath", "NuGetPackageRoot",
    }
      .Select(project.GetPropertyValue)
      .Where(p => !string.IsNullOrEmpty(p))
      .Select(p => Path.TrimEndingDirectorySeparator(Path.GetFullPath(p)) + Path.DirectorySeparatorChar)
      .ToList();
    var definedIn = new HashSet<ProjectRootElement>();
    foreach (var itemType in new[] { "PackageReference", "PackageVersion", "GlobalPackageReference" }) {
      foreach (var item in project.GetItems(itemType)) {
        if (string.Equals(item.GetMetadataValue("IsImplicitlyDefined"), "true", StringComparison.OrdinalIgnoreCase)) continue;
        if (item.Xml?.ContainingProject is { } file) definedIn.Add(file);
      }
    }
    var files = new SortedSet<string>(StringComparer.Ordinal);
    foreach (var element in definedIn) {
      var file = element.FullPath;
      if (string.IsNullOrEmpty(file) || SamePath(file, info.FullPath)) continue;
      if (foreign.Any(root => file.StartsWith(root, StringComparison.OrdinalIgnoreCase))) continue;
      files.Add(Path.GetFullPath(file));
    }
    foreach (var file in files) _records.ProjectBuild(info.Key, Rel(file));
  }
}
