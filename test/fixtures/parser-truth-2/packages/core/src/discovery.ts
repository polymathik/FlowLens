export interface Session {
  id: string;
}

export class Discovery {
  session(id: string): Session | null {
    return id ? { id } : null;
  }

  list(): Session[] {
    return [];
  }
}
