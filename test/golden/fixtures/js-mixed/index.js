import { B } from './lib/b.mjs';
import { createRequire } from 'node:module';

export function start() {
  return new B();
}

export class Widget extends B {}
