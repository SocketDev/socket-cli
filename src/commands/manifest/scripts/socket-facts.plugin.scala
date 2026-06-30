package socket

import sbt._
import sbt.Keys._

import scala.collection.mutable
import scala.reflect.ClassTag

/**
 * Emits a flat line-protocol RECORDS file at the build root (NOT the final
 * `.socket.facts.json`, and NOT to stdout — sbt prints resolution noise to stdout
 * with no way to silence it). The TS assembler (utils/src/manifest-scripts/assemble.ts)
 * reads the records and owns all SBOM construction — graph merge, content-addressed
 * ids, contentHash. This plugin only RESOLVES and emits raw facts. See records.ts for
 * the record grammar.
 *
 * Must compile on Scala 2.10/sbt 0.13 and Scala 2.12/sbt 1.x (compiled by the sbt
 * meta-build), hence string-named TaskKeys and reflection for version-specific
 * ExclusionRule / ResolveException / ConfigRef shapes.
 */
object SocketFactsPlugin extends AutoPlugin {
  override def trigger = allRequirements

  object autoImport {
    val socketFacts =
      taskKey[Unit]("Emit Socket facts records for the whole build")
  }
  import autoImport._

  override def projectSettings: Seq[Setting[_]] = Seq(
    aggregate in socketFacts := false,
    socketFacts := {
      val st = state.value
      val buildRoot = (baseDirectory in ThisBuild).value
      val withFiles = boolProp("socket.withFiles")
      val populateScope: Option[Set[String]] = readPopulateScope()

      val extracted = Project.extract(st)
      val allRefs = extracted.structure.allProjectRefs

      // Prefer `updateFull` (coursier `update` returns empty callers); fall back to `update` (sbt 0.13).
      val hasUpdateFull =
        extracted.structure.settings.map(_.key.key).exists(_.label == "updateFull")
      val updateTaskName = if (hasUpdateFull) "updateFull" else "update"

      // One tree per resolution root (project, config); the TS assembler merges them path-sensitively.
      val perSub = mutable.LinkedHashMap.empty[String, RootTree]
      val failures = mutable.LinkedHashSet.empty[Failure]
      val scannedConfigs = mutable.LinkedHashSet.empty[String]
      val matcher = buildConfigMatcher()

      // Real artifact ext per build module, so an ext-less inter-project dep gets its true coordinate.
      val moduleExts = buildModuleExts(allRefs, extracted)

      allRefs.foreach { ref =>
        runUpdateResilient(updateTaskName, ref, extracted, st, failures).foreach { report =>
          foldReport(report, ref, extracted, matcher, scannedConfigs, withFiles, populateScope, moduleExts).foreach {
            case (rootKey, tree) => perSub(rootKey) = tree
          }
        }
      }

      val moduleDirs: Map[String, (Seq[String], Seq[String])] =
        if (withFiles) buildModuleDirs(allRefs, extracted) else Map.empty

      val rootPath = buildRoot.getCanonicalFile.toPath
      def relOf(f: File): String = {
        val r = rootPath.relativize(f.getCanonicalFile.toPath).toString.replace(java.io.File.separator, "/")
        if (r.isEmpty) "." else r
      }

      val sb = new StringBuilder
      def rec(fields: String*): Unit = {
        sb.append(fields.map(esc).mkString("\t")); sb.append('\n')
      }

      rec("meta", "sbt", extracted.getOpt(sbtVersion).getOrElse(""), sys.props.getOrElse("java.version", ""))

      // One `project` record per build module (sources/targets only with --with-files).
      allRefs.foreach { ref =>
        val mid = rootIdOf(extracted, ref)
        val ver = if (mid.revision == null) "" else mid.revision
        rec("project", ref.project, mid.organization, mid.name, ver, relOf(extracted.get(baseDirectory.in(ref))))
        if (withFiles) {
          moduleDirs.get(mid.organization + ":" + mid.name + ":" + ver).foreach {
            case (sources, targets) =>
              sources.foreach(s => rec("projectSrc", ref.project, s))
              targets.foreach(t => rec("projectTgt", ref.project, t))
          }
        }
      }

      // One resolution root per (subproject, configuration); the TS assembler content-addresses
      // divergent subtrees.
      var rootIdx = 0
      perSub.foreach {
        case (_, tree) =>
          val rootId = rootIdx.toString
          rootIdx += 1
          rec("root", rootId, tree.projectKey, tree.config, if (tree.prod) "1" else "0")
          tree.nodes.foreach {
            case (coordId, node) =>
              val c = node.coord
              rec("node", rootId, coordId, c.org, c.name, c.version, c.ext, c.classifier, if (node.direct) "1" else "0")
              node.children.foreach(ch => rec("edge", rootId, coordId, ch))
              node.targets.foreach(p => rec("file", rootId, coordId, p))
          }
      }

      // Scanned configs + raw failures (Coana owns the abort/warn policy and report rendering).
      scannedConfigs.toList.sorted.foreach(c => rec("scanned", c))
      failures.foreach(f => rec("failure", f.coord, f.detail, f.config))

      val recordsFile = sys.props.get("socket.recordsFile").filter(_.nonEmpty) match {
        case Some(p) => new File(p)
        case None    => new File(buildRoot, ".socket.facts.records.tsv")
      }
      Option(recordsFile.getParentFile).foreach(_.mkdirs())
      IO.write(recordsFile, sb.toString)
      println("Socket facts records written to: " + recordsFile.getAbsolutePath)
    }
  )

