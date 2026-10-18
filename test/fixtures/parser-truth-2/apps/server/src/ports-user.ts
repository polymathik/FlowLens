import { Worker, type Channel, type Database, type Registry } from '@pt/core';

class Mailer extends Worker {
  run(job: string): void {
    void job;
  }
}

export function lookup(reg: Registry, id: string): string | number {
  reg.save(id, 'x');
  reg.vanish();
  const known = reg.get(id);
  return known ?? reg.now() + reg.size;
}

export function wire(channel: Channel, db: Database, mailer: Mailer): void {
  channel.open();
  channel.listenerCount('x');
  db.prepare('select 1');
  mailer.start();
  mailer.run('now');
}
