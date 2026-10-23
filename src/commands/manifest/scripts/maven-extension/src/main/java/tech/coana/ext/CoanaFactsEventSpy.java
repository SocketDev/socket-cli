package tech.coana.ext;

import org.apache.maven.eventspy.AbstractEventSpy;
import org.eclipse.aether.RepositoryEvent;
import tech.coana.socket.CollectionObserver;

import javax.inject.Named;
import javax.inject.Singleton;

/**
 * Relays repository events to the facts engine while it collects. Every Maven chains its event
 * spies into the session's repository listener, which an extension cannot replace: the session is
 * read-only from Maven 3.2 on and immutable in Maven 4.
 */
@Named("coana-facts-events")
@Singleton
public class CoanaFactsEventSpy extends AbstractEventSpy {

  // Static: the container may hand the dispatcher and the participant different instances.
  private static volatile CollectionObserver observer;

  static void observe(CollectionObserver o) {
    observer = o;
  }

  @Override
  public void onEvent(Object event) {
    CollectionObserver o = observer;
    if (o != null && event instanceof RepositoryEvent) o.onEvent((RepositoryEvent) event);
  }
}
