using System.Text;

namespace Socket.Facts.Dotnet;

// Writes the TSV records line protocol shared with the JVM build-tool scripts
// (grammar in records.mts).
internal sealed class RecordsWriter : IDisposable {
  private readonly StreamWriter _writer;

  public RecordsWriter(string path) {
    var dir = Path.GetDirectoryName(Path.GetFullPath(path));
    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
    // No BOM, and `\n` on every OS: the parser splits on `\n` and reads the
    // first tag verbatim.
    _writer = new StreamWriter(path, append: false, new UTF8Encoding(false)) { NewLine = "\n" };
  }

  private void Rec(params string[] fields) {
    var sb = new StringBuilder();
    for (var i = 0; i < fields.Length; i += 1) {
      if (i > 0) sb.Append('\t');
      sb.Append(Escape(fields[i]));
    }
    _writer.WriteLine(sb.ToString());
  }

  public void Meta(string sdkVersion) => Rec("meta", "dotnet", sdkVersion, "");

  public void BuildRoot(string path) => Rec("buildRoot", path);

  public void Entry(string path) => Rec("entry", path);

  public void Project(string projectKey, string name, string version, string dir) =>
    Rec("project", projectKey, "", name, version, dir);

  public void ProjectSrc(string projectKey, string path, string config) => Rec("projectSrc", projectKey, path, config);

  public void ProjectTgt(string projectKey, string path, string config) => Rec("projectTgt", projectKey, path, config);

  public void ProjectInfo(string projectKey, string config, string name, string value) =>
    Rec("projectInfo", projectKey, config, name, value);

  public void ProjectUsing(string projectKey, string config, string ns, string alias, bool isStatic) =>
    Rec("projectUsing", projectKey, config, ns, alias, isStatic ? "1" : "0");

  public void ProjectBuild(string projectKey, string path) => Rec("projectBuild", projectKey, path);

  public void Member(string path) => Rec("member", path);

  public void ExcludedProject(string projectKey) => Rec("excludedProject", projectKey);

  public void Root(string rootId, string projectKey, string config, bool prod, string framework, string runtime, string alias) =>
    Rec("root", rootId, projectKey, config, prod ? "1" : "0", framework, runtime, alias);

  public void Node(string rootId, string coordId, string name, string version, bool direct, string project) =>
    Rec("node", rootId, coordId, "", name, version, "", "", direct ? "1" : "0", project);

  public void Edge(string rootId, string parentCoordId, string childCoordId) =>
    Rec("edge", rootId, parentCoordId, childCoordId);

  public void File(string rootId, string coordId, string path) => Rec("file", rootId, coordId, path);

  public void CompileFile(string rootId, string coordId, string path) => Rec("compileFile", rootId, coordId, path);

  public void Unfetched(string rootId, string coordId) => Rec("unfetched", rootId, coordId);

  public void Scanned(string config) => Rec("scanned", config);

  public void Failure(string coord, string detail, string config, string projectKey) =>
    Rec("failure", coord, detail, config, projectKey);

  public void Unscannable(string config, string detail, string projectKey) =>
    Rec("unscannable", config, detail, projectKey);

  public void Dispose() => _writer.Dispose();

  private static string Escape(string? v) {
    if (string.IsNullOrEmpty(v)) return "";
    return v.Replace("\\", "\\\\").Replace("\t", "\\t").Replace("\n", "\\n").Replace("\r", "\\r");
  }
}
