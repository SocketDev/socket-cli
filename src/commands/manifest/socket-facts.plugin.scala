package socket

import sbt._
import sbt.Keys._

import org.apache.ivy.Ivy
import org.apache.ivy.core.cache.DefaultRepositoryCacheManager
import org.apache.ivy.core.module.descriptor.{ Artifact, ModuleDescriptor }
import org.apache.ivy.core.module.id.ModuleRevisionId
import org.apache.ivy.core.report.ResolveReport
import org.apache.ivy.core.resolve.{ IvyNode, ResolveOptions }

import scala.collection.mutable

/**
 * Socket facts plugin for sbt.
 *
 * Emits a single `.socket.facts.json` at the build root describing the
 * resolved dependency graph of every project in the build, in the canonical
 * SocketFacts schema (mirrors socket-facts.init.gradle on the gradle side):
 *
 *   { "components": SF_Artifact[] }
 *
 * Each Maven component is
 *   { type: 'maven', namespace, name, version?, qualifiers? } &
 *   { id, direct?, dev?, dependencies? }
 *
 * The graph is read from Ivy resolution metadata only: `setDownload(false)`
 * means no artifact jars are fetched, just the POM/ivy.xml needed to compute
 * the transitive closure. Resolution failures are fatal: any unresolved
 * dependency aborts with a non-zero exit rather than being silently dropped
 * (the env is the user's own, set up to resolve their deps).
 *
 * The project's dependency configurations are resolved into one component per
 * module (org:name:version); a module's alternate artifacts (sources/javadoc
 * classifier jars) are the same package, so they collapse into that single
 * component rather than adding duplicates. The Scala compiler/scaladoc
 * toolchain and sbt plugins are skipped by default: they're inherent to the
 * chosen sbt/Scala version (absent from the pom-path manifest too) and
 * dominate resolution cost for little actionable alert signal. Pass
 * `-Dsocket.includeToolchain=true` to resolve them as well, tagged `tooling`
 * so reachability skips them. (Any dependency reached only via a non-classpath
 * config is likewise tagged `tooling`.)
 *
 * Intra-build project dependencies are omitted: sbt's `dependsOn` is a
 * classpath dependency, not an Ivy one, so siblings never appear in a
 * project's resolve, and a sibling referenced as an explicit library
 * dependency is filtered out by coordinate. Each project's own external deps
 * are aggregated, so a subproject's transitives still land in the output via
 * that subproject's own resolve.
 *
 * Delivery: shipped as source and dropped into an isolated `-Dsbt.global.base`
 * plugins dir, so it activates on any project without installation. It is
 * compiled by the sbt meta-build, whose Scala is 2.10 for sbt 0.13 and 2.12
 * for sbt 1.x — so this file must compile on both. Reaching into Ivy (stable
 * across those sbt versions) keeps the code free of the version-specific sbt
 * APIs that would otherwise need reflection.
 */
object SocketFactsPlugin extends AutoPlugin {
  override def trigger = allRequirements

  object autoImport {
    val socketFacts =
      taskKey[Unit]("Emit a Socket facts JSON for the whole build")
  }
  import autoImport._

  // Configurations that put a dependency on the application's own classpath —
  // what reachability analysis consumes. A dependency reached by any of these
  // (or by a test config; see isTestConf) is a real dependency. EVERYTHING
  // else — the Scala compiler/scaladoc toolchain, sbt plugins, and any other
  // non-classpath config — is tagged `tooling`: still emitted (so artifact and
  // vulnerability alerts see every package), but skipped by reachability.
  //
  // The point of `tooling` is operational: reachability needn't, and often
  // can't, resolve internal build tools, and would error trying. Defining
  // tooling as "not a known app classpath" (rather than allowlisting known
  // tool configs) means even an unanticipated build-tool config is skipped
  // rather than blowing up reachability. The cost is that a non-standard
  // classpath config (e.g. sbt's IntegrationTest `it`) is also treated as
  // tooling — acceptable, since it's still emitted for alerts and such deps
  // are reasonable to leave out of production reachability. `scala-library` is
  // on `compile`, so it stays non-tooling.
  private val ClasspathConfs = Set(
    "compile",
    "compile-internal",
    "default",
    "optional",
    "provided",
    "runtime",
    "runtime-internal",
    "test",
    "test-internal"
  )

