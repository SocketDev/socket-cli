package socket

import sbt._
import sbt.Keys._

import scala.collection.mutable

/**
 * Lightweight sibling of SocketFactsPlugin (socket-facts.plugin.scala): emits only
 * `meta`/`project` records (a build's subproject list) with NO dependency resolution at all - no
 * `update`/`updateFull` is ever run. Kept as a wholly separate plugin (not a flag on the facts
 * task) so it can never affect that file's already-verified wide sbt-version compatibility
 * (0.13.x+). Used for cheap workspace discovery, e.g.
 * `socket manifest setup --dynamic-sbom-inference`, without paying for a full facts-generation build.
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

  // `-Dsocket.excludePaths` → glob PathMatchers, used only to skip whole excluded subprojects. Each
  // entry variant yields the entry itself and `entry/**` so it matches the dir and its subtree (same
  // expansion as the SCA ignore path). A trailing `/**` is stripped first, so a user-written `dir/**`
  // still excludes the `dir` directory itself, not only its contents. Standard glob semantics
  // (anchored to the scan root, matching the CLI flag): `x` is root-level; `**`/`x` matches at any
  // depth. Mirrors the gradle/maven producers.
  private def parseExcludeMatchers(): Seq[java.nio.file.PathMatcher] = {
    sys.props.get("socket.excludePaths").map(_.trim).filter(_.nonEmpty) match {
      case None => Nil
      case Some(raw) =>
        val fs = java.nio.file.FileSystems.getDefault
        raw.split(",").toSeq.flatMap { r =>
          var g = r.trim.replace("\\", "/")
          while (g.startsWith("/")) g = g.substring(1)
          while (g.endsWith("/")) g = g.substring(0, g.length - 1)
          while (g.endsWith("/**")) {
            g = g.substring(0, g.length - 3)
            while (g.endsWith("/")) g = g.substring(0, g.length - 1)
          }
          if (g.isEmpty) Nil
          else zeroDepthVariants(g).flatMap { v =>
            Seq(fs.getPathMatcher("glob:" + v), fs.getPathMatcher("glob:" + v + "/**"))
          }
        }
    }
  }

  // NIO glob requires a slash-adjacent `**` to consume at least one path segment, but the CLI's
  // micromatch lets it match zero (`**/x` matches root-level `x`). Emit every variant with `**/`
  // occurrences dropped so both semantics hold.
  private def zeroDepthVariants(glob: String): Seq[String] = {
    val out = mutable.LinkedHashSet[String]()
    val work = mutable.Queue(glob)
    while (work.nonEmpty) {
      val cur = work.dequeue()
      if (out.add(cur)) {
        var idx = cur.indexOf("**/")
        while (idx >= 0) {
          if (idx == 0 || cur.charAt(idx - 1) == '/') {
            val collapsed = cur.substring(0, idx) + cur.substring(idx + 3)
            if (collapsed.nonEmpty) work.enqueue(collapsed)
          }
          idx = cur.indexOf("**/", idx + 1)
        }
      }
    }
    out.toSeq
  }

  private def isExcludedPath(rel: String, matchers: Seq[java.nio.file.PathMatcher]): Boolean = {
    if (matchers.isEmpty) false
    else {
      var c = (if (rel == null) "" else rel).replace("\\", "/")
      while (c.startsWith("./")) c = c.substring(2)
      while (c.startsWith("/")) c = c.substring(1)
      while (c.endsWith("/")) c = c.substring(0, c.length - 1)
      if (c.isEmpty) false
      else {
        val p = java.nio.file.Paths.get(c)
        matchers.exists(_.matches(p))
      }
    }
  }

  // Backslash-escape so a value can never break line/field framing (see records.ts unescape).
  private def esc(v: String): String = {
    if (v == null) ""
    else v.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")
  }
}
