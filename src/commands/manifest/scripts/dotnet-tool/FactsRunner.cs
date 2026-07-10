using System.Text.RegularExpressions;
using Microsoft.Build.Evaluation;
using Microsoft.Build.Execution;
using Microsoft.Build.Framework;
using Microsoft.Build.Graph;
using NuGet.Common;
using NuGet.LibraryModel;
using NuGet.Packaging;
using NuGet.ProjectModel;
using NuGet.Protocol;
using NuGet.Protocol.Core.Types;

namespace Socket.Facts.Dotnet;

// Single-session facts producer: evaluate -> restore -> read, all under ONE
// global-property bag (the user's -p: opts), so restore and the emitted graph
// can never describe different builds. Fail-closed by contract with the CLI:
// this tool records failures instead of throwing; the TypeScript side renders
// them and raises the exit code.
internal static class FactsRunner {
  private const string TestHostPackage = "microsoft.net.test.sdk";

  public static int Run(ToolOptions opts, string sdkVersion) {
    using var records = new RecordsWriter(opts.RecordsPath);
    try {
      records.Meta(sdkVersion);
      new Session(opts, records).Execute();
      return 0;
    } catch (Exception e) {
      // Catastrophic only: per-project problems become failure records inside
      // Execute. A hard crash returns non-zero with the partial records left
      // in place; the CLI treats it as a crashed build.
      Console.Error.WriteLine($"socket-facts-dotnet: {e}");
      return 1;
    }
  }

  private sealed class Session(ToolOptions opts, RecordsWriter records) {
    private readonly List<Regex> _includes = ParsePatterns(opts.IncludeConfigs);
    private readonly List<Regex> _excludes = ParsePatterns(opts.ExcludeConfigs);
    private readonly HashSet<string> _scanned = new(StringComparer.Ordinal);

    // Restore eligibility per evaluated project, keyed by full path. Decided
    // the way NuGet's own restore decides — from the project model, not file
    // paths — so legacy no-dependency projects and packages.config projects
    // are never sent to (or blamed by) a Restore build.
    private readonly Dictionary<string, bool> _restoreSupported =
      new(StringComparer.Ordinal);

    public void Execute() {
      var entries = Discover();
      if (entries.Count == 0) {
        Log("no solution or project files found at the top level");
        return;
      }

      var graphs = EvaluateGraphs(entries);
      var projectPaths = graphs.ProjectPaths;
      if (!opts.NoRestore) {
        // A standalone project restores only if it supports restore; a
        // solution restores if ANY member does (NuGet skips the rest).
        var restorable = graphs.Entries
          .Where(e => e.AnyRestoreSupported)
          .Select(e => e.Path)
          .ToList();
        if (restorable.Count > 0) {
          Restore(restorable);
        }
      }
      foreach (var projectPath in projectPaths) {
        ReadProject(projectPath);
      }
    }

    // NuGet's documented packages.config lookup: `packages.<project_name>.config`
    // (spaces replaced with underscores) takes precedence over `packages.config`
    // in the project directory.
    private static string? FindPackagesConfig(string projectPath) {
      var dir = Path.GetDirectoryName(projectPath)!;
      var projectName = Path.GetFileNameWithoutExtension(projectPath).Replace(' ', '_');
      var perProject = Path.Combine(dir, $"packages.{projectName}.config");
      if (File.Exists(perProject)) return perProject;
      var shared = Path.Combine(dir, "packages.config");
      return File.Exists(shared) ? shared : null;
    }

    // Mirrors NuGet's own eligibility model: PackageReference items (also
    // valid in legacy-format projects), an explicit RestoreProjectStyle, or
    // an SDK-style project. packages.config presence vetoes: NuGet restores
    // those only via msbuild -t:restore on Windows, and the manifest is
    // self-contained for our purposes.
    private static bool IsRestoreSupported(ProjectInstance instance) {
      var fullPath = instance.FullPath;
      if (!string.IsNullOrEmpty(fullPath) && FindPackagesConfig(fullPath) != null) {
        return false;
      }
      if (instance.GetItems("PackageReference").Any()) return true;
      if (string.Equals(
            instance.GetPropertyValue("RestoreProjectStyle"), "PackageReference",
            StringComparison.OrdinalIgnoreCase)) {
        return true;
      }
      return string.Equals(
        instance.GetPropertyValue("UsingMicrosoftNETSdk"), "true",
        StringComparison.OrdinalIgnoreCase);
    }

    // Case-insensitive so Linux agrees with the CLI's detection (App.SLN is a
    // valid solution file there too).
    private static readonly EnumerationOptions TopLevelIgnoreCase = new() {
      MatchCasing = MatchCasing.CaseInsensitive,
      RecurseSubdirectories = false,
    };

    // Top-level only, matching every other `socket manifest` producer: the
    // command runs where the build runs; it does not walk the filesystem.
    private List<string> Discover() {
      var slns = Directory.EnumerateFiles(opts.RootDir, "*.sln", TopLevelIgnoreCase)
        .Concat(Directory.EnumerateFiles(opts.RootDir, "*.slnx", TopLevelIgnoreCase))
        .OrderBy(p => p, StringComparer.Ordinal)
        .ToList();
      if (slns.Count > 0) return slns;
      return Directory.EnumerateFiles(opts.RootDir, "*.*proj", TopLevelIgnoreCase)
        .Where(IsProjectFile)
        .OrderBy(p => p, StringComparer.Ordinal)
        .ToList();
    }

