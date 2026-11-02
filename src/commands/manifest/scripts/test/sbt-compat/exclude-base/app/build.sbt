lazy val core = project
lazy val root = (project in file(".")).aggregate(core)
