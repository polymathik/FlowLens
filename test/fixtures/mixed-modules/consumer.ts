import { esmHelper } from './esm-module.mjs';
const { cjsHelper } = require('./cjs-module.cjs');

export function run() {
  return esmHelper() + cjsHelper();
}
