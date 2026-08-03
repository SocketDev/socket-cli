package tech.coana.ext;

import org.apache.maven.AbstractMavenLifecycleParticipant;
import org.apache.maven.MavenExecutionException;
import org.apache.maven.execution.MavenSession;
import org.apache.maven.rtinfo.RuntimeInformation;
import tech.coana.socket.SocketWorkspacesRecordsEngine;

import javax.inject.Inject;
import javax.inject.Named;
import javax.inject.Singleton;
import java.io.File;
import java.io.IOException;
import java.util.Properties;

/**
 * Sibling of {@link CoanaFactsLifecycleParticipant}, gated by {@code -Dcoana.task=socket-workspaces}.
 * Hooks {@code afterProjectsRead} (fires once the reactor project list is known, before any
 * lifecycle phase runs) since it only needs that list, never a dependency graph.
 */
@Named("coana-workspaces")
@Singleton
public class CoanaWorkspacesLifecycleParticipant extends AbstractMavenLifecycleParticipant {

  private final RuntimeInformation runtimeInformation;

  @Inject
  public CoanaWorkspacesLifecycleParticipant(RuntimeInformation runtimeInformation) {
    this.runtimeInformation = runtimeInformation;
  }

  @Override
  public void afterProjectsRead(MavenSession session) throws MavenExecutionException {
    if (!"socket-workspaces".equals(opt(session, "coana.task"))) {
      return;
    }
    String recordsFile = opt(session, "socket.recordsFile");
    if (recordsFile == null || recordsFile.isEmpty()) {
      throw new MavenExecutionException("socket-workspaces requires -Dsocket.recordsFile", new IllegalStateException());
    }
    SocketWorkspacesRecordsEngine.Options opts = new SocketWorkspacesRecordsEngine.Options();
    opts.recordsFile = recordsFile;
    opts.excludePaths = opt(session, "socket.excludePaths");
    File rootDir = new File(session.getExecutionRootDirectory());
    try {
      SocketWorkspacesRecordsEngine.run(session.getProjects(), rootDir, opts, runtimeInformation.getMavenVersion());
    } catch (IOException exception) {
      throw new MavenExecutionException("Cannot write socket workspace records", exception);
    }
  }

  // -D values arrive as both session user-properties and JVM system properties; prefer the former.
  private static String opt(MavenSession session, String key) {
    Properties user = session.getUserProperties();
    if (user != null && user.getProperty(key) != null) return user.getProperty(key);
    return System.getProperty(key);
  }
}