  // ---- resolution ---------------------------------------------------------

  private def rootIdOf(extracted: Extracted, ref: ProjectRef): ModuleID = {
    val sv = extracted.get(scalaVersion.in(ref))
    val sbv = extracted.get(scalaBinaryVersion.in(ref))
    CrossVersion.apply(sv, sbv)(extracted.get(projectID.in(ref)))
  }

  // GAV -> a build module's real artifact extension (jar for a normal project). coursier reports an
  // inter-project dependency with no resolved artifact, so it would otherwise be ext-less and not
  // match how depscan ingests it (ext=jar); stamping the real ext keeps a full, matching coordinate.
  private def buildModuleExts(allRefs: Seq[ProjectRef], extracted: Extracted): Map[String, String] = {
    allRefs.map { ref =>
      val ext = extracted.getOpt(artifact.in(ref)).map(_.extension).filter(e => e != null && e.nonEmpty).getOrElse("jar")
      gavKey(rootIdOf(extracted, ref)) -> ext
    }.toMap
  }

  // Absolute source roots + compiled-output dirs per build module, keyed by GAV. --with-files only;
  // absolute because reachability locates an internal module's code on THIS machine (no registry jar).
  private def buildModuleDirs(
      allRefs: Seq[ProjectRef],
      extracted: Extracted
  ): Map[String, (Seq[String], Seq[String])] = {
    allRefs.map { ref =>
      val mid = rootIdOf(extracted, ref)
      val ver = if (mid.revision == null) "" else mid.revision
      val sources = Seq(Compile, Test)
        .flatMap(c => extracted.getOpt(sourceDirectories.in(ref).in(c)).getOrElse(Nil))
        .map(_.getAbsolutePath).distinct.sorted
      val targets = Seq(Compile, Test)
        .flatMap(c => extracted.getOpt(classDirectory.in(ref).in(c)))
        .map(_.getAbsolutePath).distinct.sorted
      (mid.organization + ":" + mid.name + ":" + ver) -> ((sources, targets))
    }.toMap
  }

  // On a hard resolve failure, record the failed modules and retry once with them excluded. Never throws.
  private def runUpdateResilient(
      taskName: String,
      ref: ProjectRef,
      extracted: Extracted,
      state: State,
      failures: mutable.LinkedHashSet[Failure]
  ): Option[UpdateReport] = {
    val key = TaskKey[UpdateReport](taskName)

    def runOn(st: State): Either[Seq[ModuleID], UpdateReport] =
      Project.runTask(key.in(ref).scopedKey, st) match {
        case Some((_, sbt.Value(rep))) => Right(rep)
        case Some((_, sbt.Inc(inc)))   => Left(extractFailedModules(inc))
        case _                         => Left(Nil)
      }

    runOn(state) match {
      case Right(rep) => Some(rep)
      case Left(failed) =>
        failed.foreach { m =>
          failures += Failure(coordOf(m), "unresolved dependency", taskName)
        }
        if (failed.isEmpty) None
        else
          runOn(extracted.append(exclusionSettings(extracted, failed), state)) match {
            case Right(rep) => Some(rep)
            case Left(_)    => None
          }
    }
  }

  // Reflection: ResolveException's package and the `failed` accessor differ between sbt 0.13 and 1.x.
  private def extractFailedModules(inc: sbt.Incomplete): Seq[ModuleID] = {
    val out = mutable.ListBuffer.empty[ModuleID]
    def walk(i: sbt.Incomplete): Unit = {
      i.directCause.foreach { ex =>
        val cn = ex.getClass.getName
        if (cn == "sbt.ResolveException" || cn == "sbt.librarymanagement.ResolveException") {
          try {
            val m = ex.getClass.getMethod("failed")
            out ++= m.invoke(ex).asInstanceOf[Seq[ModuleID]]
          } catch { case _: Throwable => }
        }
      }
      i.causes.foreach(walk)
    }
    walk(inc)
    out.toList.distinct
  }

