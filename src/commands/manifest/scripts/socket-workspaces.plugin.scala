package socket

import sbt._
import sbt.Keys._

/**
 * Sibling of SocketFactsPlugin (socket-facts.plugin.scala): emits only `meta`/`project`
 * records, no dependency resolution. Kept as a separate plugin so it can't affect that
 * file's already-verified wide sbt-version compatibility (0.13.x+).
 *
 * Must compile on Scala 2.10/sbt 0.13 and Scala 2.12/sbt 1.x, same constraint as the facts plugin.
 */
object SocketWorkspacesPlugin extends AutoPlugin {
  override def trigger = allRequirements

  object autoImport {
    val socketWorkspaces =
      taskKey[Unit]("Emit Socket workspace records (project list only; no dependency resolution)")
  }
  import autoImport._

  override def projectSettings: Seq[Setting[_]] = Seq(
    aggregate in socketWorkspaces := false,
    socketWorkspaces := {
      val st = state.value
      val buildRoot = (baseDirectory in ThisBuild).value

      val extracted = Project.extract(st)
      val allRefs = extracted.structure.allProjectRefs

      // `-Dsocket.excludePaths` (scan-root-relative globs): a subproject whose dir is wholly excluded
      // emits no project record. Mirrors socket-facts.plugin.scala / the gradle / maven producers.
      val excludeMatchers = parseExcludeMatchers()
      val rootCanonPath = buildRoot.getCanonicalFile.toPath
      def relOf(f: File): String = {
        val r = rootCanonPath.relativize(f.getCanonicalFile.toPath).toString.replace(java.io.File.separator, "/")
        if (r.isEmpty) "." else r
      }
      def isExcludedRef(ref: ProjectRef): Boolean =
        isExcludedPath(relOf(extracted.get(baseDirectory.in(ref))), excludeMatchers)

      def rootIdOf(ref: ProjectRef): ModuleID = {
        val sv = extracted.get(scalaVersion.in(ref))
        val sbv = extracted.get(scalaBinaryVersion.in(ref))
        CrossVersion.apply(sv, sbv)(extracted.get(projectID.in(ref)))
      }

      val sb = new StringBuilder
      def rec(fields: String*): Unit = {
        sb.append(fields.map(esc).mkString("\t")); sb.append('\n')
      }

      rec("meta", "sbt", extracted.getOpt(sbtVersion).getOrElse(""), sys.props.getOrElse("java.version", ""))

      allRefs.foreach { ref =>
        if (!isExcludedRef(ref)) {
          val mid = rootIdOf(ref)
          val ver = if (mid.revision == null) "" else mid.revision
          rec("project", ref.project, mid.organization, mid.name, ver, relOf(extracted.get(baseDirectory.in(ref))))
        }
      }

      val recordsFile = sys.props.get("socket.recordsFile").filter(_.nonEmpty) match {
        case Some(p) => new File(p)
        case None    => new File(buildRoot, ".socket.workspaces.records.tsv")
      }
      Option(recordsFile.getParentFile).foreach(_.mkdirs())
      IO.write(recordsFile, sb.toString)
      println("Socket workspace records written to: " + recordsFile.getAbsolutePath)
    }
  )

  // ---- config selection / path exclusion (mirrors socket-facts.plugin.scala) ----------------

  // `-Dsocket.excludePaths` → PRE-COMPILED, comma-joined, anchored regex pattern sources, used only
  // to skip whole excluded subprojects. The CLI compiles the user-facing globs in
  // exclude-paths-glob.mts (the single glob implementation, tested in CI); this plugin only
  // Pattern.compile()s what it receives.
  private def parseExcludeMatchers(): Seq[java.util.regex.Pattern] = {
    sys.props.get("socket.excludePaths").map(_.trim).filter(_.nonEmpty) match {
      case None => Nil
      case Some(raw) =>
        raw.split(",").toSeq.flatMap { r =>
          val p = r.trim
          // A pattern that doesn't compile is dropped, never thrown: the CLI emits a
          // dialect-portable subset, so this only guards against a broken transport.
          if (p.isEmpty) Nil
          else
            try Seq(java.util.regex.Pattern.compile(p))
            catch { case _: java.util.regex.PatternSyntaxException => Nil }
        }
    }
  }

  private def isExcludedPath(rel: String, patterns: Seq[java.util.regex.Pattern]): Boolean = {
    if (patterns.isEmpty) false
    else {
      var c = (if (rel == null) "" else rel).replace("\\", "/")
      while (c.startsWith("./")) c = c.substring(2)
      while (c.startsWith("/")) c = c.substring(1)
      while (c.endsWith("/")) c = c.substring(0, c.length - 1)
      if (c.isEmpty) false
      else patterns.exists(_.matcher(c).matches())
    }
  }

  // Backslash-escape so a value can never break line/field framing (see records.ts unescape).
  private def esc(v: String): String = {
    if (v == null) ""
    else v.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")
  }
}
