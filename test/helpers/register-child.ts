/** Child process for registry concurrency tests: registers each argv root. */
import { FileProjectRegistry } from '../../src/projects/registry.js';

const reg = new FileProjectRegistry();
for (const root of process.argv.slice(2)) await reg.register(root);