    private sealed record GraphSummary(
      List<(string Path, bool AnyRestoreSupported)> Entries,
      List<string> ProjectPaths
    );

    // Walks project graphs (solutions expand to their member projects, and
    // project references pull in projects outside the top-level dir) to find
    // every project this build covers, recording restore eligibility from the
    // evaluated instances along the way.
    private GraphSummary EvaluateGraphs(List<string> entries) {
      var entrySummaries = new List<(string Path, bool AnyRestoreSupported)>();
      var projectPaths = new SortedSet<string>(StringComparer.Ordinal);
      foreach (var entry in entries) {
        var anySupported = false;
        try {
          var collection = new ProjectCollection(opts.GlobalProperties);
          var graph = new ProjectGraph(
            new[] { new ProjectGraphEntryPoint(entry, opts.GlobalProperties) },
            collection,
            CreateInstance
          );
          foreach (var node in graph.ProjectNodes) {
            var fullPath = node.ProjectInstance.FullPath;
            if (string.IsNullOrEmpty(fullPath) || !IsProjectFile(fullPath)) {
              continue;
            }
            fullPath = Path.GetFullPath(fullPath);
            projectPaths.Add(fullPath);
            var supported = IsRestoreSupported(node.ProjectInstance);
            _restoreSupported[fullPath] = supported;
            anySupported |= supported;
          }
        } catch (Exception e) {
          records.Failure(Rel(entry), $"could not load the project graph: {FirstLine(e.Message)}", "");
        }
        entrySummaries.Add((entry, anySupported));
      }
      return new GraphSummary(entrySummaries, projectPaths.ToList());
    }

    private ProjectInstance CreateInstance(
      string fullPath, Dictionary<string, string> globalProperties, ProjectCollection collection
    ) {
      try {
        // Pre-restore, the generated nuget.g.props imports may not exist yet.
        var project = new Project(
          fullPath, globalProperties, toolsVersion: null, collection,
          ProjectLoadSettings.IgnoreMissingImports
        );
        return project.CreateProjectInstance();
      } catch (Exception e) {
        records.Failure(Rel(fullPath), $"could not evaluate the project: {FirstLine(e.Message)}", "");
        return new Project(collection).CreateProjectInstance();
      }
    }

    // Restore-only global properties: a metadata scan wants the resolved graph,
    // not the project's build-warning policy. `TreatWarningsAsErrors=false`
    // stops a project from promoting a NuGet warning to a fatal error and
    // aborting the whole run — most notably NU1902/NU1903/NU1904 security
    // advisories, which a Socket scan should surface as findings, never choke
    // on. Ours wins over any user `-p:` value: warning-as-error is never what
    // an SBOM run wants. Restore-scoped (not folded into opts.GlobalProperties)
    // so the post-restore re-evaluation still sees the project's real settings.
    private Dictionary<string, string> RestoreProperties() {
      return new Dictionary<string, string>(opts.GlobalProperties, StringComparer.OrdinalIgnoreCase) {
        ["TreatWarningsAsErrors"] = "false",
        ["MSBuildTreatWarningsAsErrors"] = "false",
      };
    }

    private void Restore(List<string> entries) {
      var restoreProps = RestoreProperties();
      var errorCapture = new ErrorCaptureLogger();
      var bm = BuildManager.DefaultBuildManager;
      bm.BeginBuild(new BuildParameters(new ProjectCollection(restoreProps)) {
        Loggers = new Microsoft.Build.Framework.ILogger[] { errorCapture },
        EnableNodeReuse = false,
      });
      var submissions = new List<(string Entry, BuildSubmission Submission)>();
      try {
        foreach (var entry in entries) {
          var request = new BuildRequestData(
            entry, restoreProps, targetsToBuild: new[] { "Restore" },
            toolsVersion: null, hostServices: null
          );
          var submission = bm.PendBuildRequest(request);
          submission.ExecuteAsync(callback: null, context: null);
          submissions.Add((entry, submission));
        }
        var deadline = DateTime.UtcNow.AddSeconds(opts.RestoreTimeoutSec);
        var timedOut = false;
        var cancelled = new HashSet<BuildSubmission>();
        foreach (var (entry, submission) in submissions) {
          // A submission that already finished is never a timeout, even when
          // an earlier one exhausted the budget.
          if (submission.IsCompleted) continue;
          var remaining = deadline - DateTime.UtcNow;
          if (timedOut || remaining <= TimeSpan.Zero || !submission.WaitHandle.WaitOne(remaining)) {
            if (!timedOut) {
              timedOut = true;
              bm.CancelAllSubmissions();
            }
            cancelled.Add(submission);
            records.Failure(
              Rel(entry),
              $"restore did not finish within {opts.RestoreTimeoutSec}s and was cancelled",
              ""
            );
          }
        }
        if (timedOut) {
          // Give cancelled submissions a moment to unwind before EndBuild.
          foreach (var (_, submission) in submissions) {
            submission.WaitHandle.WaitOne(TimeSpan.FromSeconds(30));
          }
        }
        _cancelledSubmissions = cancelled;
      } finally {
        bm.EndBuild();
      }
      foreach (var error in errorCapture.Errors) {
        // Restore errors attributed to projects that don't support restore
        // (packages.config, legacy no-dependency) are noise: the reader path
        // handles those without restore, while a solution restore still
        // visits them and can fail on VS-only imports like
        // Microsoft.WebApplication.targets.
        if (Path.IsPathRooted(error.Coord)
            && _restoreSupported.TryGetValue(Path.GetFullPath(error.Coord), out var supported)
            && !supported) {
          continue;
        }
        records.Failure(error.Coord, error.Detail, "");
      }
      foreach (var (entry, submission) in submissions) {
        if (submission.IsCompleted
            && !_cancelledSubmissions.Contains(submission)
            && submission.BuildResult?.OverallResult == BuildResultCode.Failure
            && errorCapture.Errors.Count == 0) {
          records.Failure(Rel(entry), "restore failed (run with --verbose for the build output)", "");
        }
      }
    }

