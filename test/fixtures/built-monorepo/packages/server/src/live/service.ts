import { createSession, SessionStore, type Session, type SessionSink } from '@scope/core';
import { formatDuration } from '@scope/core/utils/format';
import { clamp } from '@scope/shared';

export class LiveService implements SessionSink {
  private store = new SessionStore();

  write(session: Session): void {
    this.store.add(session);
  }

  start(title: string): Session {
    const session = createSession(title);
    this.write(session);
    return session;
  }

  describe(session: Session): string {
    return `${session.title} ${formatDuration(clamp(session.startedAt, 0, 1000))}`;
  }
}
