/**
 * Parse worker thread entry — receives a `ParseChunkInput` as `workerData`,
 * runs `parseChunk`, posts the result back to the parent. Errors fall
 * through to the worker's 'error' event handler on the parent side.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { parseChunk, type ParseChunkInput } from './parallel-parser.js';

if (!parentPort) {
  throw new Error('parse-worker must be spawned as a worker thread');
}

const input = workerData as ParseChunkInput;
parseChunk(input).then(
  (result) => parentPort!.postMessage(result),
  (err) => {
    // Forward the message; parent's 'error' listener will pick it up.
    throw err instanceof Error ? err : new Error(String(err));
  },
);
