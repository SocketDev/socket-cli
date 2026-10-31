using System.Collections.Concurrent;
using System.Xml.Linq;
using Microsoft.Build.Construction;
using Microsoft.Build.Evaluation;
using Microsoft.Build.Exceptions;
using Microsoft.Build.Execution;
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

  private IEnumerable<string> ReadProject(ProjectInfo info, ProjectCollection collection) {
    var references = new List<string>();
    var project = Evaluate(info, collection, reportFailure: !info.Excluded);
    if (project == null) return references;
    info.Style = StyleOf(project, out info.PackagesConfigPath);
    if (info.Excluded) {
      // Not resolved, but kept projects depending on it still need its paths.
      if (_opts.WithFiles) {
        EmitProject(info, project);
        _records.ExcludedProject(info.Key);
        EmitPaths(info, project, Frameworks(project));
      }
      return references;
    }
    references.AddRange(ProjectReferences(project, innerBuilds: false));
    switch (info.Style) {
      case RestoreStyle.PackageReference:
        references.AddRange(ReadAssets(info, project));
        break;
      case RestoreStyle.PackagesConfig:
        ReadPackagesConfig(info, project);
        break;
      case RestoreStyle.ProjectJson:
        EmitProject(info, project);
        _records.Unscannable("", "project.json projects are not supported; migrate the project to PackageReference", info.Key);
        break;
      default:
        // No NuGet dependencies; still a module whose sources matter.
        EmitProject(info, project);
        if (_opts.WithFiles) EmitPaths(info, project, Frameworks(project));
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
    if (!RestoredByThisRun(info, assetsPath) || !File.Exists(assetsPath)) {
      EmitProject(info, project);
      // After a failed restore, its own errors say why (reported once all
      // projects are read).
      if (_restore == null || _restore.Succeeded) {
        _records.Unscannable("", "`dotnet restore` wrote no project.assets.json for this project", info.Key);
      }
      return Array.Empty<string>();
    }

    var lockFile = LockFileUtilities.GetLockFile(assetsPath, NullLogger.Instance);
    var spec = lockFile?.PackageSpec;
    if (lockFile == null || spec == null) {
      EmitProject(info, project);
      _records.Unscannable("", $"could not read {Rel(assetsPath)}", info.Key);
      return Array.Empty<string>();
    }
    var owner = spec.RestoreMetadata?.ProjectPath;
    if (!string.IsNullOrEmpty(owner) && !SamePath(owner, info.FullPath)) {
      EmitProject(info, project);
      _records.Unscannable(
        "",
        $"{Rel(assetsPath)} belongs to {Rel(owner)}: the projects share an intermediate output directory, so each overwrites the other's restore output; give each its own, e.g. <BaseIntermediateOutputPath>obj/$(MSBuildProjectName)/</BaseIntermediateOutputPath> in Directory.Build.props",
        info.Key
      );
      return Array.Empty<string>();
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
    var frameworks = new List<string>();
    foreach (var target in NuGetShim.Seq<LockFileTarget>(lockFile, "Targets")) {
      var alias = EmitTarget(info, spec, target, assets, isTest);
      if (alias != null && string.IsNullOrEmpty(target.RuntimeIdentifier)) frameworks.Add(alias);
    }
    if (_opts.WithFiles) EmitPaths(info, project, frameworks);
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
      Fail(
        string.IsNullOrEmpty(message.LibraryId) ? info.Key : message.LibraryId,
        $"{message.Code}: {message.Message}",
        "",
        info.Key
      );
    }
  }

  // NuGet rewrites project.nuget.cache on every restore it performs but not an
  // unchanged assets file, so only the cache says whether this run restored it.
  private bool RestoredByThisRun(ProjectInfo info, string assetsPath) {
    if (_restore == null || _restore.Succeeded) return true;
    var cachePath = Path.Combine(Path.GetDirectoryName(assetsPath)!, "project.nuget.cache");
    if (!File.Exists(cachePath)) return false;
    CacheFile cache;
    using (var stream = File.OpenRead(cachePath)) {
      cache = CacheFileFormat.Read(stream, NullLogger.Instance, cachePath);
    }
    if (File.GetLastWriteTimeUtc(cachePath) < _restore.StartedUtc) return cache.Success;
    ReportLogErrors(info, cache);
    return true;
  }

  private static bool IsTestProject(Project project) {
    return string.Equals(project.GetPropertyValue("IsTestProject"), "true", StringComparison.OrdinalIgnoreCase)
      || project.GetPropertyValue("ProjectTypeGuids").Contains(TestProjectTypeGuid, StringComparison.OrdinalIgnoreCase);
  }

  // One resolution root per (target framework [/ runtime], prod|dev). Returns
  // the target framework alias when the target was read.
  private string? EmitTarget(ProjectInfo info, PackageSpec spec, LockFileTarget target, Assets assets, bool isTest) {
    var framework = NuGetShim.Seq<TargetFrameworkInformation>(spec, "TargetFrameworks")
      .FirstOrDefault(f => f.FrameworkName.Equals(target.TargetFramework));
    var alias = framework?.TargetAlias;
    if (string.IsNullOrEmpty(alias)) alias = target.TargetFramework.GetShortFolderName();
    var rid = target.RuntimeIdentifier;
    var config = string.IsNullOrEmpty(rid) ? alias : $"{alias}/{rid}";
    // A runtime-specific target also answers to its framework's name, so a
    // filter on `net8.0` covers `net8.0/win-x64`.
    var names = string.IsNullOrEmpty(rid) ? new[] { config } : new[] { config, alias };
    if (!_configs.Matches(names)) return null;
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
      Fail(
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
    return alias;
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
      Fail(
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
  private void ReadPackagesConfig(ProjectInfo info, Project project) {
    EmitProject(info, project);
    _records.ProjectBuild(info.Key, Rel(info.PackagesConfigPath!));
    if (_opts.WithFiles) EmitPaths(info, project, Frameworks(project));

    List<NuGet.Packaging.PackageReference> packages;
    try {
      packages = new NuGet.Packaging.PackagesConfigReader(XDocument.Load(info.PackagesConfigPath!))
        .GetPackages(allowDuplicatePackageIds: true)
        .ToList();
    } catch (Exception e) when (e is System.Xml.XmlException or PackagingException or ArgumentException) {
      _records.Unscannable("", $"could not read {Rel(info.PackagesConfigPath!)}: {Text.FirstLine(e.Message)}", info.Key);
      return;
    }
    if (packages.Count == 0) return;
    var config = LegacyFrameworkName(project);
    if (!_configs.Matches(new[] { config })) return;
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
      Fail(
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
  private static string? ShortFrameworkName(Project build) =>
    ShortFrameworkName(build.GetPropertyValue("TargetFrameworkMoniker"), build.GetPropertyValue("TargetPlatformMoniker"));

  private static string? ShortFrameworkName(string moniker, string platformMoniker) {
    if (string.IsNullOrEmpty(moniker)) return null;
    try {
      return NuGetFramework.ParseComponents(moniker, platformMoniker).GetShortFolderName();
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

  // The inner builds of a multi-targeting project, by target framework; none
  // for a project with a single framework.
  private static List<string> Frameworks(Project project) {
    var multi = project.GetPropertyValue("TargetFrameworks");
    if (string.IsNullOrEmpty(project.GetPropertyValue("TargetFramework")) && !string.IsNullOrEmpty(multi)) {
      return multi.Split(';').Select(f => f.Trim()).Where(f => f.Length > 0).Distinct().ToList();
    }
    return new List<string>();
  }

  // Per inner build of a multi-targeting project, whose outer evaluation has
  // no Compile items or TargetPath, or of the project's single framework. An
  // excluded project is only evaluated, never built.
  private void EmitPaths(ProjectInfo info, Project project, List<string> frameworks) {
    var inner = frameworks.Where(f => _configs.Matches(new[] { f })).ToList();
    var single = project.GetPropertyValue("TargetFramework");
    if (inner.Count == 0 || !string.IsNullOrEmpty(single)) {
      EmitBuild(info, project, null, string.IsNullOrEmpty(single) ? LegacyFrameworkName(project) : single);
      return;
    }
    foreach (var tfm in inner) EmitBuild(info, project, tfm, tfm);
  }

  // Roslyn MSBuildWorkspace's design-time build, minus its command-line parsing:
  // https://github.com/dotnet/roslyn/blob/d53e65ceaf037efb4f0c43c5a2ae4a3e19f5a59f/src/Workspaces/MSBuild/BuildHost/Build/ProjectBuildManager.cs#L28-L58
  private static readonly Dictionary<string, string> DesignTimeProperties = new(StringComparer.OrdinalIgnoreCase) {
    ["BuildingProject"] = "false",
    ["BuildProjectReferences"] = "false",
    ["DesignTimeBuild"] = "true",
    ["ShouldUnsetParentConfigurationAndPlatform"] = "false",
    ["SkipCompilerExecution"] = "true",
  };

  // WPF's, which generates the XAML code-behind sources.
  private const string MarkupCompilationTarget = "DesignTimeMarkupCompilation";

  // As the compiler task receives it; a failed design-time build fails the
  // run, and leaves the evaluated values for --ignore-unresolved.
  private void EmitBuild(ProjectInfo info, Project project, string? innerFramework, string config) {
    var props = new Dictionary<string, string>(project.GlobalProperties, StringComparer.OrdinalIgnoreCase);
    if (innerFramework != null) props["TargetFramework"] = innerFramework;
    ProjectInstance? compiled = null;
    if (!info.Excluded) {
      var error = DesignTimeBuild(project, props, out compiled);
      if (error != null) {
        _records.ProjectInfo(info.Key, config, "BuildError", error);
        Fail(info.Key, $"the design-time build failed: {error}", config, info.Key);
      }
    }
    var instance = compiled;
    if (instance == null) {
      try {
        instance = EvaluatedWithImplicitDefines(innerFramework == null ? project : LoadInnerBuild(project, innerFramework));
      } catch (InvalidProjectFileException e) {
        _records.Unscannable(config, $"could not evaluate the {config} build: {Text.FirstLine(e.Message)}", info.Key);
        return;
      }
    }
    var language = instance.GetPropertyValue("Language");
    var isFSharp = string.Equals(language, "F#", StringComparison.OrdinalIgnoreCase);
    var isVb = string.Equals(language, "VB", StringComparison.OrdinalIgnoreCase);
    var sources = isFSharp ? FSharpCompileOrder(instance) : instance.GetItems("Compile");
    foreach (var source in FullPaths(sources)) _records.ProjectSrc(info.Key, source, config);
    var targetPath = NormalizeSlashes(instance.GetPropertyValue("TargetPath"));
    if (!string.IsNullOrEmpty(targetPath)) {
      _records.ProjectTgt(info.Key, Path.GetFullPath(targetPath, project.DirectoryPath), config);
    }
    foreach (var property in new[] { "TargetFrameworkMoniker", "Language", "LangVersion", "AssemblyName", "Nullable" }) {
      var value = instance.GetPropertyValue(property);
      if (!string.IsNullOrEmpty(value)) _records.ProjectInfo(info.Key, config, property, value);
    }
    // Unrecognized, the alias stands in.
    if (ShortFrameworkName(instance.GetPropertyValue("TargetFrameworkMoniker"), instance.GetPropertyValue("TargetPlatformMoniker")) is { } framework) {
      _records.ProjectInfo(info.Key, config, "Framework", framework);
    }
    foreach (var reference in instance.GetItems("FrameworkReference").Select(i => i.EvaluatedInclude).Distinct()) {
      _records.ProjectInfo(info.Key, config, "FrameworkReference", reference);
    }
    foreach (var item in instance.GetItems("Using")) {
      _records.ProjectUsing(
        info.Key, config, item.EvaluatedInclude, item.GetMetadataValue("Alias"),
        string.Equals(item.GetMetadataValue("Static"), "true", StringComparison.OrdinalIgnoreCase)
      );
    }
    // Csc, Vbc and Fsc all take ReferencePathWithRefAssemblies; Fsc takes no
    // Analyzer; Vbc takes FinalDefineConstants, the others DefineConstants.
    if (compiled != null) {
      foreach (var path in FullPaths(compiled.GetItems("ReferencePathWithRefAssemblies"))) {
        _records.ProjectInfo(info.Key, config, "Reference", path);
      }
      if (!isFSharp) {
        foreach (var path in FullPaths(compiled.GetItems("Analyzer"))) _records.ProjectInfo(info.Key, config, "Analyzer", path);
      }
    }
    var finalDefines = isVb ? instance.GetPropertyValue("FinalDefineConstants") : "";
    var defines = finalDefines.Length > 0 ? finalDefines : instance.GetPropertyValue("DefineConstants");
    foreach (var symbol in defines
               .Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries)
               .Select(s => s.Trim())
               .Where(s => s.Length > 0)
               .Distinct(StringComparer.Ordinal)) {
      _records.ProjectInfo(info.Key, config, "DefineConstant", symbol);
    }
  }

  // One build session for every build of the run, so a project that several
  // others reference is evaluated and asked for its output once.
  private BuildManager? _designTimeBuilds;
  private readonly FirstErrorLogger _designTimeErrors = new();

  private static IEnumerable<string> FullPaths(IEnumerable<ProjectItemInstance> items) => items
    .Select(item => item.GetMetadataValue("FullPath"))
    .Where(full => !string.IsNullOrEmpty(full))
    .Select(full => Path.GetFullPath(full))
    .Distinct(StringComparer.Ordinal);

  // As the F# SDK's FSharpSourceCodeCompileOrder target orders them for Fsc;
  // idempotent once that target has run.
  private static IEnumerable<ProjectItemInstance> FSharpCompileOrder(ProjectInstance instance) {
    IEnumerable<ProjectItemInstance> Ordered(string order) =>
      instance.GetItems("Compile").Where(item => item.GetMetadataValue("CompileOrder") == order);
    return Ordered("CompileFirst")
      .Concat(instance.GetItems("CompileBefore"))
      .Concat(Ordered("CompileBefore"))
      .Concat(Ordered(""))
      .Concat(Ordered("CompileAfter"))
      .Concat(instance.GetItems("CompileAfter"))
      .Concat(Ordered("CompileLast"));
  }

  // Null on success, else the build's first error. Any exception is one
  // build's failure, never the run's.
  private string? DesignTimeBuild(Project project, Dictionary<string, string> buildProperties, out ProjectInstance? instance) {
    instance = null;
    var props = new Dictionary<string, string>(buildProperties, StringComparer.OrdinalIgnoreCase);
    foreach (var (key, value) in DesignTimeProperties) props[key] = value;
    try {
      var result = BuildSession(project.ProjectCollection).BuildRequest(new BuildRequestData(
        project.FullPath,
        props,
        null,
        project.Targets.ContainsKey(MarkupCompilationTarget) ? new[] { "Compile", MarkupCompilationTarget } : new[] { "Compile" },
        null,
        BuildRequestDataFlags.ProvideProjectStateAfterBuild
      ));
      if (result.OverallResult == BuildResultCode.Success && result.ProjectStateAfterBuild is { } state) {
        instance = state;
        return null;
      }
      return _designTimeErrors.FirstOf(result.SubmissionId)
        ?? (result.Exception is { } failure ? Text.FirstLine(failure.Message) : "the Compile target failed");
    } catch (Exception e) {
      return Text.FirstLine(e.Message);
    }
  }

  // The SDK's implicit framework symbols (NET8_0_OR_GREATER, ...) exist only
  // once its AddImplicitDefineConstants target has run.
  private ProjectInstance EvaluatedWithImplicitDefines(Project build) {
    var instance = build.CreateProjectInstance();
    if (!instance.Targets.ContainsKey("AddImplicitDefineConstants")) return instance;
    try {
      BuildSession(build.ProjectCollection).BuildRequest(new BuildRequestData(instance, new[] { "AddImplicitDefineConstants" }));
    } catch (Exception e) {
      Log($"{build.FullPath}: implicit preprocessor symbols unavailable: {Text.FirstLine(e.Message)}");
    }
    return instance;
  }

  private BuildManager BuildSession(ProjectCollection collection) {
    if (_designTimeBuilds == null) {
      _designTimeBuilds = BuildManager.DefaultBuildManager;
      _designTimeBuilds.BeginBuild(new BuildParameters(collection) {
        Loggers = new Microsoft.Build.Framework.ILogger[] { _designTimeErrors },
        // Only errors are read; the engine then skips its other messages and
        // drops the tasks' before any logger sees them.
        OnlyLogCriticalEvents = true,
        ProjectLoadSettings = RestoreLoadSettings,
      });
    }
    return _designTimeBuilds;
  }

  private void EndDesignTimeBuilds() {
    _designTimeBuilds?.EndBuild();
    _designTimeBuilds = null;
  }

  private sealed class FirstErrorLogger : Microsoft.Build.Framework.ILogger {
    private readonly ConcurrentDictionary<int, string> _first = new();
    public Microsoft.Build.Framework.LoggerVerbosity Verbosity { get; set; } = Microsoft.Build.Framework.LoggerVerbosity.Quiet;
    public string? Parameters { get; set; }

    public string? FirstOf(int submissionId) => _first.TryGetValue(submissionId, out var e) ? e : null;

    public void Initialize(Microsoft.Build.Framework.IEventSource eventSource) {
      eventSource.ErrorRaised += (_, e) => _first.TryAdd(
        e.BuildEventContext?.SubmissionId ?? -1,
        string.IsNullOrEmpty(e.Code) ? e.Message : $"{e.Code}: {e.Message}"
      );
    }

    public void Shutdown() { }
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