  // Configs skipped by default. The Scala toolchain (scala-tool/scala-doc-tool)
  // and sbt plugins are inherent to the chosen sbt/Scala version, not the
  // project's declared deps (the pom-path manifest omits them too), and their
  // metadata — chiefly the scaladoc tree — is most of the resolution cost for
  // little actionable alert signal. docs/pom/sources only re-request alternate
  // artifacts of modules already resolved. `-Dsocket.includeToolchain=true`
  // resolves everything instead (kept so the perf impact can be A/B'd).
  private val SkippedConfs =
    Set("docs", "plugin", "pom", "scala-doc-tool", "scala-tool", "sources")

  // Must stay in sync with `DOT_SOCKET_DOT_FACTS_JSON` in src/constants.mts
  // (TS side). Scala can't import the TS constant, so the two strings are
  // intentionally duplicated; change them together.
  private val SocketFactsFilename = ".socket.facts.json"

  override def projectSettings: Seq[Setting[_]] = Seq(
    // Run once for the whole build; the task itself gathers every project via
    // ScopeFilter, so we don't want sbt to also fan it out to aggregates.
    // Note: `in` (not the newer `key / scope` slash syntax) is intentional —
    // slash syntax doesn't exist in sbt 0.13, which we still support. The
    // 1.5+ deprecation warning it triggers is harmless and only surfaces on a
    // cold compile. Same goes for `baseDirectory in ThisBuild` below.
    aggregate in socketFacts := false,
    socketFacts := {
      val log = streams.value.log
      val modules = ivyModule.all(ScopeFilter(inAnyProject)).value
      val buildRoot = (baseDirectory in ThisBuild).value

      // First pass: every project's own coordinate (org:name), so intra-build
      // deps are omitted even when referenced as explicit library deps.
      val projectCoords = mutable.HashSet.empty[String]
      modules.foreach { module =>
        module.withModule(log) { (_, md, _) =>
          val mrid = md.getModuleRevisionId
          projectCoords += mrid.getOrganisation + ":" + mrid.getName
        }
      }

      val nodes = mutable.LinkedHashMap.empty[String, Node]
      val unresolved = mutable.LinkedHashSet.empty[String]

      // Second pass: resolve each project metadata-only and fold its graph in.
      modules.foreach { module =>
        module.withModule(log) { (ivy, md, _) =>
          collectResolved(ivy, md, projectCoords, nodes, unresolved)
        }
      }

      if (unresolved.nonEmpty) {
        log.error("Socket facts: could not resolve these dependencies:")
        unresolved.toList.sorted.foreach(u => log.error("  - " + u))
        sys.error(
          "Socket facts aborted: " + unresolved.size +
            " unresolved dependency(ies). Fix resolution (repositories, " +
            "credentials, offline cache) and retry."
        )
      }

      if (nodes.isEmpty) {
        // println (not log.info) so the line reaches stdout without sbt's
        // `[info]` prefix, matching what the CLI parses for.
        println("[socket-facts] no resolvable dependencies in build, skipping")
      } else {
        val outDir = sys.props.get("socket.outputDirectory") match {
          case Some(d) if d.nonEmpty => new File(d)
          case _ => buildRoot
        }
        outDir.mkdirs()
        val outName = sys.props.get("socket.outputFile") match {
          case Some(f) if f.nonEmpty => f
          case _ => SocketFactsFilename
        }
        val outFile = new File(outDir, outName)
        IO.write(outFile, renderJson(nodes))
        // println (not log.info) so the line reaches stdout without sbt's
        // `[info]` prefix, matching what the CLI parses for.
        println("Socket facts file written to: " + outFile.getAbsolutePath)
      }
    }
  )

