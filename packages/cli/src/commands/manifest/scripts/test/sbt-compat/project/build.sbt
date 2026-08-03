// Minimal cross-sbt smoke project for ../../socket-facts.plugin.scala. Resolves one prod dep
// (commons-io, a plain Java artifact so it needs no Scala cross-version) and one test dep (junit),
// so the smoke test can assert the prod/dev split and --with-files materialization. Uses the
// `in ThisBuild` setting form (not the `/` slash form) so it parses on sbt 0.13 AND 1.x.
// scalaVersion is set by smoke-test.sh per matrix entry (scala-version.sbt: 2.10 for sbt 0.13,
// 2.12 for 1.x).
organization in ThisBuild := "demo"
version in ThisBuild := "0.1.0"

lazy val root = (project in file("."))
  .settings(
    name := "sbt-compat-smoke",
    // Pin fast resolvers first: sbt 0.13's default chain otherwise hits slow/dead Ivy repos.
    resolvers := Seq(
      "Ivy Releases" at "https://scala.jfrog.io/artifactory/ivy-releases/",
      "Maven Central" at "https://repo1.maven.org/maven2/"
    ) ++ resolvers.value,
    libraryDependencies += "commons-io" % "commons-io" % "2.11.0",
    libraryDependencies += "junit" % "junit" % "4.13.2" % Test
  )
