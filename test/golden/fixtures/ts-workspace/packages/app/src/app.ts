import { Engine } from '@acme/core';
import { slug } from '@acme/utils';
import { readFileSync } from 'node:fs';
import lodash from 'lodash';

export class App extends Engine {
  boot(): string {
    this.start();
    readFileSync('x');
    lodash.noop();
    return slug('App');
  }
}
