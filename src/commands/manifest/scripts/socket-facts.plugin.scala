package socket

import sbt._
import sbt.Keys._

import scala.collection.mutable

/**
 * Emits a flat line-protocol RECORDS file at the build root (NOT the final
 * `.socket.facts.json`, and NOT to stdout — sbt prints resolution noise to stdout
 * with no way to silence it). The TS assembler (utils/src/manifest-scripts/assemble.ts)
 * reads the records and owns all SBOM construction — graph merge and per-subproject
 * classpaths. This plugin only RESOLVES and emits raw facts. See records.ts for
 * the record grammar.
 *
 * Must compile on Scala 2.10/sbt 0.13 and Scala 2.12/sbt 1.x (compiled by the sbt
 * meta-build), hence string-named TaskKeys and reflection for version-specific
 * UpdateConfiguration / ResolveException / ConfigRef shapes.
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

      // `-Dsocket.excludePaths` (scan-root-relative globs): a subproject whose dir is wholly excluded is
      // never resolved and emits no project record. Source-file-level exclusion is left to the analysis.
      val excludeMatchers = parseExcludeMatchers()
      val rootCanonPath = buildRoot.getCanonicalFile.toPath
      def relTo(base: java.nio.file.Path)(f: File): String = {
        val r = base.relativize(f.getCanonicalFile.toPath).toString.replace(java.io.File.separator, "/")
        if (r.isEmpty) "." else r
      }
      def relOf(f: File): String = relTo(rootCanonPath)(f)
      // `-Dsocket.excludeBase`: the directory `--exclude-paths` is relative to (the scan root; the
      // build root by default); a project outside it never matches.
      val excludeBase = sys.props.get("socket.excludeBase").filter(_.nonEmpty)
        .map(b => new File(b).getCanonicalFile.toPath).getOrElse(rootCanonPath)
      def isExcludedRef(ref: ProjectRef): Boolean = excludeMatchers.nonEmpty && {
        val dir = extracted.get(baseDirectory.in(ref))
        // Another Windows drive than the scan root is outside it.
        dir.getCanonicalFile.toPath.getRoot == excludeBase.getRoot && {
          val rel = relTo(excludeBase)(dir)
          rel != ".." && !rel.startsWith("../") && isExcludedPath(rel, excludeMatchers)
        }
      }

      // Prefer `updateFull` (coursier `update` returns empty callers); fall back to `update` (sbt 0.13).
      val hasUpdateFull =
        extracted.structure.settings.map(_.key.key).exists(_.label == "updateFull")
      val updateTaskName = if (hasUpdateFull) "updateFull" else "update"

      // One tree per resolution root (project, config); the TS assembler merges them path-sensitively.
      val perSub = mutable.LinkedHashMap.empty[String, RootTree]
      val failures = mutable.LinkedHashSet.empty[Failure]
      val unscannable = mutable.LinkedHashSet.empty[Unscannable]
      val scannedConfigs = mutable.LinkedHashSet.empty[String]
      val matcher = buildConfigMatcher()

      // Real artifact ext per build module, so an ext-less inter-project dep gets its true coordinate.
      val moduleExts = buildModuleExts(allRefs, extracted)
      val outputSets: Map[ProjectRef, Seq[(String, Configuration)]] =
        allRefs.map(r => r -> sourceConfigs(r, extracted)).toMap

      // Every project: `update` also runs each upstream project's update, which would fail strictly.
      lazy val lenientState = extracted.append(allRefs.map(r => updateConfiguration.in(r) ~= (c => withMissingOk(c))), st)
      val pomsByCache = mutable.HashMap.empty[Option[File], PomPackaging]

      allRefs.foreach { ref =>
        if (!isExcludedRef(ref)) {
          // Built-in lm-coursier (sbt 1.3+) and the legacy sbt-coursier plugin name their caches differently.
          val legacyCoursierCache = extracted.getOpt(SettingKey[File]("coursierCache").in(ref))
          val csrCache = extracted.getOpt(SettingKey[File]("csrCacheDirectory").in(ref)).orElse(legacyCoursierCache)
          val poms = pomsByCache.getOrElseUpdate(csrCache, new PomPackaging(csrCache))
          // sbt 0.13 has no `useCoursier`: it resolves with Ivy unless the legacy plugin replaces it.
          val ivy = extracted.getOpt(SettingKey[Boolean]("useCoursier").in(ref)) match {
            case Some(useCoursier) => !useCoursier
            case None              => legacyCoursierCache.isEmpty
          }
          val resolver = new Resolver(ivy, poms)
          runUpdateResilient(updateTaskName, ref, extracted, st, lenientState, matcher, failures, unscannable, resolver)
            .foreach { case (report, unresolved, ivyUnfetched, updateFailed) =>
            foldReport(report, unresolved, ref, extracted, matcher, scannedConfigs, withFiles, populateScope, moduleExts,
              outputSets, resolver, ivyUnfetched, updateFailed, failures).foreach {
              case (rootKey, tree) => perSub(rootKey) = tree
            }
          }
        }
      }

      val moduleDirs: Map[String, Seq[(String, Seq[String], Seq[String])]] =
        if (withFiles) buildModuleDirs(allRefs, outputSets, extracted, st) else Map.empty

      // Where sbt recorded the project's own settings as defined (the root build.sbt for a subproject
      // defined there); positions outside the build are sbt defaults, plugins or our injected base.
      val buildFilesByRef: Map[ProjectRef, Seq[String]] =
        extracted.structure.settings
          .flatMap { setting =>
            (setting.key.scope.project, setting.pos) match {
              case (Select(ref: ProjectRef), pos: FilePosition) =>
                val f = new File(pos.path)
                if (f.isAbsolute && f.isFile && f.getCanonicalFile.toPath.startsWith(rootCanonPath)) Some(ref -> relOf(f))
                else None
              case _ => None
            }
          }
          .groupBy(_._1)
          .map { case (ref, pairs) => ref -> pairs.map(_._2) }

      val sb = new StringBuilder
      def rec(fields: String*): Unit = {
        sb.append(fields.map(esc).mkString("\t")); sb.append('\n')
      }

      rec("meta", "sbt", extracted.getOpt(sbtVersion).getOrElse(""), sys.props.getOrElse("java.version", ""))
      rec("buildRoot", rootCanonPath.toString)

      // One `project` record per build module (sources/targets only with --with-files). Excluded
      // subprojects get none (they were also skipped during resolution above), but keep their paths so
      // a kept project depending on one is analysed with its code.
      allRefs.foreach { ref =>
        val mid = rootIdOf(extracted, ref)
        val ver = if (mid.revision == null) "" else mid.revision
        if (isExcludedRef(ref)) {
          if (withFiles) rec("excludedProject", ref.project)
        } else {
          val baseDir = extracted.get(baseDirectory.in(ref))
          rec("project", ref.project, mid.organization, mid.name, ver, relOf(baseDir))
          (buildFilesByRef.getOrElse(ref, Nil) ++ baseBuildSbt(baseDir, rootCanonPath).map(relOf)).distinct.sorted
            .foreach(f => rec("projectBuild", ref.project, f))
        }
        // A configuration's classpath holds the code of the configurations it extends (Test: Compile).
        if (!isExcludedRef(ref) || withFiles) {
          val sets = outputSets(ref)
          sets.foreach { case (set, c) =>
            val held = Classpaths.allConfigs(c).map(_.name).toSet
            rec("outputSet", ref.project, set, sets.collect { case (o, oc) if oc.name != c.name && held(oc.name) => o }.mkString(","))
          }
        }
        if (withFiles) {
          moduleDirs.getOrElse(mid.organization + ":" + mid.name + ":" + ver, Nil).foreach {
            case (set, sources, targets) =>
              sources.foreach(s => rec("projectSrc", ref.project, s, set))
              targets.foreach(t => rec("projectTgt", ref.project, t, set))
          }
        }
      }

      // One resolution root per (subproject, configuration); the TS assembler merges them by
      // coordinate and derives each subproject's classpath from its roots.
      var rootIdx = 0
      perSub.foreach {
        case (_, tree) =>
          val rootId = rootIdx.toString
          rootIdx += 1
          rec("root", rootId, tree.projectKey, tree.config, if (tree.prod) "1" else "0", tree.outputSet, tree.role)
          tree.nodes.foreach {
            case (coordId, node) =>
              val c = node.coord
              rec("node", rootId, coordId, c.org, c.name, c.version, c.ext, c.classifier, if (node.direct) "1" else "0",
                node.project, node.outputSets.mkString(","))
              node.children.foreach(ch => rec("edge", rootId, coordId, ch))
              node.targets.foreach(p => rec("file", rootId, coordId, p))
              if (node.unfetched) rec("unfetched", rootId, coordId)
          }
      }

      // Scanned configs + raw failures (Coana owns the abort/warn policy and report rendering).
      scannedConfigs.toList.sorted.foreach(c => rec("scanned", c))
      failures.foreach(f => rec("failure", f.coord, f.detail, f.config, f.project))
      unscannable.foreach(u => rec("unscannable", "", u.detail, u.project))

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

  private def crossOf(extracted: Extracted, ref: ProjectRef): ModuleID => ModuleID =
    CrossVersion.apply(extracted.get(scalaVersion.in(ref)), extracted.get(scalaBinaryVersion.in(ref)))

  private def rootIdOf(extracted: Extracted, ref: ProjectRef): ModuleID =
    crossOf(extracted, ref)(extracted.get(projectID.in(ref)))

  // GAV -> a build module's real artifact extension (jar for a normal project). coursier reports an
  // inter-project dependency with no resolved artifact, so it would otherwise be ext-less and not
  // match how depscan ingests it (ext=jar); stamping the real ext keeps a full, matching coordinate.
  private def buildModuleExts(allRefs: Seq[ProjectRef], extracted: Extracted): Map[String, String] = {
    allRefs.map { ref =>
      val ext = extracted.getOpt(artifact.in(ref)).map(_.extension).filter(e => e != null && e.nonEmpty).getOrElse("jar")
      gavKey(rootIdOf(extracted, ref)) -> ext
    }.toMap
  }

  // A project's code by output set: Compile's as `main`, and each configuration with a class directory
  // of its own (Test, IntegrationTest, ...) under its name.
  private def sourceConfigs(ref: ProjectRef, extracted: Extracted): Seq[(String, Configuration)] = {
    val configs = extracted.getOpt(thisProject.in(ref)).map(_.configurations).getOrElse(Seq(Compile, Test))
    val mainDir = extracted.getOpt(classDirectory.in(ref).in(Compile))
    ("main" -> Compile) +: configs.filter { c =>
      c.name != Compile.name && extracted.getOpt(classDirectory.in(ref).in(c)).exists(d => !mainDir.exists(_ == d))
    }.map(c => c.name -> c)
  }

  // Absolute source roots + compiled-output dirs per build module and output set, keyed by GAV.
  // --with-files only; absolute because reachability locates an internal module's code on THIS machine
  // (no registry jar). Source-file-level exclusion is coana's job.
  private def buildModuleDirs(
      allRefs: Seq[ProjectRef],
      outputSets: Map[ProjectRef, Seq[(String, Configuration)]],
      extracted: Extracted,
      state: State
  ): Map[String, Seq[(String, Seq[String], Seq[String])]] = {
    allRefs.map { ref =>
      val mid = rootIdOf(extracted, ref)
      val ver = if (mid.revision == null) "" else mid.revision
      val sets = outputSets(ref).map { case (set, c) =>
        val sources = (extracted.getOpt(sourceDirectories.in(ref).in(c)).getOrElse(Nil) ++
          baseDirSources(ref, Seq(c), extracted, state))
          .map(_.getAbsolutePath).distinct.sorted
        val targets = extracted.getOpt(classDirectory.in(ref).in(c)).toSeq.map(_.getAbsolutePath)
        (set, sources, targets)
      }
      (mid.organization + ":" + mid.name + ":" + ver) -> sets
    }.toMap
  }

  // Sources sbt compiles from the base dir itself (`sourcesInBase`), as files: sbt includes them
  // non-recursively, and the base dir as a source root would be walked into nested subprojects.
  private def baseDirSources(
      ref: ProjectRef,
      configs: Seq[Configuration],
      extracted: Extracted,
      state: State
  ): Seq[File] = {
    val base = extracted.get(baseDirectory.in(ref)).getCanonicalFile
    // A configuration that only inherits the task (Runtime from Compile) would re-run the same walk.
    val definingScopes = configs.flatMap { c =>
      val key = unmanagedSources.in(ref).in(c)
      extracted.structure.data.definingScope(key.scope, key.key)
    }.distinct
    definingScopes.flatMap { scope =>
      Project.runTask(Def.ScopedKey(scope, unmanagedSources.key), state) match {
        case Some((_, sbt.Value(files))) =>
          files.groupBy(_.getAbsoluteFile.getParentFile).collect {
            case (dir, inDir) if dir.getCanonicalFile == base => inDir
          }.flatten
        case _ => Nil
      }
    }
  }

  // A failure naming no module is an artifact that could not be fetched, which only the lenient
  // report's missing artifacts reveal; with neither, the project is unscannable.
  private def runUpdateResilient(
      taskName: String,
      ref: ProjectRef,
      extracted: Extracted,
      state: State,
      lenient: => State,
      matcher: String => Boolean,
      failures: mutable.LinkedHashSet[Failure],
      unscannable: mutable.LinkedHashSet[Unscannable],
      resolver: Resolver
  ): Option[(UpdateReport, Set[String], IvyUnfetched, Boolean)] = {
    val key = TaskKey[UpdateReport](taskName)

    def runOn(st: State): Either[(Seq[ModuleID], String), UpdateReport] =
      Project.runTask(key.in(ref).scopedKey, st) match {
        case Some((_, sbt.Value(rep))) => Right(rep)
        case Some((_, sbt.Inc(inc)))   => Left((extractFailedModules(inc), incompleteMessage(inc)))
        case _                         => Left((Nil, s"$taskName did not run"))
      }

    runOn(state) match {
      case Right(rep) => Some((rep, Set.empty[String], Map.empty: IvyUnfetched, false))
      case Left((failed, detail)) =>
        val lenientRun = runOn(lenient).right.map { rep =>
          (rep, if (resolver.ivy) ivyUnfetchedOf(rep, extracted.get(target.in(ref))) else Map.empty: IvyUnfetched)
        }
        lenientRun match {
          case Right((rep, ivyUnfetched))
              if failed.isEmpty && ivyUnfetched.isEmpty &&
                !rep.configurations.exists(_.modules.exists(m => !m.evicted && resolver.missingOf(m).nonEmpty)) =>
            unscannable += Unscannable(detail, ref.project)
            None
          case Right((rep, ivyUnfetched)) =>
            val confsByGav = mutable.HashMap.empty[String, mutable.LinkedHashSet[String]]
            rep.configurations.foreach { cr =>
              cr.modules.foreach { r =>
                if (!r.evicted) confsByGav.getOrElseUpdate(gavKey(r.module), mutable.LinkedHashSet.empty[String]) += confName(cr)
              }
            }
            failed.foreach { m =>
              // Absent from the graph: no configuration. Present only in excluded ones: not reported.
              confsByGav.get(gavKey(m)) match {
                case None        => failures += Failure(coordOf(m), detailFor(m, detail), "", ref.project)
                case Some(confs) => confs.filter(matcher).foreach(c => failures += Failure(coordOf(m), detailFor(m, detail), c, ref.project))
              }
            }
            Some((rep, failed.map(gavKey).toSet, ivyUnfetched, failed.isEmpty))
          case Left(_) =>
            // Even a lenient update failed: the whole project is unresolved, but the modules sbt
            // named are still reported.
            failed.foreach(m => failures += Failure(coordOf(m), detailFor(m, detail), "", ref.project))
            unscannable += Unscannable(detail, ref.project)
            None
        }
    }
  }

  // config -> "org:name:rev" -> artifacts Ivy failed to download.
  private type IvyUnfetched = Map[String, Map[String, Seq[IvyArtifact]]]

  private final case class IvyArtifact(ext: String, classifier: String, detail: String)

  // sbt 0.13's UpdateReport omits artifacts Ivy failed to download; Ivy's own report per configuration,
  // `<resolution cache>/reports/<organisation>-<module>-<conf>.xml`, keeps them.
  private def ivyUnfetchedOf(rep: UpdateReport, projectTarget: File): IvyUnfetched = {
    val descriptor = Option(rep.cachedDescriptor).filter(_.isFile)
    val bound = projectTarget.getCanonicalFile.toPath
    def reportsDirs(f: File): Stream[File] =
      Option(f.getParentFile).filter(_.getCanonicalFile.toPath.startsWith(bound)).toStream
        .flatMap(p => new File(p, "reports") #:: reportsDirs(p))
    (for {
      d <- descriptor.toSeq
      id <- ivyResolveId(d).toSeq
      cr <- rep.configurations
      conf = confName(cr)
      report <- reportsDirs(d).map(new File(_, id + "-" + conf + ".xml")).find(_.isFile).toSeq
      arts = ivyFailedArtifacts(report)
      if arts.nonEmpty
    } yield conf -> arts).toMap
  }

  private def parseXml(f: File): org.w3c.dom.Document = {
    // A POM may declare a DOCTYPE, so only what it could pull in from outside is refused.
    val dbf = javax.xml.parsers.DocumentBuilderFactory.newInstance()
    dbf.setFeature(javax.xml.XMLConstants.FEATURE_SECURE_PROCESSING, true)
    dbf.setFeature("http://xml.org/sax/features/external-general-entities", false)
    dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false)
    dbf.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
    dbf.setXIncludeAware(false)
    dbf.setExpandEntityReferences(false)
    dbf.newDocumentBuilder().parse(f)
  }

  // Child elements by local name; "*" for all.
  private def pomKids(e: org.w3c.dom.Element, name: String): Seq[org.w3c.dom.Element] = {
    val ns = e.getChildNodes
    (0 until ns.getLength).map(ns.item).collect {
      case c: org.w3c.dom.Element if name == "*" || c.getNodeName.split(':').last == name => c
    }
  }

  private def pomText(e: org.w3c.dom.Element, name: String): Option[String] =
    pomKids(e, name).headOption.map(_.getTextContent.trim).filter(_.nonEmpty)

  private def pomGroupId(e: org.w3c.dom.Element): String =
    pomText(e, "groupId").orElse(pomKids(e, "parent").headOption.flatMap(pomText(_, "groupId"))).getOrElse("")

  private val PropertyRef = "\\$\\{([^}]+)\\}".r

  // A POM after inheritance: its dependencies (groupId:artifactId -> declared scope, optional), its
  // managed scopes, the BOMs it imports, and its properties.
  private final case class PomModel(
      deps: Map[String, (String, Boolean)],
      managed: Map[String, String],
      imports: Seq[(String, String, String)],
      props: Map[String, String])

  private object PomModel {
    val empty = PomModel(Map.empty, Map.empty, Nil, Map.empty)
  }

  // Until nothing changes, as a property's value may refer to another.
  private def interpolate(s: String, props: Map[String, String]): String = {
    var cur = s
    var prev = ""
    var rounds = 0
    while (cur != prev && rounds < 16) {
      prev = cur
      cur = PropertyRef.replaceAllIn(cur, m => java.util.regex.Matcher.quoteReplacement(props.getOrElse(m.group(1), m.matched)))
      rounds += 1
    }
    cur
  }

  // Ivy's ResolveOptions.getDefaultResolveId: `<organisation>-<module>` of the resolved descriptor.
  private def ivyResolveId(descriptor: File): Option[String] =
    try {
      val info = parseXml(descriptor).getElementsByTagName("info")
      if (info.getLength == 0) None
      else {
        val e = info.item(0).asInstanceOf[org.w3c.dom.Element]
        Some(e.getAttribute("organisation") + "-" + e.getAttribute("module"))
      }
    } catch { case _: Exception => None }

  private def ivyFailedArtifacts(report: File): Map[String, Seq[IvyArtifact]] =
    try {
      val modules = parseXml(report).getElementsByTagName("module")
      val out = for {
        mi <- 0 until modules.getLength
        module = modules.item(mi).asInstanceOf[org.w3c.dom.Element]
        revisions = module.getElementsByTagName("revision")
        ri <- 0 until revisions.getLength
        revision = revisions.item(ri).asInstanceOf[org.w3c.dom.Element]
        if revision.getAttribute("evicted").isEmpty
        artifacts = revision.getElementsByTagName("artifact")
        ai <- 0 until artifacts.getLength
        a = artifacts.item(ai).asInstanceOf[org.w3c.dom.Element]
        if a.getAttribute("status") == "failed"
      } yield {
        val (org, name, rev) = (module.getAttribute("organisation"), module.getAttribute("name"), revision.getAttribute("name"))
        val classifier = a.getAttribute("extra-classifier")
        val file = a.getAttribute("name") + (if (classifier.isEmpty) "" else "-" + classifier) + "." + a.getAttribute("ext")
        // An absent artifact is "missing artifact" (empty under sbt 0.13's Ivy); one the resolver chain
        // failed itself has "null"; anything else is a transfer failure's message.
        val details = a.getAttribute("details")
        val cause =
          if (details.isEmpty || details == "missing artifact") "not found"
          else if (details == "null") "download failed"
          else "download failed (" + details + ")"
        (org + ":" + name + ":" + rev) -> IvyArtifact(a.getAttribute("ext"), classifier, cause + ": " + org + "#" + name + ";" + rev + "!" + file)
      }
      out.groupBy(_._1).map { case (gav, pairs) => gav -> pairs.map(_._2).distinct }
    } catch { case _: Exception => Map.empty }

  // UpdateConfiguration has `withMissingOk` on sbt 1.x; on 0.13 its only Boolean field is missingOk.
  private def withMissingOk[T](c: T): T = {
    val cls = c.getClass
    try cls.getMethod("withMissingOk", classOf[Boolean]).invoke(c, java.lang.Boolean.TRUE).asInstanceOf[T]
    catch {
      case _: NoSuchMethodException =>
        val copy = cls.getMethods.find(_.getName == "copy").get
        val args = copy.getParameterTypes.zipWithIndex.map { case (t, i) =>
          if (t == classOf[Boolean]) java.lang.Boolean.TRUE
          else cls.getMethod("copy$default$" + (i + 1)).invoke(c)
        }
        copy.invoke(c, args: _*).asInstanceOf[T]
    }
  }

  // One module's part of a batch resolve message, so records grow with the failure count, not its
  // square: Coursier writes an indented "Error downloading org:name:rev" block per module, Ivy a line.
  private def detailFor(m: ModuleID, batch: String): String = {
    val lines = batch.split("\n").toList
    val keys = Seq(coordOf(m), s"${orEmpty(m.organization)}#${orEmpty(m.name)};${orEmpty(m.revision)}")
    val start = lines.indexWhere(l => keys.exists(k => l.contains(k)))
    if (start < 0) lines.map(_.trim).find(_.nonEmpty).getOrElse(batch)
    else (lines(start) :: lines.drop(start + 1).takeWhile(l => l.startsWith(" ") || l.startsWith("\t"))).mkString("\n").trim
  }

  private def incompleteMessage(inc: sbt.Incomplete): String = {
    def first(i: sbt.Incomplete): Option[String] =
      i.directCause.flatMap(ex => Option(ex.getMessage)).orElse(i.causes.view.flatMap(first).headOption)
    first(inc).map(_.trim).filter(_.nonEmpty).getOrElse("unresolved dependency")
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

  // Fold one project's UpdateReport into one tree per configuration (rootKey -> tree), keyed by coordinate.
  private def foldReport(
      report: UpdateReport,
      unresolved: Set[String],
      ref: ProjectRef,
      extracted: Extracted,
      matcher: String => Boolean,
      scannedConfigs: mutable.LinkedHashSet[String],
      withFiles: Boolean,
      populateScope: Option[Set[String]],
      moduleExts: Map[String, String],
      outputSets: Map[ProjectRef, Seq[(String, Configuration)]],
      resolver: Resolver,
      ivyUnfetched: IvyUnfetched,
      // sbt's own update failed on artifacts alone, so one it could not fetch is a failure even
      // without files.
      updateFailed: Boolean,
      failures: mutable.LinkedHashSet[Failure]
  ): mutable.LinkedHashMap[String, RootTree] = {
    val perRoot = mutable.LinkedHashMap.empty[String, RootTree]
    val rootKey = moduleKey(rootIdOf(extracted, ref))

    // Build modules come from the build structure instead: lm-coursier lists every inter-project
    // dependency in every configuration, and cross-versioning can merge distinct ones.
    def emittable(m: ModuleReport): Boolean =
      !m.evicted && !moduleExts.contains(gavKey(m.module)) && !unresolved.contains(gavKey(m.module))

    def confsOf(r: ProjectRef): Seq[Configuration] = extracted.getOpt(ivyConfigurations.in(r)).getOrElse(Nil)
    lazy val refByProject: Map[String, ProjectRef] = extracted.structure.allProjectRefs.map(r => r.project -> r).toMap
    // Whether build project `r` declares module `c` in one of `confs`. A declaration without a
    // configuration goes to Compile; the report names the module cross-versioned.
    def declares(r: ProjectRef, c: ModuleID, confs: Set[String]): Boolean = {
      val cross = crossOf(extracted, r)
      extracted.getOpt(libraryDependencies.in(r)).getOrElse(Nil).exists { d =>
        val masters = d.configurations.getOrElse("compile").split(';').flatMap(_.split("->").head.split(',')).map(_.trim)
        d.organization == c.organization && cross(d).name == c.name && masters.exists(m => m == "*" || confs(m))
      }
    }
    val buildDeps = extracted.get(buildDependencies)

    // Classpaths.interSort, recording the (project -> dependency project) edges it follows and the
    // configurations of each project it reaches.
    def interProjectEdges(conf: Configuration): (mutable.LinkedHashSet[(ProjectRef, ProjectRef)], Map[String, Set[String]]) = {
      val masterConfs = confsOf(ref).map(_.name)
      val visited = mutable.HashSet.empty[(ProjectRef, String)]
      val edges = mutable.LinkedHashSet.empty[(ProjectRef, ProjectRef)]
      def visit(p: ProjectRef, c: Configuration): Unit = {
        val applicable = Classpaths.allConfigs(c)
        applicable.foreach(ac => visited += (p -> ac.name))
        buildDeps.classpath.getOrElse(p, Nil).foreach { d =>
          val depConfs = confsOf(d.project)
          val mapping = Classpaths.mapped(d.configuration, masterConfs, depConfs.map(_.name), "compile", "*->compile")
          for {
            ac <- applicable
            depConfName <- mapping(ac.name)
            depConf <- depConfs.find(_.name == depConfName)
          } {
            edges += (p -> d.project)
            if (!visited((d.project, depConfName))) visit(d.project, depConf)
          }
        }
      }
      visit(ref, conf)
      (edges, visited.toSeq.groupBy(_._1.project).map { case (p, vs) => p -> vs.map(_._2).toSet })
    }

    def buildModuleCoord(r: ProjectRef): Coord = {
      val mid = rootIdOf(extracted, r)
      val ver = if (mid.revision == null) "" else mid.revision
      Coord(mid.organization, mid.name, ver, moduleExts.getOrElse(gavKey(mid), ""), "")
    }

    def inScope(m: ModuleID): Boolean = populateScope match {
      case None       => true
      case Some(gavs) => gavs.contains(gavKey(m))
    }

    // The configuration sbt resolves a configuration's classpath for: the first of its internal one
    // (compile-internal, ...), Compile and Default the report has (Defaults.findClasspathConfig).
    val reported = report.configurations.map(confName).toSet
    def classpathConf(c: Configuration): Option[String] = {
      val internal = extracted.getOpt(internalConfigurationMap.in(ref)).map(_(c).name).getOrElse(c.name)
      Seq(internal, Compile.name, "default").find(reported)
    }
    // Each output set's runtime classpath, and Compile's, which adds the compile-only (Provided) entries.
    val classpathRoles: Map[String, (String, String)] =
      outputSets(ref).flatMap { case (set, c) =>
        classpathConf(if (set == "main") Runtime else c).map(_ -> ((set, "runtime")))
      }.toMap ++ classpathConf(Compile).map(_ -> (("main", "compile")))

    report.configurations.foreach { cr =>
      val cfg = confName(cr)
      if (matcher(cfg)) {
        scannedConfigs += cfg
        val prod = isProdConf(cfg) && !isTestConf(cfg)
        val nodes = mutable.LinkedHashMap.empty[String, Node]
        // org:name -> component ids (caller edges are module-level).
        val midToIds = mutable.HashMap.empty[String, mutable.LinkedHashSet[String]]
        var reachedConfs = Map.empty[String, Set[String]]

        confsOf(ref).find(_.name == cfg).foreach { conf =>
          // Keyed by project id, as projects need not have distinct coordinates.
          // A dependency on a build project brings in the output sets of the configurations it reaches.
          def buildModuleNode(r: ProjectRef): String = {
            midToIds.getOrElseUpdate(moduleKey(rootIdOf(extracted, r)), mutable.LinkedHashSet.empty[String]) += r.project
            val node = nodes.getOrElseUpdate(r.project, {
              val node = new Node(buildModuleCoord(r))
              node.project = r.project
              node
            })
            val confs = reachedConfs.getOrElse(r.project, Set.empty[String])
            node.outputSets ++= outputSets.getOrElse(r, Nil)
              .collect { case (set, c) if confs(c.name) => set }
            r.project
          }
          val (edges, reached) = interProjectEdges(conf)
          reachedConfs = reached
          edges.foreach { case (p, d) =>
            val child = buildModuleNode(d)
            if (p == ref) nodes(child).direct = true
            else nodes(buildModuleNode(p)).children += child
          }
        }

        cr.modules.foreach { m =>
          if (emittable(m)) {
            val ids = midToIds.getOrElseUpdate(moduleKey(m.module), mutable.LinkedHashSet.empty[String])
            val ivyMissing =
              if (ivyUnfetched.isEmpty) Nil
              else ivyUnfetched.getOrElse(cfg, Map.empty[String, Seq[IvyArtifact]]).getOrElse(gavKey(m.module), Nil)
            val recordFiles = withFiles && inScope(m.module)
            variantsOf(m, resolver, ivyMissing).foreach { v =>
              val node = nodes.getOrElseUpdate(v.coord.id, new Node(v.coord))
              ids += v.coord.id
              if (recordFiles) v.file.foreach(f => node.targets += f.getAbsolutePath)
              v.unfetched.foreach { url =>
                if (recordFiles) node.unfetched = true
                if (recordFiles || updateFailed) failures += Failure(coordOf(m.module), url, cfg, ref.project)
              }
            }
          }
        }

        // Caller edges within this config: a root caller marks the child direct, any other becomes its parent.
        // Coursier resolves a Maven relocation's target in place of the relocating module, but reports
        // neither the relocating module nor who declared it, so that caller is missing from the report.
        // Its declarers are read off the build's own declarations and the POMs instead.
        val candidates = cr.modules.filter(emittable)
        // Drops self-edges (test → main resolving to the same coordinate), matching gradle.
        def link(parentIds: Iterable[String], childIds: Iterable[String]): Unit =
          parentIds.foreach(pid => childIds.foreach(cid => if (pid != cid) nodes(pid).children += cid))
        def declaredBy(p: String, c: ModuleID): Boolean =
          refByProject.get(p).exists(declares(_, c, reachedConfs.getOrElse(p, Set.empty)))
        candidates.foreach { m =>
          midToIds.get(moduleKey(m.module)).foreach { childIds =>
            // lm-coursier gives a declared caller its declared revision, not the resolved one, so
            // callers match by org:name (a configuration resolves one version per module).
            m.callers.foreach { c =>
              val callerKey = moduleKey(c.caller)
              if (callerKey == rootKey) childIds.foreach(cid => nodes(cid).direct = true)
              else midToIds.get(callerKey) match {
                case Some(parentIds) => link(parentIds, childIds)
                case None if !resolver.ivy && resolver.poms.relocates(c.caller, m) =>
                  if (declaredBy(ref.project, c.caller)) childIds.foreach(cid => nodes(cid).direct = true)
                  link(nodes.collect { case (nid, n) if n.project.nonEmpty && declaredBy(n.project, c.caller) => nid }, childIds)
                  resolver.poms.declaringModules(c.caller, candidates).foreach(p => midToIds.get(moduleKey(p)).foreach(link(_, childIds)))
                case None =>
              }
            }
          }
        }

        if (nodes.nonEmpty) {
          val (set, role) = classpathRoles.getOrElse(cfg, ("", ""))
          perRoot(ref.project + "::" + cfg) = new RootTree(ref.project, cfg, prod, set, role, nodes)
        }
      }
    }
    perRoot
  }

  private def variantsOf(m: ModuleReport, resolver: Resolver, ivyMissing: Seq[IvyArtifact]): Seq[Variant] = {
    val mid = m.module
    // `mid.revision` is normally set for a resolved module, but normalize null (Coord.id calls
    // `.nonEmpty`, which NPEs on null) to match the other call sites (gavKey, module records).
    val ver = if (mid.revision == null) "" else mid.revision
    def coordFor(art: Artifact) = Coord(mid.organization, mid.name, ver, extOf(art), classifierOf(art))
    val fetched = Option(m.artifacts).toList.flatten.map { case (art, file) => Variant(coordFor(art), Option(file), None) }
    val missing = resolver.missingOf(m).map { art =>
      // The update report does not say why: a 401 or a timeout is as likely as an absent file.
      Variant(coordFor(art), None, Some("could not be fetched: " + art.url.map(_.toString).getOrElse(coordFor(art).id)))
    } ++ ivyMissing.map(a => Variant(Coord(mid.organization, mid.name, ver, a.ext, a.classifier), None, Some(a.detail)))
    if (fetched.isEmpty && missing.isEmpty)
      // No artifact expected (a pom-only module): leave it ext-less.
      Seq(Variant(Coord(mid.organization, mid.name, ver, "", ""), None, None))
    else fetched ++ missing
  }

  // Artifacts the resolver expected and did not fetch. Under Ivy they come from its resolution report
  // instead (see ivyUnfetchedOf).
  private final class Resolver(val ivy: Boolean, val poms: PomPackaging) {
    def missingOf(m: ModuleReport): List[Artifact] =
      if (ivy) Nil else Option(m.missingArtifacts).toList.flatten.filterNot(poms.isUnexpectedDefault)
  }

  // Coursier requests the default jar of every Maven module and skips it silently when absent unless
  // the POM declares a jar packaging. Only the module's own POM tells whether its artifact is a jar
  // (packaging defaults to jar, so a parent's never applies); an unreadable POM counts as one.
  private final class PomPackaging(csrCacheDir: Option[File]) {
    private val pomMemo = mutable.HashMap.empty[String, Option[org.w3c.dom.Element]]

    private def pom(url: String): Option[org.w3c.dom.Element] =
      pomMemo.getOrElseUpdate(url, coursierLocalFiles(url, csrCacheDir).find(_.isFile).flatMap { f =>
        try Some(parseXml(f).getDocumentElement)
        catch { case _: Exception => None }
      })

    // Maven repository layout.
    private def moduleDir(base: String, org: String, name: String): String =
      base + org.replace('.', '/') + "/" + name + "/"

    private def pomUrl(base: String, org: String, name: String, rev: String): String =
      moduleDir(base, org, name) + rev + "/" + name + "-" + rev + ".pom"

    // The repository root a module's artifacts were fetched from.
    private def repoBase(m: ModuleReport): Option[String] = {
      val mid = m.module
      val marker = moduleDir("/", mid.organization, mid.name) + orEmpty(mid.revision) + "/"
      val urls = Option(m.artifacts).toList.flatten.flatMap(_._1.url) ++
        Option(m.missingArtifacts).toList.flatten.flatMap(_.url)
      urls.map(_.toString).collectFirst { case u if u.contains(marker) => u.substring(0, u.indexOf(marker) + 1) }
    }

    private val modelMemo = mutable.HashMap.empty[String, PomModel]

    // Maven model inheritance and interpolation of a POM, as far as its dependencies' scopes need.
    private def model(base: String, org: String, name: String, rev: String, depth: Int): PomModel = {
      val url = pomUrl(base, org, name, rev)
      modelMemo.getOrElseUpdate(url, pom(url) match {
        case None => PomModel.empty
        case Some(e) =>
          val parent = pomKids(e, "parent").headOption
          val pm = parent match {
            case Some(p) if depth < 16 =>
              model(base, pomText(p, "groupId").getOrElse(""), pomText(p, "artifactId").getOrElse(""),
                pomText(p, "version").getOrElse(""), depth + 1)
            case _ => PomModel.empty
          }
          val groupId = pomGroupId(e)
          val artifactId = pomText(e, "artifactId").getOrElse("")
          val version = pomText(e, "version").orElse(parent.flatMap(pomText(_, "version"))).getOrElse("")
          val own = pomKids(e, "properties").flatMap(ps => pomKids(ps, "*")).map(p => p.getNodeName.split(':').last -> p.getTextContent.trim)
          val props = pm.props ++ own ++ Seq(
            "project.groupId" -> groupId, "pom.groupId" -> groupId, "groupId" -> groupId,
            "project.artifactId" -> artifactId, "pom.artifactId" -> artifactId, "artifactId" -> artifactId,
            "project.version" -> version, "pom.version" -> version, "version" -> version
          ) ++ parent.toSeq.flatMap { p =>
            Seq("project.parent.groupId" -> pomText(p, "groupId").getOrElse(""),
              "project.parent.version" -> pomText(p, "version").getOrElse(""))
          }
          def field(d: _root_.org.w3c.dom.Element, name: String) = interpolate(pomText(d, name).getOrElse(""), props)
          def ga(d: _root_.org.w3c.dom.Element) = field(d, "groupId") + ":" + field(d, "artifactId")
          val deps = pomKids(e, "dependencies").flatMap(ds => pomKids(ds, "dependency"))
          val managed = pomKids(e, "dependencyManagement").flatMap(pomKids(_, "dependencies")).flatMap(pomKids(_, "dependency"))
          val (imports, scoped) = managed.partition(d => field(d, "scope") == "import" && field(d, "type") == "pom")
          PomModel(
            pm.deps ++ deps.map(d => ga(d) -> ((field(d, "scope"), field(d, "optional") == "true"))),
            pm.managed ++ scoped.map(d => ga(d) -> field(d, "scope")),
            imports.map(d => (field(d, "groupId"), field(d, "artifactId"), field(d, "version"))) ++ pm.imports,
            props)
      })
    }

    private val managedMemo = mutable.HashMap.empty[String, Map[String, String]]

    // Managed scopes after BOM imports: the POM's own and inherited entries win, then the first import.
    private def managedScopes(base: String, org: String, name: String, rev: String, depth: Int): Map[String, String] =
      managedMemo.getOrElseUpdate(pomUrl(base, org, name, rev), {
        val m = model(base, org, name, rev, 0)
        m.imports.reverse.foldLeft(Map.empty[String, String]) { case (acc, (g, a, v)) =>
          if (depth < 16) acc ++ managedScopes(base, g, a, v, depth + 1) else acc
        } ++ m.managed
      })

    // org:name of the modules each relocating module's cached POMs relocate to.
    private val relocationsMemo = mutable.HashMap.empty[(String, String), Set[String]]

    // Whether `relocating` is a POM relocated to `target`'s module. The report gives the relocating
    // module its declared revision, which may be a range, so every cached version is tried; the
    // target may have resolved to another version than the relocation names.
    def relocates(relocating: ModuleID, target: ModuleReport): Boolean =
      repoBase(target).exists { base =>
        relocationsMemo.getOrElseUpdate((base, gavKey(relocating)), {
          val dir = moduleDir(base, relocating.organization, relocating.name)
          val versions = orEmpty(relocating.revision) +: coursierLocalFiles(dir, csrCacheDir)
            .flatMap(d => Option(d.listFiles).toSeq.flatten).filter(_.isDirectory).map(_.getName)
          versions.distinct.flatMap { v =>
            pom(pomUrl(base, relocating.organization, relocating.name, v)).toSeq.flatMap { e =>
              pomKids(e, "distributionManagement").flatMap(pomKids(_, "relocation")).headOption.map { r =>
                pomText(r, "groupId").getOrElse(pomGroupId(e)) + ":" +
                  pomText(r, "artifactId").orElse(pomText(e, "artifactId")).getOrElse("")
              }
            }
          }.toSet
        })(moduleKey(target.module))
      }

    // The modules among `candidates` whose POM passes `declared` on to their dependents: compile or
    // runtime scope, declared or managed, and not optional.
    def declaringModules(declared: ModuleID, candidates: Seq[ModuleReport]): Seq[ModuleID] = {
      val key = moduleKey(declared)
      candidates.filter { p =>
        repoBase(p).exists { base =>
          val m = model(base, p.module.organization, p.module.name, orEmpty(p.module.revision), 0)
          m.deps.get(key).exists { case (scope, optional) =>
            val effective =
              if (scope.nonEmpty) scope
              else managedScopes(base, p.module.organization, p.module.name, orEmpty(p.module.revision), 0).getOrElse(key, "")
            Set("", "compile", "runtime")(effective) && !optional
          }
        }
      }.map(_.module)
    }

    def isUnexpectedDefault(a: Artifact): Boolean = {
      val ext = extOf(a)
      a.classifier.isEmpty && ext == "jar" && a.url.map(_.toString).exists { url =>
        url.endsWith("." + ext) &&
          pom(url.dropRight(ext.length) + "pom").exists(e => !JarPackagings(pomText(e, "packaging").getOrElse("jar")))
      }
    }
  }

  // coursier.maven.MavenAttributes.typeExtensions (2.1.24, which adds ejb): the packagings whose
  // artifact is a `.jar`. Any other packaging (pom, aar, war, ...) publishes its own artifact.
  private val JarPackagings = Set("eclipse-plugin", "maven-plugin", "hk2-jar", "orbit", "scala-jar", "jar", "bundle",
    "doc", "src", "test-jar", "ejb-client", "ejb")

  // coursier.paths.CachePath.localFile. A repository with credentials is cached under `user@host`,
  // and the update report does not carry the user.
  private def coursierLocalFiles(url: String, csrCacheDir: Option[File]): Seq[File] =
    if (url.startsWith("file:/"))
      try Seq(new File(new java.net.URI(url)))
      catch { case _: Exception => Nil }
    else {
      val i = url.indexOf(':')
      val protocol = if (i < 0) "" else url.substring(0, i)
      val rest = if (i < 0) "" else url.substring(i + 1).dropWhile(_ == '/')
      csrCacheDir.toSeq.flatMap { dir =>
        val protocolDir = new File(dir, coursierEscape(protocol))
        val host = coursierEscape(rest.takeWhile(_ != '/'))
        val path = coursierEscape(rest.dropWhile(_ != '/').drop(1))
        val withUser = Option(protocolDir.listFiles).toSeq.flatten.filter(_.getName.endsWith("%40" + host))
        (new File(protocolDir, host) +: withUser).map(new File(_, path))
      }
    }

  private def coursierEscape(s: String): String =
    s.flatMap { ch =>
      if (ch > 128 || " %$&+,:;=?@<>#".indexOf(ch) >= 0) "%" + "%02X".format(ch.toInt) else ch.toString
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

  // Case-SENSITIVE (matching is documented as case-sensitive). Supports `*`, `?`, and `[...]`
  // character classes: enumerations (`[cC]`), ranges (`[a-z]`), and `[!..]`/`[^..]` negation. A
  // malformed glob falls back to a literal match, never throws.
  private def globToRegex(glob: String): java.util.regex.Pattern = {
    val sb = new StringBuilder
    var i = 0
    val n = glob.length
    while (i < n) {
      val c = glob.charAt(i)
      if (c == '*') { sb.append(".*"); i += 1 }
      else if (c == '?') { sb.append('.'); i += 1 }
      else if (c == '[') {
        val j = glob.indexOf(']', i + 1)
        // Treat as a class only with a non-empty body; else a literal `[`.
        if (j <= i + 1) { sb.append("\\["); i += 1 }
        else {
          var body = glob.substring(i + 1, j)
          val neg = body.startsWith("!")
          if (neg) body = body.substring(1)
          // Only literal chars and `-` ranges are meaningful; neutralize regex-class tricks.
          body = body.replace("\\", "\\\\").replace("[", "\\[").replace("&", "\\&")
          sb.append('[').append(if (neg) "^" else "").append(body).append(']')
          i = j + 1
        }
      } else if ("\\.^$|+(){}]".indexOf(c.toInt) >= 0) {
        sb.append('\\').append(c); i += 1
      } else { sb.append(c); i += 1 }
    }
    try java.util.regex.Pattern.compile(sb.toString)
    catch {
      case _: java.util.regex.PatternSyntaxException =>
        java.util.regex.Pattern.compile(java.util.regex.Pattern.quote(glob))
    }
  }

  // ConfigurationReport.configuration is a String on sbt 0.13, a ConfigRef on 1.x: read `.name` reflectively.
  private def confName(cr: ConfigurationReport): String = {
    val c: Any = cr.configuration
    try c.getClass.getMethod("name").invoke(c).toString
    catch { case _: Throwable => c.toString }
  }

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

  private def isTestConf(name: String): Boolean = name.toLowerCase.contains("test")

  // Only feeds the informational `dev` flag, never gates analysis.
  private def isProdConf(name: String): Boolean = {
    val n = name.toLowerCase
    n == "compile" || n == "runtime"
  }

  // ---- misc helpers --------------------------------------------------------

  // sbt loads the `.sbt` files in a project's base directory into that project
  // (Load.configurationSources), so its build.sbt is the project's even when it sets nothing.
  private def baseBuildSbt(base: File, rootCanonPath: java.nio.file.Path): Option[File] =
    Some(new File(base, "build.sbt")).filter(f => f.isFile && f.getCanonicalFile.toPath.startsWith(rootCanonPath))

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

  private def orEmpty(v: String): String = if (v == null) "" else v

  private def moduleKey(m: ModuleID): String = orEmpty(m.organization) + ":" + orEmpty(m.name)

  private def gavKey(m: ModuleID): String = moduleKey(m) + ":" + orEmpty(m.revision)

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

  // Empty `config`: the failure belongs to no configuration.
  private final case class Failure(coord: String, detail: String, config: String, project: String)

  private final case class Unscannable(detail: String, project: String)

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
    // Id of the build project this node is, when it is one.
    var project = ""
    // That project's output sets this dependency brings in.
    val outputSets = mutable.LinkedHashSet.empty[String]
    // External artifact's resolved jar(s); --with-files only.
    val targets = mutable.TreeSet.empty[String]
    // An expected artifact was not fetched; --with-files only.
    var unfetched = false
  }

  // `unfetched`: why the expected artifact could not be fetched.
  private final case class Variant(coord: Coord, file: Option[File], unfetched: Option[String])

  private final class RootTree(
      val projectKey: String,
      val config: String,
      val prod: Boolean,
      // The output set whose runtime or compile classpath this root is, or "".
      val outputSet: String,
      val role: String,
      val nodes: mutable.LinkedHashMap[String, Node]
  )
}
