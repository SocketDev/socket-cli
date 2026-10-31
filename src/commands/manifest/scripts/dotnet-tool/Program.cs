using Microsoft.Build.Locator;

namespace Socket.Facts.Dotnet;

internal static class Program {
  private static int Main(string[] args) {
    ToolOptions opts;
    try {
      opts = ToolOptions.Parse(args);
    } catch (ArgumentException e) {
      Console.Error.WriteLine(e.Message);
      Console.Error.WriteLine(ToolOptions.Usage);
      return 2;
    }
    // Resolves the SDK the way the dotnet CLI does from the entry's directory
    // (the caller's cwd), so a global.json pin selects the same SDK that
    // `dotnet restore` runs.
    var instance = MSBuildLocator.RegisterDefaults();
    // MSBuild types must not be JITed before the locator has registered the
    // SDK assemblies, hence the separate class.
    return FactsRunner.Run(opts, instance.Version.ToString());
  }
}
