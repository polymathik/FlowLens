// all-relations.ts — exercises all 13 FlowLens relation types

// IMPORT: import relation (file → file)
import { Helper } from './helper';

// Top-level variable for USE relation testing
const config = 'default';

// DECORATE: decorate relation (decorator → class)
function Log(target: any) { return target; }

@Log
class Base {
  // CONTAIN: contain relation (class → field, class → method)
  name: string = '';

  greet(): string {
    return 'hello';
  }
}

// EXTEND: extend relation (Child → Base)
// IMPLEMENT: implement relation (Child → Printable)
interface Printable {
  print(): void;
}

class Child extends Base implements Printable {
  // OVERRIDE: override relation (Child.greet → Base.greet)
  greet(): string {
    return 'hi';
  }

  // PARAMETER: parameter relation (process → Base type annotation, same-file entity)
  process(helper: Base): void {
    // CALL: call relation (process → greet via this.greet())
    this.greet();

    // USE: use relation (reading a top-level variable)
    console.log(config);

    // CREATE: create relation (process → Base via new Base())
    const b = new Base();

    // THROW: throw relation (process → Error) — Error is not a local entity
    // Use a local class so it resolves:
  }

  // RETURN: return relation (getBase → Base type annotation)
  getBase(): Base {
    return new Base();
  }

  print(): void {}
}

// THROW: throw relation needs a local error class
class AppError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

function riskyOperation(): void {
  // THROW: throw relation (riskyOperation → AppError)
  throw new AppError('oops');
}

// MIXIN: mixin relation (Stamped → Timestamped)
function Timestamped<T extends new (...args: any[]) => any>(Base: T) {
  return class extends Base { timestamp = Date.now(); };
}
class Stamped extends Timestamped(Base) {}

export { Base, Child, Stamped };