    private HashSet<BuildSubmission> _cancelledSubmissions = new();

    private void ReadProject(string projectPath) {
      Log($"reading {Rel(projectPath)}");
      Project project;
      // Fresh evaluation post-restore so the generated nuget.g.props imports
      // are picked up; a fresh collection per project keeps evaluations
      // independent of graph-time state.
      var collection = new ProjectCollection(opts.GlobalProperties);
      try {
        project = new Project(
          projectPath, opts.GlobalProperties, toolsVersion: null, collection,
          ProjectLoadSettings.IgnoreMissingImports
        );
      } catch (Exception e) {
        records.Failure(Rel(projectPath), $"could not evaluate the project: {FirstLine(e.Message)}", "");
        return;
      }

      var pkgConfigPath = FindPackagesConfig(projectPath);
      if (pkgConfigPath != null) {
        ReadPackagesConfigProject(project, projectPath, pkgConfigPath);
        return;
      }

      var assetsPath = project.GetPropertyValue("ProjectAssetsFile");
      if (string.IsNullOrEmpty(assetsPath)) {
        var objDir = project.GetPropertyValue("MSBuildProjectExtensionsPath");
        assetsPath = string.IsNullOrEmpty(objDir)
          ? Path.Combine(Path.GetDirectoryName(projectPath)!, "obj", "project.assets.json")
          : Path.Combine(objDir, "project.assets.json");
      }
      assetsPath = Path.GetFullPath(assetsPath, Path.GetDirectoryName(projectPath)!);
      if (!File.Exists(assetsPath)) {
        if (project.GetItems("PackageReference").Count == 0
            && !string.Equals(project.GetPropertyValue("UsingMicrosoftNETSdk"), "true", StringComparison.OrdinalIgnoreCase)) {
          // No NuGet dependencies at all (e.g. GAC-only legacy project): still
          // a first-party module whose sources matter, just nothing to resolve.
          EmitBareProject(project, projectPath);
        } else {
          records.Failure(Rel(projectPath), "restore produced no project.assets.json for this project", "");
        }
        return;
      }

      var lockFile = LockFileUtilities.GetLockFile(assetsPath, NullLogger.Instance);
      if (lockFile?.PackageSpec == null) {
        records.Failure(Rel(projectPath), $"could not parse {Rel(assetsPath)}", "");
        return;
      }

      var projectKey = projectPath;
      var projectName = lockFile.PackageSpec.Name ?? Path.GetFileNameWithoutExtension(projectPath);
      var projectVersion = lockFile.PackageSpec.Version?.ToNormalizedString() ?? "";
      records.Project(projectKey, projectName, projectVersion, Rel(Path.GetDirectoryName(projectPath)!));

      foreach (var message in lockFile.LogMessages ?? Enumerable.Empty<IAssetsLogMessage>()) {
        if (message.Level == LogLevel.Error) {
          records.Failure(
            string.IsNullOrEmpty(message.LibraryId) ? projectName : message.LibraryId,
            $"{message.Code}: {message.Message}",
            ""
          );
        }
      }

      var isTestProject =
        string.Equals(project.GetPropertyValue("IsTestProject"), "true", StringComparison.OrdinalIgnoreCase)
        || lockFile.PackageSpec.TargetFrameworks.Any(f =>
          DependenciesOf(f).Any(d => string.Equals(d.Name, TestHostPackage, StringComparison.OrdinalIgnoreCase)));

      if (opts.WithFiles) {
        EmitProjectSources(projectKey, projectPath, project);
        EmitProjectTargets(projectKey, projectPath, project, collection, lockFile);
      }

      foreach (var target in lockFile.Targets) {
        EmitTarget(projectKey, projectName, lockFile, target, isTestProject);
      }
    }

