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
    var instance = MSBuildLocator.RegisterDefaults();
    // FactsRunner lives in a separate class: MSBuild types must not be JITed
    // before the locator has registered the SDK assemblies.
    return FactsRunner.Run(opts, instance.Version.ToString());
  }
}
