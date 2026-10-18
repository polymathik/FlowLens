import { A } from './a.js';

export class B extends A {
  greet() {
    return 'b' + super.greet();
  }
}