  // Resolve one project's module metadata-only and fold its graph into the
  // shared, build-wide node map. Takes the stable Ivy types (not sbt's
  // IvySbt#Module, which moved packages between 0.13 and 1.x).
  private def collectResolved(
      ivy: Ivy,
      md: ModuleDescriptor,
      projectCoords: scala.collection.Set[String],
      nodes: mutable.LinkedHashMap[String, Node],
      unresolved: mutable.LinkedHashSet[String]
  ): Unit = {
    val rootMrid = md.getModuleRevisionId
    // Resolve the project's dependency configs; skip the toolchain/no-op
    // configs (SkippedConfs) by default so we don't pay for the scaladoc tree
    // etc. Custom dependency configs (e.g. IntegrationTest `it`) are still
    // resolved. `-Dsocket.includeToolchain=true` resolves everything.
    val includeToolchain = java.lang.Boolean.parseBoolean(
      sys.props.getOrElse("socket.includeToolchain", "false")
    )
    val allConfs = md.getConfigurationsNames
    val confs =
      if (includeToolchain) allConfs
      else allConfs.filterNot(SkippedConfs.contains)
    if (confs.nonEmpty) {
      // Don't revalidate cached metadata over the network: with release
      // coordinates the cached POM/ivy.xml never changes, so HEAD/GET-ing each
      // cached module per resolve is pure overhead (~30% of warm-cache time).
      // Missing metadata is still fetched (this is not cache-only), so cold
      // caches still work — we just never re-check what we already have.
      ivy.getSettings.getDefaultRepositoryCacheManager match {
        case drcm: DefaultRepositoryCacheManager =>
          drcm.setCheckmodified(false)
          drcm.setUseOrigin(true)
          drcm.setDefaultTTL(Long.MaxValue)
        case _ =>
      }
      val options = new ResolveOptions()
      options.setDownload(false)
      options.setTransitive(true)
      options.setConfs(confs)
      // Skip Ivy's report rendering — it re-walks the graph and we don't use it.
      options.setOutputReport(false)
      val report: ResolveReport = ivy.resolve(md, options)

      report.getUnresolvedDependencies.foreach { node =>
        unresolved += node.getId.toString
      }

      // Pass 1: emit one node per resolved module, and remember which
      // component id each Ivy module maps to (for wiring caller edges).
      val mridToId = mutable.HashMap.empty[String, String]
      val pass1 = report.getDependencies.iterator()
      while (pass1.hasNext) {
        val ivyNode = pass1.next().asInstanceOf[IvyNode]
        if (isEmittable(ivyNode, projectCoords)) {
          val mrid = ivyNode.getResolvedId
          val rootConfs = ivyNode.getRootModuleConfigurations
          // prod = reached by any non-test config. nonTooling = reached by a
          // real app-classpath config (test configs count as classpath too);
          // anything reachable only via non-classpath configs is build tooling.
          val prod = rootConfs.exists(c => !isTestConf(c))
          val nonTooling =
            rootConfs.exists(c => ClasspathConfs.contains(c) || isTestConf(c))
          val coord = coordFor(ivyNode, mrid)
          val node = nodes.getOrElseUpdate(coord.id, new Node(coord))
          if (prod) {
            node.prod = true
          }
          if (nonTooling) {
            node.nonTooling = true
          }
          mridToId(mrid.toString) = coord.id
        }
      }

      // Pass 2: wire caller edges. A caller that is the project root marks the
      // node `direct`; any other caller becomes its parent.
      val pass2 = report.getDependencies.iterator()
      while (pass2.hasNext) {
        val ivyNode = pass2.next().asInstanceOf[IvyNode]
        if (isEmittable(ivyNode, projectCoords)) {
          mridToId.get(ivyNode.getResolvedId.toString).foreach { childId =>
            ivyNode.getAllCallers.foreach { caller =>
              val callerMrid = caller.getModuleRevisionId
              if (callerMrid == rootMrid) {
                nodes(childId).direct = true
              } else {
                mridToId
                  .get(callerMrid.toString)
                  .foreach(parentId => nodes(parentId).children += childId)
              }
            }
          }
        }
      }
    }
  }

  // A configuration whose name mentions "test" (test, test-internal,
  // IntegrationTest, ...) contributes dev dependencies. Name-based, mirroring
  // the gradle script, so it also catches custom test-like configs.
  private def isTestConf(name: String): Boolean =
    name.toLowerCase.contains("test")

