// Failure fixture for ../../../socket-facts.plugin.scala: ok resolves; lib and testlib name a parent POM
// that does not exist; ghost does not exist at all; nojar has a POM but no jar; pomonly is
// `<packaging>pom</packaging>`; pkwar is a war with no jar; ok has no tests-classifier jar. Generated
// into `localrepo` by ../smoke-test-failure.sh. Uses the `in ThisBuild` form so it parses on sbt 0.13
// and 1.x.
organization in ThisBuild := "demo"
version in ThisBuild := "0.1.0"

lazy val root = (project in file("."))
  .settings(
    name := "sbt-compat-failure",
    resolvers := Seq(
      "Socket Stubs" at s"file://${baseDirectory.value.getAbsolutePath}/localrepo",
      "Ivy Releases" at "https://scala.jfrog.io/artifactory/ivy-releases/",
      "Maven Central" at "https://repo1.maven.org/maven2/"
    ) ++ resolvers.value,
    libraryDependencies += "demo.fail" % "ok" % "1.0",
    libraryDependencies += "demo.fail" % "lib" % "1.0",
    libraryDependencies += "demo.fail" % "testlib" % "1.0" % Test,
    libraryDependencies += "demo.fail" % "ghost" % "1.0",
    libraryDependencies += "demo.fail" % "nojar" % "1.0",
    libraryDependencies += "demo.fail" % "pomonly" % "1.0",
    libraryDependencies += "demo.fail" % "pkwar" % "1.0",
    libraryDependencies += "demo.fail" % "ok" % "1.0" % Test classifier "tests"
  )
