using System.Text;

namespace Socket.Facts.Dotnet;

// Emits the flat TSV records line protocol shared with the JVM build-tool
// scripts (grammar documented in records.mts). Buffered and flushed on
// Dispose so a crash mid-run still leaves whatever was recorded.
internal sealed class RecordsWriter : IDisposable {
  private readonly StreamWriter _writer;

  public RecordsWriter(string path) {
    var dir = Path.GetDirectoryName(Path.GetFullPath(path));
    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
    // No BOM: the TS records parser reads lines verbatim and a BOM would
    // corrupt the first record's tag.
    _writer = new StreamWriter(path, append: false, new UTF8Encoding(false));
  }

  public void Rec(params string[] fields) {
    var sb = new StringBuilder();
    for (var i = 0; i < fields.Length; i += 1) {
      if (i > 0) sb.Append('\t');
      sb.Append(Escape(fields[i]));
    }
    _writer.WriteLine(sb.ToString());
  }

  public void Meta(string toolVersion) => Rec("meta", "dotnet", toolVersion, "");

  public void Project(string projectKey, string name, string version, string dir) =>
    Rec("project", projectKey, "", name, version, dir);

  public void ProjectSrc(string projectKey, string path) => Rec("projectSrc", projectKey, path);

  public void ProjectTgt(string projectKey, string path) => Rec("projectTgt", projectKey, path);

  public void Root(string rootId, string projectKey, string config, bool prod) =>
    Rec("root", rootId, projectKey, config, prod ? "1" : "0");

  public void Node(string rootId, string coordId, string name, string version, bool direct) =>
    Rec("node", rootId, coordId, "", name, version, "", "", direct ? "1" : "0");

  public void Edge(string rootId, string parentCoordId, string childCoordId) =>
    Rec("edge", rootId, parentCoordId, childCoordId);

  public void File(string rootId, string coordId, string path) => Rec("file", rootId, coordId, path);

  public void Scanned(string config) => Rec("scanned", config);

  public void Failure(string coord, string detail, string config) => Rec("failure", coord, detail, config);

  public void Unscannable(string config, string detail) => Rec("unscannable", config, detail);

  public void Dispose() => _writer.Dispose();

  private static string Escape(string? v) {
    if (string.IsNullOrEmpty(v)) return "";
    return v.Replace("\\", "\\\\").Replace("\t", "\\t").Replace("\n", "\\n").Replace("\r", "\\r");
  }
}