  // A dependency node is emittable when it actually resolved to a real module
  // that isn't a project in this build and isn't a conflict loser. Failed or
  // unloaded nodes are skipped here (reading their metadata throws); they're
  // reported separately via the resolve report's unresolved list, which aborts
  // the run.
  private def isEmittable(
      node: IvyNode,
      projectCoords: scala.collection.Set[String]
  ): Boolean = {
    val mrid = node.getResolvedId
    mrid != null &&
    node.getModuleRevision != null &&
    !node.hasProblem &&
    !projectCoords.contains(mrid.getOrganisation + ":" + mrid.getName) &&
    !node.isCompletelyEvicted
  }

  private def coordFor(node: IvyNode, mrid: ModuleRevisionId): Coord =
    Coord(mrid.getOrganisation, mrid.getName, mrid.getRevision, primaryExt(node))

  // The packaging extension of the module's main (classifier-less) artifact.
  // Reading artifact metadata never triggers a download. Defaults to jar,
  // which is correct for the overwhelming majority of Maven dependencies.
  private def primaryExt(node: IvyNode): String = {
    val artifacts = node.getAllArtifacts
    if (artifacts == null) {
      "jar"
    } else {
      artifacts.find(a => classifierOf(a).isEmpty).map(extOf).getOrElse("jar")
    }
  }

  private def extOf(a: Artifact): String = {
    val e = a.getExt
    if (e == null || e.isEmpty) "jar" else e
  }

  private def classifierOf(a: Artifact): String = {
    val extra = a.getExtraAttributes
    val raw =
      if (extra.get("classifier") != null) extra.get("classifier")
      else extra.get("m:classifier")
    if (raw == null) "" else raw.toString
  }

  private def renderJson(nodes: mutable.LinkedHashMap[String, Node]): String = {
    val sorted = nodes.values.toList.sortBy(_.coord.id)
    val sb = new StringBuilder
    sb.append("{\n  \"components\": [\n")
    sorted.zipWithIndex.foreach {
      case (node, idx) =>
        appendComponent(sb, node)
        if (idx < sorted.size - 1) {
          sb.append(",")
        }
        sb.append("\n")
    }
    sb.append("  ]\n}\n")
    sb.toString
  }

  private def appendComponent(sb: StringBuilder, node: Node): Unit = {
    val c = node.coord
    val fields = mutable.ListBuffer.empty[String]
    fields += "\"type\": \"maven\""
    fields += "\"namespace\": " + jsonString(c.org)
    fields += "\"name\": " + jsonString(c.name)
    if (c.version.nonEmpty) {
      fields += "\"version\": " + jsonString(c.version)
    }
    if (c.ext.nonEmpty) {
      fields += "\"qualifiers\": { \"ext\": " + jsonString(c.ext) + " }"
    }
    fields += "\"id\": " + jsonString(c.id)
    if (node.direct) {
      fields += "\"direct\": true"
    }
    if (!node.prod) {
      fields += "\"dev\": true"
    }
    if (!node.nonTooling) {
      fields += "\"tooling\": true"
    }
    if (node.children.nonEmpty) {
      val depLines = node.children.toList.map(d => "        " + jsonString(d))
      fields += "\"dependencies\": [\n" + depLines.mkString(",\n") + "\n      ]"
    }
    sb.append("    {\n      ")
    sb.append(fields.mkString(",\n      "))
    sb.append("\n    }")
  }

  private def jsonString(s: String): String = {
    val sb = new StringBuilder("\"")
    s.foreach {
      case '"' => sb.append("\\\"")
      case '\\' => sb.append("\\\\")
      case '\n' => sb.append("\\n")
      case '\r' => sb.append("\\r")
      case '\t' => sb.append("\\t")
      case ch if ch < 0x20 => sb.append("\\u%04x".format(ch.toInt))
      case ch => sb.append(ch)
    }
    sb.append("\"")
    sb.toString
  }

  // A resolved Maven coordinate.
  private final case class Coord(
      org: String,
      name: String,
      version: String,
      ext: String
  ) {
    val id: String = org + ":" + name + ":" + version
  }

  private final class Node(val coord: Coord) {
    val children = mutable.TreeSet.empty[String]
    var prod = false
    var nonTooling = false
    var direct = false
  }
}