    // The project dir is the base source root; evaluated Compile items catch
    // linked sources living OUTSIDE it (`<Compile Include="../shared/..">`),
    // which the dir alone would miss. Exclude-globs within the dir are not
    // modeled (the dir over-approximates); refine with per-file paths if the
    // sidecar consumer ever wants exact sets.
    private void EmitProjectSources(string projectKey, string projectPath, Project project) {
      var projectDir = Path.GetDirectoryName(projectPath)!;
      records.ProjectSrc(projectKey, projectDir);
      var external = new SortedSet<string>(StringComparer.Ordinal);
      foreach (var item in project.GetItems("Compile")) {
        string full;
        try {
          full = item.GetMetadataValue("FullPath");
        } catch {
          continue;
        }
        if (string.IsNullOrEmpty(full)) continue;
        var dir = Path.GetDirectoryName(Path.GetFullPath(full));
        if (dir != null && !IsUnder(dir, projectDir)) {
          external.Add(dir);
        }
      }
      foreach (var dir in external) {
        records.ProjectSrc(projectKey, dir);
      }
    }

    private static bool IsUnder(string path, string root) {
      var rel = Path.GetRelativePath(root, path);
      return rel == "." || (!rel.StartsWith("..", StringComparison.Ordinal) && !Path.IsPathRooted(rel));
    }

    private void EmitBareProject(Project project, string projectPath) {
      var projectKey = projectPath;
      records.Project(
        projectKey,
        Path.GetFileNameWithoutExtension(projectPath),
        "",
        Rel(Path.GetDirectoryName(projectPath)!)
      );
      if (opts.WithFiles) {
        EmitProjectSources(projectKey, projectPath, project);
        var targetPath = NormalizeSlashes(project.GetPropertyValue("TargetPath"));
        if (!string.IsNullOrEmpty(targetPath)) {
          records.ProjectTgt(projectKey, Path.GetFullPath(targetPath, Path.GetDirectoryName(projectPath)!));
        }
      }
    }

    // Legacy packages.config: the manifest itself is the full pinned closure
    // (NuGet resolved it at install time), so no restore is needed for
    // completeness — the graph is flat (no edge data in the manifest) and
    // every package is emitted as direct. `developmentDependency="true"`
    // feeds the dev split; installed DLLs come from evaluated Reference
    // HintPaths when the packages folder is present.
    private void ReadPackagesConfigProject(Project project, string projectPath, string pkgConfigPath) {
      var projectKey = projectPath;
      records.Project(
        projectKey,
        Path.GetFileNameWithoutExtension(projectPath),
        "",
        Rel(Path.GetDirectoryName(projectPath)!)
      );
      if (opts.WithFiles) {
        EmitProjectSources(projectKey, projectPath, project);
        var targetPath = NormalizeSlashes(project.GetPropertyValue("TargetPath"));
        if (!string.IsNullOrEmpty(targetPath)) {
          records.ProjectTgt(projectKey, Path.GetFullPath(targetPath, Path.GetDirectoryName(projectPath)!));
        }
      }

      List<NuGet.Packaging.PackageReference> packages;
      try {
        using var stream = File.OpenRead(pkgConfigPath);
        packages = new NuGet.Packaging.PackagesConfigReader(stream)
          .GetPackages(allowDuplicatePackageIds: true)
          .ToList();
      } catch (Exception e) {
        records.Failure(Rel(pkgConfigPath), $"could not parse packages.config: {FirstLine(e.Message)}", "");
        return;
      }
      if (packages.Count == 0) return;

      var config = LegacyFrameworkConfigName(project);
      if (!ConfigMatches(new[] { config })) return;
      if (_scanned.Add(config)) records.Scanned(config);

      // DLL paths per package folder segment (`<id>.<version>`), from the
      // evaluated References' HintPaths.
      var dllsBySegment = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
      if (opts.WithFiles) {
        foreach (var item in project.GetItems("Reference")) {
          // Normalize explicitly: MSBuild's unix slash-adjustment for metadata
          // is existence-gated, so HintPaths keep raw backslashes precisely
          // when the packages folder is missing — the download case.
          var hint = NormalizeSlashes(item.GetMetadataValue("HintPath"));
          if (string.IsNullOrEmpty(hint)) continue;
          var full = Path.GetFullPath(hint, Path.GetDirectoryName(projectPath)!);
          foreach (var segment in full.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries)) {
            if (!dllsBySegment.TryGetValue(segment, out var list)) dllsBySegment[segment] = list = new List<string>();
            list.Add(full);
          }
        }
        // Packages whose HintPath'd assemblies aren't on disk get downloaded
        // into the same packages folder the HintPaths reference — exactly what
        // `nuget restore` would populate. Versions are pinned by the manifest,
        // so there is no resolution to redo, and a failed download becomes a
        // blocking failure record (matching the Maven/Gradle scripts).
        if (!opts.NoRestore) {
          var missing = new List<NuGet.Packaging.PackageReference>();
          string? packagesRoot = null;
          foreach (var pkg in packages) {
            var segment = FolderSegment(pkg);
            if (segment == null || !dllsBySegment.TryGetValue(segment, out var dlls)) continue;
            var absent = dlls.FirstOrDefault(d => !File.Exists(d));
            if (absent == null) continue;
            missing.Add(pkg);
            packagesRoot ??= DerivePackagesRoot(absent, segment);
          }
          if (missing.Count > 0) {
            if (packagesRoot == null) {
              records.Failure(
                Rel(projectPath),
                "could not locate the packages folder from the project's HintPaths; run a NuGet restore",
                config
              );
            } else {
              DownloadPackagesConfigArtifacts(
                Path.GetDirectoryName(projectPath)!, packagesRoot, missing, config
              );
            }
          }
        }
      }

