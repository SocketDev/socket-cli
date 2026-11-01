// Relocation fixture for ../../socket-facts.plugin.scala. core declares demo.old:moved, which
// relocates to demo.ext:moved, by a version range; app gets demo.ext:moved only through core, and
// overrides its version to one the relocation does not name. The
// demo.ext:wrapper POM declares demo.old:moved with the test scope, which it does not pass on, so it
// must not become demo.ext:moved's parent. Stub artifacts come from `localrepo`
// (../../make-stub-repo.sh). Uses the `in ThisBuild` setting form so it parses on sbt 0.13 and 1.x.
organization in ThisBuild := "demo"
version in ThisBuild := "0.1.0"

lazy val stubs = Seq(
  resolvers := Seq(
    "Socket Stubs" at s"file://${(baseDirectory in ThisBuild).value.getAbsolutePath}/localrepo",
    "Maven Central" at "https://repo1.maven.org/maven2/"
  ) ++ resolvers.value
)

lazy val core = (project in file("core")).settings(stubs, libraryDependencies += "demo.old" % "moved" % "[1.0,2.0)")

lazy val app = (project in file("app"))
  .dependsOn(core)
  .settings(stubs, libraryDependencies += "demo.ext" % "wrapper" % "1.0", dependencyOverrides += "demo.ext" % "moved" % "1.1")
