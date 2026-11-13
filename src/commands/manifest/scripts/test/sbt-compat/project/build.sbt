// Smoke project for ../../socket-workspaces.plugin.scala. The `in ThisBuild` form parses on sbt 0.13
// and 1.x; smoke-test-workspaces.sh sets scalaVersion per matrix entry.
organization in ThisBuild := "demo"
version in ThisBuild := "0.1.0"

lazy val root = (project in file("."))
  .settings(
    name := "sbt-compat-smoke",
    // sbt 0.13's default chain otherwise hits slow or dead Ivy repos.
    resolvers := Seq(
      "Ivy Releases" at "https://scala.jfrog.io/artifactory/ivy-releases/",
      "Maven Central" at "https://repo1.maven.org/maven2/"
    ) ++ resolvers.value
  )