      var emitted = new[] {
        (Kind: "prod", Packages: packages.Where(p => !p.IsDevelopmentDependency).ToList()),
        (Kind: "dev", Packages: packages.Where(p => p.IsDevelopmentDependency).ToList()),
      };
      foreach (var (kind, kindPackages) in emitted) {
        if (kindPackages.Count == 0) continue;
        var rootId = $"{projectKey}|{config}|{kind}";
        records.Root(rootId, projectKey, config, kind == "prod");
        foreach (var pkg in kindPackages.OrderBy(p => p.PackageIdentity.Id, StringComparer.OrdinalIgnoreCase)) {
          var id = pkg.PackageIdentity.Id;
          var version = pkg.PackageIdentity.Version?.ToNormalizedString() ?? "";
          var coord = CoordIdOf(id, version);
          // The flat closure carries no edges, so direct-vs-transitive is
          // unknowable from the manifest alone; every package is direct, the
          // same over-approximation cdxgen makes.
          records.Node(rootId, coord, id, version, direct: true);
          var segment = FolderSegment(pkg);
          if (opts.WithFiles && segment != null && dllsBySegment.TryGetValue(segment, out var dlls)) {
            foreach (var dll in dlls) {
              if (File.Exists(dll)) {
                records.File(rootId, coord, dll);
              } else {
                // Never silently claim an artifact: a referenced assembly that
                // is still absent (download failed or was skipped) blocks.
                records.Failure(
                  coord,
                  $"referenced assembly is not installed ({Path.GetFileName(dll)}); run a NuGet restore or re-run without --no-restore",
                  config
                );
              }
            }
          }
        }
      }
    }

    private static string NormalizeSlashes(string path) {
      return Path.DirectorySeparatorChar == '/' ? path.Replace('\\', '/') : path;
    }

    // The `<Id>.<Version>` folder segment a packages.config package occupies
    // in the packages folder (and in HintPaths).
    private static string? FolderSegment(NuGet.Packaging.PackageReference pkg) {
      var version = pkg.PackageIdentity.Version?.ToNormalizedString();
      return string.IsNullOrEmpty(version) ? null : $"{pkg.PackageIdentity.Id}.{version}";
    }

    // The packages root is whatever the HintPaths point at: everything before
    // the `<Id>.<Version>` segment.
    private static string? DerivePackagesRoot(string dllPath, string segment) {
      var parts = dllPath.Split(Path.DirectorySeparatorChar);
      var idx = Array.FindIndex(parts, p => string.Equals(p, segment, StringComparison.OrdinalIgnoreCase));
      if (idx <= 0) return null;
      return string.Join(Path.DirectorySeparatorChar, parts.Take(idx));
    }

