package tech.coana.socket;

import org.eclipse.aether.RepositoryEvent;
import org.eclipse.aether.RequestTrace;
import org.eclipse.aether.collection.CollectStepData;
import org.eclipse.aether.graph.Dependency;
import org.eclipse.aether.graph.DependencyNode;

import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * What the repository events of dependency collection reveal beyond its result: the POMs Maven's
 * default {@code ArtifactDescriptorPolicy} tolerated as missing or invalid (the node stays, its
 * dependencies are lost, and no collection error is raised), build-wide, and the graph position of
 * each collect step of the current module.
 */
public final class CollectionObserver {

  // CollectStepData is maven-resolver 1.8.1+ (Maven 3.9+); older resolvers trace no collect step.
  private static final boolean COLLECT_STEPS = classExists("org.eclipse.aether.collection.CollectStepData");

  // The resolver caches a tolerated POM build-wide, so only the first module to reach one sees its
  // event; that module's detail is kept.
  private final Map<String, String> incompleteDescriptors = new LinkedHashMap<>();
  private final Set<String> incompleteInModule = new HashSet<>();
  private final Map<Object, DependencyNode> stepParents = new IdentityHashMap<>();

  public synchronized void onEvent(RepositoryEvent event) {
    if (event.getType() == RepositoryEvent.EventType.ARTIFACT_DESCRIPTOR_MISSING) {
      incomplete(event, "is missing, no dependency information available");
    } else if (event.getType() == RepositoryEvent.EventType.ARTIFACT_DESCRIPTOR_INVALID) {
      incomplete(event, "is invalid, transitive dependencies (if any) will not be available");
    }
    // The depth-first collector hands each step its live node stack, so the parent is only right now.
    if (COLLECT_STEPS) Steps.recordParent(event.getTrace(), stepParents);
  }

  private void incomplete(RepositoryEvent event, String problem) {
    String gav = SocketFactsRecordsEngine.gav(event.getArtifact());
    if (incompleteDescriptors.containsKey(gav) && !incompleteInModule.contains(gav)) return;
    incompleteInModule.add(gav);
    incompleteDescriptors.put(
        gav,
        "The POM for " + event.getArtifact() + " " + problem + ": "
            + SocketFactsRecordsEngine.rootMessage(event.getException()));
  }

  /** Starts the next module's collection. */
  synchronized void reset() {
    incompleteInModule.clear();
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
