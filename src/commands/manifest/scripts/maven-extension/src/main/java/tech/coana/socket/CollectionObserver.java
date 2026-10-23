package tech.coana.socket;

import org.eclipse.aether.RepositoryEvent;
import org.eclipse.aether.RequestTrace;
import org.eclipse.aether.collection.CollectStepData;
import org.eclipse.aether.graph.Dependency;
import org.eclipse.aether.graph.DependencyNode;

import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What the repository events of one module's dependency collection reveal beyond its result: the
 * POMs Maven's default {@code ArtifactDescriptorPolicy} tolerated as missing or invalid (the node
 * stays, its dependencies are lost, and no collection error is raised), and the graph position of
 * each collect step.
 */
public final class CollectionObserver {

  // CollectStepData is maven-resolver 1.8.1+ (Maven 3.9+); older resolvers trace no collect step.
  private static final boolean COLLECT_STEPS = classExists("org.eclipse.aether.collection.CollectStepData");

  private final Map<String, String> incompleteDescriptors = new LinkedHashMap<>();
  private final Map<Object, DependencyNode> stepParents = new IdentityHashMap<>();

  public synchronized void onEvent(RepositoryEvent event) {
    if (event.getType() == RepositoryEvent.EventType.ARTIFACT_DESCRIPTOR_MISSING) {
      incompleteDescriptors.put(
          gav(event.getArtifact()),
          "The POM for " + event.getArtifact() + " is missing, no dependency information available: "
              + SocketFactsRecordsEngine.rootMessage(event.getException()));
    } else if (event.getType() == RepositoryEvent.EventType.ARTIFACT_DESCRIPTOR_INVALID) {
      incompleteDescriptors.put(
          gav(event.getArtifact()),
          "The POM for " + event.getArtifact() + " is invalid, transitive dependencies (if any) will not be available: "
              + SocketFactsRecordsEngine.rootMessage(event.getException()));
    }
    // The depth-first collector hands each step its live node stack, so the parent is only right now.
    if (COLLECT_STEPS) Steps.recordParent(event.getTrace(), stepParents);
  }

  synchronized void reset() {
    incompleteDescriptors.clear();
    stepParents.clear();
  }

  /** GAV to failure detail of each POM the collection tolerated as missing or invalid. */
  synchronized Map<String, String> incompleteDescriptors() {
    return new LinkedHashMap<>(incompleteDescriptors);
  }

  /** The node whose children the collect step behind {@code trace} was adding, if it was observed. */
  synchronized DependencyNode parentOf(RequestTrace trace) {
    return COLLECT_STEPS ? Steps.parentOf(trace, stepParents) : null;
  }

  /** The dependency, before management, that the collect step behind {@code trace} was adding. */
  synchronized Dependency dependencyOf(RequestTrace trace) {
    return COLLECT_STEPS ? Steps.dependencyOf(trace) : null;
  }

  private static String gav(org.eclipse.aether.artifact.Artifact a) {
    return a.getGroupId() + ":" + a.getArtifactId() + ":" + a.getBaseVersion();
  }

  private static boolean classExists(String name) {
    try {
      Class.forName(name, false, RequestTrace.class.getClassLoader());
      return true;
    } catch (ClassNotFoundException | LinkageError e) {
      return false;
    }
  }

  // Only loaded when CollectStepData exists.
  private static final class Steps {
    static void recordParent(RequestTrace trace, Map<Object, DependencyNode> parents) {
      RequestTrace at = stepTrace(trace);
      if (at == null || parents.containsKey(at.getData())) return;
      List<DependencyNode> path = ((CollectStepData) at.getData()).getPath();
      if (!path.isEmpty()) parents.put(at.getData(), path.get(path.size() - 1));
    }

    static DependencyNode parentOf(RequestTrace trace, Map<Object, DependencyNode> parents) {
      RequestTrace at = stepTrace(trace);
      if (at == null) return null;
      DependencyNode observed = parents.get(at.getData());
      if (observed != null) return observed;
      // The depth-first collector hands every step its one live node stack, so an unobserved step's path
      // is only trusted when it is checkably its own: the breadth-first collector nests each step's
      // trace in its parent's step, whose dependency is then the path's last node.
      RequestTrace enclosing = stepTrace(at.getParent());
      List<DependencyNode> path = ((CollectStepData) at.getData()).getPath();
      if (enclosing == null || path.isEmpty()) return null;
      DependencyNode last = path.get(path.size() - 1);
      Dependency parent = ((CollectStepData) enclosing.getData()).getNode();
      if (last.getDependency() == null
          || !last.getDependency().getArtifact().getGroupId().equals(parent.getArtifact().getGroupId())
          || !last.getDependency().getArtifact().getArtifactId().equals(parent.getArtifact().getArtifactId())) {
        return null;
      }
      return last;
    }

    static Dependency dependencyOf(RequestTrace trace) {
      RequestTrace at = stepTrace(trace);
      return at == null ? null : ((CollectStepData) at.getData()).getNode();
    }

    private static RequestTrace stepTrace(RequestTrace trace) {
      for (RequestTrace t = trace; t != null; t = t.getParent()) {
        if (t.getData() instanceof CollectStepData) return t;
      }
      return null;
    }
  }
}