    // Pinned-version downloads through the user's configured NuGet sources
    // (nuget.config hierarchy, credential providers included) — the same feeds
    // the user's own restore would use. Extraction uses the side-by-side
    // `<Id>.<Version>` layout `nuget restore` produces for packages.config.
    private void DownloadPackagesConfigArtifacts(
      string projectDir, string packagesRoot,
      List<NuGet.Packaging.PackageReference> missing, string config
    ) {
      using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(opts.RestoreTimeoutSec));
      var logger = NullLogger.Instance;
      NuGet.Configuration.ISettings settings;
      List<SourceRepository> repos;
      try {
        settings = NuGet.Configuration.Settings.LoadDefaultSettings(projectDir);
        repos = new NuGet.Configuration.PackageSourceProvider(settings)
          .LoadPackageSources()
          .Where(s => s.IsEnabled)
          .Select(s => Repository.Factory.GetCoreV3(s))
          .ToList();
        NuGet.Credentials.DefaultCredentialServiceUtility.SetupDefaultCredentialService(
          logger, nonInteractive: true
        );
      } catch (Exception e) {
        foreach (var pkg in missing) {
          records.Failure(
            CoordIdOf(pkg.PackageIdentity.Id, pkg.PackageIdentity.Version?.ToNormalizedString() ?? ""),
            $"could not load NuGet sources for download: {FirstLine(e.Message)}",
            config
          );
        }
        return;
      }
      var extraction = new PackageExtractionContext(
        PackageSaveMode.Defaultv2,
        XmlDocFileSaveMode.None,
        NuGet.Packaging.Signing.ClientPolicyContext.GetClientPolicy(settings, logger),
        logger
      );
      var resolver = new PackagePathResolver(packagesRoot);
      using var cache = new SourceCacheContext();
      foreach (var pkg in missing) {
        var identity = pkg.PackageIdentity;
        var coord = CoordIdOf(identity.Id, identity.Version?.ToNormalizedString() ?? "");
        string? lastError = repos.Count == 0 ? "no enabled NuGet sources" : null;
        var ok = false;
        foreach (var repo in repos) {
          try {
            var resource = repo
              .GetResourceAsync<FindPackageByIdResource>(cts.Token)
              .GetAwaiter().GetResult();
            using var stream = new MemoryStream();
            var copied = resource
              .CopyNupkgToStreamAsync(identity.Id, identity.Version, stream, cache, logger, cts.Token)
              .GetAwaiter().GetResult();
            if (!copied) continue;
            stream.Position = 0;
            PackageExtractor
              .ExtractPackageAsync(repo.PackageSource.Source, stream, resolver, extraction, cts.Token)
              .GetAwaiter().GetResult();
            Log($"downloaded {identity} from {repo.PackageSource.Name}");
            ok = true;
            break;
          } catch (Exception e) {
            lastError = FirstLine(e.Message);
          }
        }
        if (!ok) {
          records.Failure(
            coord,
            $"could not download from any configured NuGet source{(lastError == null ? "" : $": {lastError}")}",
            config
          );
        }
      }
    }

    // Short folder name of the legacy project's single framework, e.g. net472.
    private static string LegacyFrameworkConfigName(Project project) {
      var moniker = project.GetPropertyValue("TargetFrameworkMoniker");
      if (!string.IsNullOrEmpty(moniker)) {
        try {
          return NuGet.Frameworks.NuGetFramework.Parse(moniker).GetShortFolderName();
        } catch {
          // Fall through to the raw version below.
        }
      }
      var version = project.GetPropertyValue("TargetFrameworkVersion");
      return string.IsNullOrEmpty(version) ? "unknown" : $"net{version.TrimStart('v').Replace(".", "")}";
    }

    // The compiled output path per target framework; multi-targeting needs an
    // inner-build evaluation per alias because the outer build has no
    // TargetPath. Missing files are fine: the CLI drops non-existent paths.
    private void EmitProjectTargets(
      string projectKey, string projectPath, Project outerProject,
      ProjectCollection collection, LockFile lockFile
    ) {
      var frameworks = lockFile.PackageSpec.TargetFrameworks;
      if (frameworks.Count <= 1) {
        var targetPath = NormalizeSlashes(outerProject.GetPropertyValue("TargetPath"));
        if (!string.IsNullOrEmpty(targetPath)) records.ProjectTgt(projectKey, Path.GetFullPath(targetPath));
        return;
      }
      foreach (var framework in frameworks) {
        var alias = framework.TargetAlias;
        if (string.IsNullOrEmpty(alias)) continue;
        try {
          var props = new Dictionary<string, string>(opts.GlobalProperties, StringComparer.OrdinalIgnoreCase) {
            ["TargetFramework"] = alias,
          };
          var inner = new Project(projectPath, props, toolsVersion: null, collection, ProjectLoadSettings.IgnoreMissingImports);
          var targetPath = NormalizeSlashes(inner.GetPropertyValue("TargetPath"));
          if (!string.IsNullOrEmpty(targetPath)) records.ProjectTgt(projectKey, Path.GetFullPath(targetPath));
        } catch {
          // TargetPath is best-effort metadata; resolution stays authoritative.
        }
      }
    }

    private void EmitTarget(
      string projectKey, string projectName, LockFile lockFile, LockFileTarget target, bool isTestProject
    ) {
      var frameworkInfo = lockFile.PackageSpec.TargetFrameworks
        .FirstOrDefault(f => f.FrameworkName.Equals(target.TargetFramework));
      var shortName = frameworkInfo?.TargetAlias;
      if (string.IsNullOrEmpty(shortName)) {
        try {
          shortName = target.TargetFramework.GetShortFolderName();
        } catch {
          records.Unscannable(target.Name, $"unrecognized target framework in {Rel(projectKey)}");
          return;
        }
      }
      var config = string.IsNullOrEmpty(target.RuntimeIdentifier)
        ? shortName
        : $"{shortName}/{target.RuntimeIdentifier}";
      // RID-specific targets match on the composite name AND on the base
      // framework, so the documented `--include-configs net8.0` usage also
      // covers `net8.0/win-x64` (and an exclude of either form drops it).
      var configNames = string.IsNullOrEmpty(target.RuntimeIdentifier)
        ? new[] { config }
        : new[] { config, shortName };
      if (!ConfigMatches(configNames)) return;
      if (_scanned.Add(config)) records.Scanned(config);

      // NuGet package ids are case-insensitive; dependency edges resolve
      // through a lowercased name index.
      var byLowerName = new Dictionary<string, string>(StringComparer.Ordinal);
      var nodes = new Dictionary<string, LockFileTargetLibrary>(StringComparer.Ordinal);
      var children = new Dictionary<string, List<string>>(StringComparer.Ordinal);
      foreach (var lib in target.Libraries) {
        if (string.IsNullOrEmpty(lib.Name)) continue;
        var coordId = CoordId(lib);
        byLowerName[lib.Name.ToLowerInvariant()] = coordId;
        nodes[coordId] = lib;
      }
      foreach (var lib in target.Libraries) {
        if (string.IsNullOrEmpty(lib.Name)) continue;
        var parent = CoordId(lib);
        foreach (var dep in lib.Dependencies) {
          if (byLowerName.TryGetValue(dep.Id.ToLowerInvariant(), out var child) && child != parent) {
            if (!children.TryGetValue(parent, out var list)) children[parent] = list = new List<string>();
            list.Add(child);
          }
        }
      }

      var directProd = new HashSet<string>(StringComparer.Ordinal);
      var directDev = new HashSet<string>(StringComparer.Ordinal);
      foreach (var dep in frameworkInfo != null ? DependenciesOf(frameworkInfo) : Enumerable.Empty<LibraryDependency>()) {
        if (string.IsNullOrEmpty(dep.Name)) continue;
        if (!byLowerName.TryGetValue(dep.Name.ToLowerInvariant(), out var coordId)) continue;
        // PrivateAssets=all (analyzers, build tooling) doesn't flow to
        // consumers: dev, mirroring the JVM scripts' non-prod configs.
        if (dep.SuppressParent == LibraryIncludeFlags.All) directDev.Add(coordId);
        else directProd.Add(coordId);
      }
      // Match project references by their MSBuild project path (the lock-file
      // library name is the PackageSpec/PackageId name, which can differ from
      // the csproj file name); the file-name lookup stays as a fallback.
      var projectLibByPath = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      var projectDir = Path.GetDirectoryName(projectKey)!;
      foreach (var library in lockFile.Libraries) {
        if (!string.Equals(library.Type, "project", StringComparison.OrdinalIgnoreCase)) continue;
        if (string.IsNullOrEmpty(library.MSBuildProject) || string.IsNullOrEmpty(library.Name)) continue;
        projectLibByPath[Path.GetFullPath(library.MSBuildProject, projectDir)] =
          library.Name.ToLowerInvariant();
      }
      var restoreFrameworkInfo = lockFile.PackageSpec.RestoreMetadata?.TargetFrameworks
        .FirstOrDefault(f => f.FrameworkName.Equals(target.TargetFramework));
      foreach (var projectRef in restoreFrameworkInfo?.ProjectReferences ?? Enumerable.Empty<ProjectRestoreReference>()) {
        var refPath = projectRef.ProjectPath;
        if (string.IsNullOrEmpty(refPath)) continue;
        if (!projectLibByPath.TryGetValue(Path.GetFullPath(refPath, projectDir), out var lowerName)) {
          lowerName = Path.GetFileNameWithoutExtension(refPath).ToLowerInvariant();
        }
        if (byLowerName.TryGetValue(lowerName, out var coordId)) {
          directProd.Add(coordId);
        }
      }

      var prodReach = Reach(directProd, children);
      var devReach = Reach(directDev, children);
      foreach (var key in nodes.Keys) {
        if (!prodReach.Contains(key) && !devReach.Contains(key)) prodReach.Add(key);
      }

      EmitRoot(projectKey, config, "prod", !isTestProject, prodReach, directProd, nodes, children, lockFile);
      EmitRoot(projectKey, config, "dev", prod: false, devReach, directDev, nodes, children, lockFile);
    }

    private void EmitRoot(
      string projectKey, string config, string kind, bool prod,
      HashSet<string> keys, HashSet<string> direct,
      Dictionary<string, LockFileTargetLibrary> nodes,
      Dictionary<string, List<string>> children, LockFile lockFile
    ) {
      if (keys.Count == 0) return;
      var rootId = $"{projectKey}|{config}|{kind}";
      records.Root(rootId, projectKey, config, prod);
      foreach (var key in keys.OrderBy(k => k, StringComparer.Ordinal)) {
        var lib = nodes[key];
        records.Node(rootId, key, lib.Name!, lib.Version?.ToNormalizedString() ?? "", direct.Contains(key));
        if (opts.WithFiles && string.Equals(lib.Type, "package", StringComparison.OrdinalIgnoreCase)) {
          var (found, missing) = ResolveRuntimeAssemblies(lockFile, lib);
          foreach (var file in found) {
            records.File(rootId, key, file);
          }
          if (missing.Count > 0) {
            // Never silently claim an artifact: the lock file lists runtime
            // assemblies this cache doesn't hold (pruned cache, stale assets
            // with --no-restore). A package with NO runtime assemblies at all
            // (analyzer/content-only) is fine and takes neither branch.
            records.Failure(
              key,
              $"runtime assemblies listed in project.assets.json are missing from the package cache ({missing[0]}{(missing.Count > 1 ? $" +{missing.Count - 1} more" : "")}); re-run restore",
              config
            );
          }
        }
        if (children.TryGetValue(key, out var kids)) {
          foreach (var child in kids) {
            if (keys.Contains(child)) records.Edge(rootId, key, child);
          }
        }
      }
    }

    // Runtime (lib/) assemblies, not compile (ref/) assemblies: reference
    // assemblies have no method bodies, which breaks reachability analysis.
    // First package folder holding the file wins (NuGet's own probe order);
    // an item found in NO folder is reported so it can fail the run.
    private static (List<string> Found, List<string> Missing) ResolveRuntimeAssemblies(
      LockFile lockFile, LockFileTargetLibrary lib
    ) {
      var found = new List<string>();
      var missing = new List<string>();
      var library = lockFile.GetLibrary(lib.Name, lib.Version);
      if (library?.Path == null) return (found, missing);
      var items = (lib.RuntimeAssemblies ?? new List<LockFileItem>())
        .Select(item => item.Path)
        .Where(p => !string.IsNullOrEmpty(p)
          && p.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)
          && Path.GetFileName(p) != "_._")
        .ToList();
      foreach (var item in items) {
        string? hit = null;
        foreach (var folder in lockFile.PackageFolders) {
          if (string.IsNullOrEmpty(folder.Path)) continue;
          var full = Path.GetFullPath(Path.Combine(folder.Path, library.Path, item));
          if (File.Exists(full)) {
            hit = full;
            break;
          }
        }
        if (hit != null) {
          found.Add(hit);
        } else {
          missing.Add(item!);
        }
      }
      return (found, missing);
    }

    private static HashSet<string> Reach(HashSet<string> seeds, Dictionary<string, List<string>> children) {
      var seen = new HashSet<string>(seeds, StringComparer.Ordinal);
      var stack = new Stack<string>(seen);
      while (stack.Count > 0) {
        var key = stack.Pop();
        if (!children.TryGetValue(key, out var kids)) continue;
        foreach (var child in kids) {
          if (seen.Add(child)) stack.Push(child);
        }
      }
      return seen;
    }

    private bool ConfigMatches(IReadOnlyList<string> names) {
      if (_excludes.Any(p => names.Any(n => p.IsMatch(n)))) return false;
      return _includes.Count == 0 || _includes.Any(p => names.Any(n => p.IsMatch(n)));
    }

    private string Rel(string path) {
      var rel = Path.GetRelativePath(opts.RootDir, path).Replace('\\', '/');
      return string.IsNullOrEmpty(rel) || rel == "." ? "." : rel;
    }

    private void Log(string message) {
      if (opts.Verbose) Console.Error.WriteLine($"socket-facts-dotnet: {message}");
    }
  }

  // TargetFrameworkInformation.Dependencies changed shape across NuGet
  // versions (IList<LibraryDependency> -> ImmutableArray<LibraryDependency>),
  // so a compiled getter call binds on some SDKs and MissingMethodExceptions
  // on others. Read it reflectively: both shapes implement
  // IEnumerable<LibraryDependency>, and type identity holds because the
  // runtime NuGet assemblies are always the locator-selected SDK's own.
  private static readonly System.Reflection.PropertyInfo? TfiDependenciesProperty =
    typeof(TargetFrameworkInformation).GetProperty("Dependencies");

  private static IEnumerable<LibraryDependency> DependenciesOf(TargetFrameworkInformation framework) {
    return TfiDependenciesProperty?.GetValue(framework) as IEnumerable<LibraryDependency>
      ?? Enumerable.Empty<LibraryDependency>();
  }

  private static string CoordId(LockFileTargetLibrary lib) {
    return CoordIdOf(lib.Name!, lib.Version?.ToNormalizedString() ?? "");
  }

  private static string CoordIdOf(string name, string version) {
    return string.IsNullOrEmpty(version) ? name : $"{name}:{version}";
  }

  private static bool IsProjectFile(string path) =>
    path.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase)
    || path.EndsWith(".fsproj", StringComparison.OrdinalIgnoreCase)
    || path.EndsWith(".vbproj", StringComparison.OrdinalIgnoreCase);

  private static string FirstLine(string s) {
    var idx = s.IndexOfAny(new[] { '\n', '\r' });
    return idx < 0 ? s : s.Substring(0, idx);
  }

  // Pre-compiled anchored pattern sources from the CLI (config-glob.mts is the
  // single glob implementation); an uncompilable pattern is dropped, never
  // thrown — it only guards against a broken transport.
  private static List<Regex> ParsePatterns(string csv) {
    var patterns = new List<Regex>();
    foreach (var raw in (csv ?? "").Split(',')) {
      var p = raw.Trim();
      if (p.Length == 0) continue;
      try {
        patterns.Add(new Regex(p));
      } catch (ArgumentException) {
        // Dropped; see contract above.
      }
    }
    return patterns;
  }

  // Collects restore errors; NuGet logs NU-coded restore failures as build
  // errors, which become failure records after the build session ends.
  private sealed class ErrorCaptureLogger : Microsoft.Build.Framework.ILogger {
    public readonly List<(string Coord, string Detail)> Errors = new();
    public LoggerVerbosity Verbosity { get; set; } = LoggerVerbosity.Quiet;
    public string? Parameters { get; set; }

    public void Initialize(IEventSource eventSource) {
      eventSource.ErrorRaised += (_, e) => {
        lock (Errors) {
          var coord = string.IsNullOrEmpty(e.ProjectFile) ? (e.File ?? "restore") : e.ProjectFile;
          Errors.Add((coord, $"{e.Code}: {e.Message}"));
        }
      };
    }

    public void Shutdown() { }
  }
}