  // ExclusionRule constructor shape differs between sbt 0.13 (`sbt.ExclusionRule`) and 1.x (`sbt.SbtExclusionRule`).
  private def exclusionSettings(extracted: Extracted, failed: Seq[ModuleID]): Seq[Setting[_]] = {
    val cls: Class[_] =
      try Class.forName("sbt.SbtExclusionRule")
      catch { case _: ClassNotFoundException => classOf[sbt.ExclusionRule] }

    def rule(m: ModuleID): Any =
      if (cls.getName.contains("SbtExclusionRule")) {
        cls.getConstructors.find(_.getParameterCount == 5) match {
          case Some(ctor) =>
            ctor.newInstance(m.organization, m.name, "*", Seq(), sbt.CrossVersion.Disabled)
          case None =>
            throw new IllegalStateException("No suitable SbtExclusionRule constructor")
        }
      } else ExclusionRule(organization = m.organization, name = m.name)

    def castSeq[T](xs: Seq[Any])(implicit ct: ClassTag[T]): Seq[T] = xs.map(_.asInstanceOf[T])

    extracted.structure.allProjectRefs.map { ref =>
      excludeDependencies.in(ref) := {
        val original = excludeDependencies.in(ref).value
        castSeq(original ++ failed.map(rule))(ClassTag(cls))
      }
    }
  }

  // Fold one project's UpdateReport into one tree per configuration (rootKey -> tree), keyed by coordinate.
  private def foldReport(
      report: UpdateReport,
      ref: ProjectRef,
      extracted: Extracted,
      matcher: String => Boolean,
      scannedConfigs: mutable.LinkedHashSet[String],
      withFiles: Boolean,
      populateScope: Option[Set[String]],
      moduleExts: Map[String, String]
  ): mutable.LinkedHashMap[String, RootTree] = {
    val perRoot = mutable.LinkedHashMap.empty[String, RootTree]
    val rootGav = gavKey(rootIdOf(extracted, ref))

    def emittable(m: ModuleReport): Boolean = !m.evicted

    def inScope(m: ModuleID): Boolean = populateScope match {
      case None       => true
      case Some(gavs) => gavs.contains(gavKey(m))
    }

    report.configurations.foreach { cr =>
      val cfg = confName(cr)
      if (matcher(cfg)) {
        scannedConfigs += cfg
        val prod = isProdConf(cfg) && !isTestConf(cfg)
        val nodes = mutable.LinkedHashMap.empty[String, Node]
        // module GAV -> component ids (caller edges are module-level).
        val midToIds = mutable.HashMap.empty[String, mutable.LinkedHashSet[String]]

        cr.modules.foreach { m =>
          if (emittable(m)) {
            val ids = midToIds.getOrElseUpdate(gavKey(m.module), mutable.LinkedHashSet.empty[String])
            variantsOf(m, moduleExts).foreach { case (coord, fileOpt) =>
              val node = nodes.getOrElseUpdate(coord.id, new Node(coord))
              ids += coord.id
              if (withFiles && inScope(m.module)) fileOpt.foreach(f => node.targets += f.getAbsolutePath)
            }
          }
        }

        // Caller edges within this config: a root caller marks the child direct, any other becomes its parent.
        cr.modules.foreach { m =>
          if (emittable(m)) {
            midToIds.get(gavKey(m.module)).foreach { childIds =>
              m.callers.foreach { c =>
                val callerKey = gavKey(c.caller)
                if (callerKey == rootGav) childIds.foreach(cid => nodes(cid).direct = true)
                else
                  midToIds.get(callerKey).foreach { parentIds =>
                    // Drop self-edges (test → main resolving to the same coordinate), matching gradle.
                    parentIds.foreach(pid => childIds.foreach(cid => if (pid != cid) nodes(pid).children += cid))
                  }
              }
            }
          }
        }

        if (nodes.nonEmpty) perRoot(ref.project + "::" + cfg) = new RootTree(ref.project, cfg, prod, nodes)
      }
    }
    perRoot
  }

  private def variantsOf(m: ModuleReport, moduleExts: Map[String, String]): Seq[(Coord, Option[File])] = {
    val mid = m.module
    // `mid.revision` is normally set for a resolved module, but normalize null (Coord.id calls
    // `.nonEmpty`, which NPEs on null) to match the other call sites (gavKey, module records).
    val ver = if (mid.revision == null) "" else mid.revision
    val arts = m.artifacts
    if (arts == null || arts.isEmpty)
      // No resolved artifact (e.g. an inter-project dep): stamp the module's real ext if it's a build
      // module (matches depscan's ext=jar), else leave ext-less.
      Seq((Coord(mid.organization, mid.name, ver, moduleExts.getOrElse(gavKey(mid), ""), ""), None))
    else
      arts.toList.map {
        case (art, file) =>
          (Coord(mid.organization, mid.name, ver, extOf(art), classifierOf(art)), Option(file))
      }
  }

