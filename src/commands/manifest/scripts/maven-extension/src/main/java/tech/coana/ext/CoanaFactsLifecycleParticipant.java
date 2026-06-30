package tech.coana.ext;

import org.apache.maven.AbstractMavenLifecycleParticipant;
import org.apache.maven.MavenExecutionException;
import org.apache.maven.execution.MavenSession;
import org.apache.maven.rtinfo.RuntimeInformation;
import org.apache.maven.shared.dependency.graph.DependencyGraphBuilder;
import org.eclipse.aether.RepositorySystem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tech.coana.socket.SocketFactsRecordsEngine;

import javax.inject.Inject;
import javax.inject.Named;
import javax.inject.Singleton;
import java.io.File;
import java.io.IOException;
import java.util.Properties;

/**
 * Core extension loaded via {@code -Dmaven.ext.class.path}, gated by {@code -Dcoana.task=socket-facts}
 * (inert otherwise; no local-repo install, pom untouched). Runs at {@code afterSessionEnd} so
 * {@code -Dsocket.withFiles} sees compiled classes / generated sources.
 */
@Named("coana-facts")
@Singleton
public class CoanaFactsLifecycleParticipant extends AbstractMavenLifecycleParticipant {

  private static final Logger LOG = LoggerFactory.getLogger("coana");

  private final RepositorySystem repoSystem;
  private final DependencyGraphBuilder dependencyGraphBuilder;
  private final RuntimeInformation runtimeInformation;

  @Inject
  public CoanaFactsLifecycleParticipant(
      RepositorySystem repoSystem,
      DependencyGraphBuilder dependencyGraphBuilder,
      RuntimeInformation runtimeInformation) {
    this.repoSystem = repoSystem;
    this.dependencyGraphBuilder = dependencyGraphBuilder;
    this.runtimeInformation = runtimeInformation;
  }

  @Override
  public void afterSessionEnd(MavenSession session) throws MavenExecutionException {
    if (!"socket-facts".equals(normalize(opt(session, "coana.task")))) {
      return;
    }
    String recordsFile = opt(session, "socket.recordsFile");
    if (recordsFile == null || recordsFile.isEmpty()) {
      throw new MavenExecutionException("socket-facts requires -Dsocket.recordsFile", new IllegalStateException());
    }
    SocketFactsRecordsEngine.Options opts = new SocketFactsRecordsEngine.Options();
    opts.recordsFile = recordsFile;
    opts.withFiles = optBoolean(session, "socket.withFiles");
    opts.populateFilesFor = opt(session, "socket.populateFilesFor");
    opts.includeConfigs = opt(session, "socket.includeConfigs");
    opts.excludeConfigs = opt(session, "socket.excludeConfigs");
    File rootDir = new File(session.getExecutionRootDirectory());
    try {
      new SocketFactsRecordsEngine(repoSystem, dependencyGraphBuilder, runtimeInformation.getMavenVersion(), LOG)
          .run(session, session.getProjects(), rootDir, opts);
    } catch (IOException exception) {
      throw new MavenExecutionException("Cannot write socket facts records", exception);
    }
  }

  // Accept the cross-tool camelCase alias used by the CLI / Gradle / SBT scripts.
  private static String normalize(String task) {
    return "socketFacts".equals(task) ? "socket-facts" : task;
  }

  // -D values arrive as both session user-properties and JVM system properties; prefer the former.
  private static String opt(MavenSession session, String key) {
    Properties user = session.getUserProperties();
    if (user != null && user.getProperty(key) != null) return user.getProperty(key);
    return System.getProperty(key);
  }

  private static boolean optBoolean(MavenSession session, String key) {
    return Boolean.parseBoolean(opt(session, key));
  }
}
