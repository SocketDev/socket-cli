using System.Collections;
using System.Collections.Concurrent;
using System.Reflection;

namespace Socket.Facts.Dotnet;

// NuGet changed collection members' declared types across the SDKs the tool
// runs on (IList<T> -> ImmutableArray<T>), which a compiled getter cannot bind.
internal static class NuGetShim {
  private static readonly ConcurrentDictionary<(Type, string), PropertyInfo?> Properties = new();

  public static IEnumerable<T> Seq<T>(object? owner, string member) {
    if (owner == null) yield break;
    var prop = Properties.GetOrAdd(
      (owner.GetType(), member),
      key => key.Item1.GetProperty(key.Item2, BindingFlags.Public | BindingFlags.Instance)
    );
    if (prop?.GetValue(owner) is not IEnumerable items) yield break;
    foreach (var item in items) {
      if (item is T typed) yield return typed;
    }
  }
}