  // ---- config selection ---------------------------------------------------

  // With no includes the default is ALL configurations (captures build/tooling deps).
  private def buildConfigMatcher(): String => Boolean = {
    def parse(prop: String): List[java.util.regex.Pattern] =
      sys.props.get(prop) match {
        case Some(s) if s.trim.nonEmpty =>
          s.split(",").map(_.trim).filter(_.nonEmpty).toList.map(globToRegex)
        case _ => Nil
      }
    val includes = parse("socket.includeConfigs")
    val excludes = parse("socket.excludeConfigs")
    (name: String) => {
      val included =
        if (includes.isEmpty) true
        else includes.exists(_.matcher(name).matches())
      included && !excludes.exists(_.matcher(name).matches())
    }
  }

  private def globToRegex(glob: String): java.util.regex.Pattern = {
    val sb = new StringBuilder
    glob.foreach {
      case '*' => sb.append(".*")
      case '?' => sb.append('.')
      case c if "\\.^$|+()[]{}".indexOf(c.toInt) >= 0 =>
        sb.append('\\').append(c)
      case c => sb.append(c)
    }
    java.util.regex.Pattern.compile(sb.toString, java.util.regex.Pattern.CASE_INSENSITIVE)
  }

  // ConfigurationReport.configuration is a String on sbt 0.13, a ConfigRef on 1.x: read `.name` reflectively.
  private def confName(cr: ConfigurationReport): String = {
    val c: Any = cr.configuration
    try c.getClass.getMethod("name").invoke(c).toString
    catch { case _: Throwable => c.toString }
  }

  private def isTestConf(name: String): Boolean = name.toLowerCase.contains("test")

  // Only feeds the informational `dev` flag, never gates analysis.
  private def isProdConf(name: String): Boolean = {
    val n = name.toLowerCase
    n == "compile" || n == "runtime"
  }

  // ---- misc helpers --------------------------------------------------------

  private def boolProp(name: String): Boolean =
    java.lang.Boolean.parseBoolean(sys.props.getOrElse(name, "false"))

  private def readPopulateScope(): Option[Set[String]] = {
    sys.props.get("socket.populateFilesFor").map(_.trim).filter(_.nonEmpty) match {
      case None => None
      case Some(path) =>
        val f = new java.io.File(path)
        if (!f.exists) {
          println("[socket-facts] WARN populateFilesFor file not found; recording files for all resolved artifacts")
          None
        } else {
          val src = scala.io.Source.fromFile(f, "UTF-8")
          try {
            val set = src.getLines().map(_.trim).filter(_.nonEmpty).toSet
            if (set.isEmpty) {
              println("[socket-facts] WARN populateFilesFor file empty; recording files for all resolved artifacts")
              None
            } else {
              println("[socket-facts] --with-files scoped to " + set.size + " SBOM artifact(s)")
              Some(set)
            }
          } finally src.close()
        }
    }
  }

  private def gavKey(m: ModuleID): String = {
    def s(v: String): String = if (v == null) "" else v
    s(m.organization) + ":" + s(m.name) + ":" + s(m.revision)
  }

  private def coordOf(m: ModuleID): String = {
    val rev = m.revision
    m.organization + ":" + m.name + (if (rev != null && rev.nonEmpty) ":" + rev else "")
  }

  private def extOf(a: Artifact): String = {
    val e = a.extension
    if (e == null || e.isEmpty) "jar" else e
  }

  private def classifierOf(a: Artifact): String =
    a.classifier.getOrElse("")

  // Backslash-escape so a value can never break line/field framing (see records.ts unescape).
  private def esc(v: String): String = {
    if (v == null) ""
    else v.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")
  }

  private final case class Failure(coord: String, detail: String, config: String)

  private final case class Coord(
      org: String,
      name: String,
      version: String,
      ext: String,
      classifier: String
  ) {
    val id: String = Seq(org, name, ext, classifier, version).filter(_.nonEmpty).mkString(":")
  }

  private final class Node(val coord: Coord) {
    val children = mutable.TreeSet.empty[String]
    var direct = false
    // External artifact's resolved jar(s); --with-files only.
    val targets = mutable.TreeSet.empty[String]
  }

  private final class RootTree(
      val projectKey: String,
      val config: String,
      val prod: Boolean,
      val nodes: mutable.LinkedHashMap[String, Node]
  )
}
