import { toSessionId, type SessionId } from './utils/ids.js';

export interface Session {
  id: SessionId;
  title: string;
  startedAt: number;
}

export interface SessionSink {
  write(session: Session): void;
}

export class SessionStore {
  private sessions = new Map<SessionId, Session>();

  add(session: Session): void {
    this.sessions.set(session.id, session);
  }

  get(id: SessionId): Session | undefined {
    return this.sessions.get(id);
  }
}

export function createSession(title: string): Session {
  return { id: toSessionId(title), title, startedAt: 0 };
}
