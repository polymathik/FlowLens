/**
 * In-process daemon harness: isolated $FLOWLENS_HOME, a started daemon and
 * RemoteGraphStore factories bound to it.
 */
import { join } from 'node:path';
import { DaemonClient } from '../../src/service/client.js';
import { startDaemon, type DaemonHandle, type StartDaemonOptions } from '../../src/service/daemon.js';
import { RemoteGraphStore } from '../../src/service/remote-graph-store.js';
import type { FlowLensConfig } from '../../src/contracts/config.js';
import { removeDir, tempDir } from './service-env.js';

export const TEST_CONFIG: FlowLensConfig = {
  exclude: [],
  languages: { typescript: true, javascript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

export interface Harness {
  home: string;
  daemon: DaemonHandle;
  client(): DaemonClient;
  remote(root: string, label?: string): Promise<RemoteGraphStore>;
  stop(): Promise<void>;
}

export async function startHarness(o: StartDaemonOptions = {}): Promise<Harness> {
  const home = await tempDir('flowlens-home-');
  process.env.FLOWLENS_HOME = home;
  const daemon = await startDaemon({ log: () => {}, ...o });
  const opened: RemoteGraphStore[] = [];
  return {
    home,
    daemon,
    client: () => new DaemonClient(daemon.info),
    async remote(root, label = 'test') {
      const store = new RemoteGraphStore(async () => new DaemonClient(daemon.info), label);
      await store.open(join(root, '.flowlens', 'graph'));
      opened.push(store);
      return store;
    },
    async stop() {
      for (const s of opened) await s.close().catch(() => undefined);
      await daemon.shutdown();
      delete process.env.FLOWLENS_HOME;
      await removeDir(home);
    },
  };
}
