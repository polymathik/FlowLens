/** Promisified LevelGraph primitives and minimal typings. */

/* ---------- LevelGraph minimal typings ---------- */

export interface Triple {
  subject: string;
  predicate: string;
  object: string;
  [key: string]: unknown;
}

export interface LevelGraphDB {
  put(triple: Triple | Triple[], cb: (err: Error | null) => void): void;
  get(pattern: Partial<Triple>, cb: (err: Error | null, list: unknown[]) => void): void;
  del(triple: Triple | Triple[], cb: (err: Error | null) => void): void;
  close(cb: (err?: Error | null) => void): void;
}

/* ---------- Promisified helpers ---------- */

export function lgPut(db: LevelGraphDB, triple: Triple | Triple[]): Promise<void> {
  return new Promise((resolve, reject) => {
    db.put(triple, (err) => (err ? reject(err) : resolve()));
  });
}

export function lgGet(db: LevelGraphDB, pattern: Partial<Triple>): Promise<Triple[]> {
  return new Promise((resolve, reject) => {
    db.get(pattern, (err, list) => {
      if (err) return reject(err);
      const triples = (list as unknown[]).map((item) =>
        typeof item === 'string' ? JSON.parse(item) as Triple : item as Triple,
      );
      resolve(triples);
    });
  });
}

export function lgDel(db: LevelGraphDB, triple: Triple | Triple[]): Promise<void> {
  return new Promise((resolve, reject) => {
    db.del(triple, (err) => (err ? reject(err) : resolve()));
  });
}

