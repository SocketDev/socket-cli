// Minimal cross-sbt smoke project for ../../socket-facts.plugin.scala. Resolves one prod dep and one
// test dep so the smoke test can assert the prod/dev split and --with-files materialization. Both are
// stub artifacts generated into `localrepo` at test time (../../make-stub-repo.sh): plain Java
// artifacts needing no Scala cross-version, never compiled against, so they can never age into a CVE
// alert or a version bump. Uses the `in ThisBuild` setting form (not the `/` slash form) so it parses
// on sbt 0.13 AND 1.x. scalaVersion is set by smoke-test.sh per matrix entry (scala-version.sbt:
// 2.10 for sbt 0.13, 2.12 for 1.x).
organization in ThisBuild := "demo"
version in ThisBuild := "0.1.0"

lazy val root = (project in file("."))
  .settings(
    name := "sbt-compat-smoke",
    // Pin fast resolvers first: sbt 0.13's default chain otherwise hits slow/dead Ivy repos. The
    // stub repo leads so the two declared deps resolve off disk; Central still serves sbt's own
    // closure (scala-library and friends).
    resolvers := Seq(
      "Socket Stubs" at s"file://${baseDirectory.value.getAbsolutePath}/localrepo",
      "Ivy Releases" at "https://scala.jfrog.io/artifactory/ivy-releases/",
      "Maven Central" at "https://repo1.maven.org/maven2/"
    ) ++ resolvers.value,
    libraryDependencies += "demo.ext" % "tool" % "1.0",
    libraryDependencies += "demo.ext" % "harness" % "1.0" % Test
  )
