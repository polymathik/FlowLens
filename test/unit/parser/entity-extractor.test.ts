import { describe, it, expect } from 'vitest';
import { parse } from '@ast-grep/napi';
import { extractEntities } from '../../../src/parser/entity-extractor.js';
import type { Entity, EntityKind } from '../../../src/contracts/entities.js';

/** Helper: parse TS code and extract entities */
function extract(code: string, filePath = 'src/test.ts', lang = 'typescript'): Entity[] {
  const sgRoot = parse('TypeScript', code);
  return extractEntities(sgRoot.root(), filePath, lang);
}

/** Helper: find first entity by kind */
function findByKind(entities: Entity[], kind: EntityKind): Entity | undefined {
  return entities.find(e => e.kind === kind);
}

/** Helper: find all entities by kind */
function filterByKind(entities: Entity[], kind: EntityKind): Entity[] {
  return entities.filter(e => e.kind === kind);
}

/** Helper: find entity by name */
function findByName(entities: Entity[], name: string): Entity | undefined {
  return entities.find(e => e.name === name);
}

describe('extractEntities', () => {
  // ─── 1. Class Extraction ───────────────────────────────────────

  describe('class extraction', () => {
    it('extracts an exported class with correct kind and visibility', () => {
      const entities = extract('export class Foo { }');
      const cls = findByKind(entities, 'class');
      expect(cls).toBeDefined();
      expect(cls!.name).toBe('Foo');
      expect(cls!.kind).toBe('class');
      expect(cls!.visibility).toBe('public');
    });

    it('extracts a non-exported class as internal', () => {
      const entities = extract('class Bar { }');
      const cls = findByKind(entities, 'class');
      expect(cls).toBeDefined();
      expect(cls!.visibility).toBe('internal');
    });
  });

  // ─── 2. Interface Extraction ───────────────────────────────────

  describe('interface extraction', () => {
    it('extracts an exported interface', () => {
      const entities = extract('export interface IFoo { name: string; }');
      const iface = findByKind(entities, 'interface');
      expect(iface).toBeDefined();
      expect(iface!.name).toBe('IFoo');
      expect(iface!.kind).toBe('interface');
      expect(iface!.visibility).toBe('public');
    });

    it('extracts a non-exported interface as internal', () => {
      const entities = extract('interface IBar { id: number; }');
      const iface = findByKind(entities, 'interface');
      expect(iface).toBeDefined();
      expect(iface!.visibility).toBe('internal');
    });
  });

  // ─── 3. Function Declaration ───────────────────────────────────

  describe('function declaration', () => {
    it('extracts an exported function declaration', () => {
      const entities = extract(
        'export function greet(name: string): string { return name; }',
      );
      const fn = findByKind(entities, 'function');
      expect(fn).toBeDefined();
      expect(fn!.name).toBe('greet');
      expect(fn!.kind).toBe('function');
      expect(fn!.visibility).toBe('public');
    });

    it('extracts a non-exported function as internal', () => {
      const entities = extract('function helper() {}');
      const fn = findByKind(entities, 'function');
      expect(fn).toBeDefined();
      expect(fn!.visibility).toBe('internal');
    });
  });

  // ─── 4. Arrow Function Assigned to Const ───────────────────────

  describe('arrow function assigned to const', () => {
    it('extracts as function kind with correct name', () => {
      const entities = extract(
        'export const add = (a: number, b: number) => a + b;',
      );
      const fn = findByKind(entities, 'function');
      expect(fn).toBeDefined();
      expect(fn!.name).toBe('add');
      expect(fn!.kind).toBe('function');
      expect(fn!.visibility).toBe('public');
    });

    it('extracts arrow function parameters', () => {
      const entities = extract(
        'export const add = (a: number, b: number) => a + b;',
      );
      const params = filterByKind(entities, 'parameter');
      expect(params).toHaveLength(2);
      const names = params.map(p => p.name).sort();
      expect(names).toEqual(['a', 'b']);
    });
  });

  // ─── 5. Methods Inside Class ───────────────────────────────────

  describe('methods inside class', () => {
    it('extracts multiple methods from a class', () => {
      const entities = extract(`
class Foo {
  bar() {}
  baz() {}
}
`);
      const methods = filterByKind(entities, 'method');
      expect(methods).toHaveLength(2);
      const names = methods.map(m => m.name).sort();
      expect(names).toEqual(['bar', 'baz']);
    });

    it('methods default to public visibility', () => {
      const entities = extract(`
class Foo {
  doStuff() {}
}
`);
      const method = findByKind(entities, 'method');
      expect(method).toBeDefined();
      expect(method!.visibility).toBe('public');
    });
  });

  // ─── 6. Enum and Enum Members ──────────────────────────────────

  describe('enum and enum_member', () => {
    it('extracts enum and its members', () => {
      const entities = extract('export enum Status { Active, Inactive }');
      const enums = filterByKind(entities, 'enum');
      expect(enums).toHaveLength(1);
      expect(enums[0].name).toBe('Status');
      expect(enums[0].visibility).toBe('public');

      const members = filterByKind(entities, 'enum_member');
      expect(members).toHaveLength(2);
      const names = members.map(m => m.name).sort();
      expect(names).toEqual(['Active', 'Inactive']);
    });

    it('extracts enum members with assignments', () => {
      const entities = extract(`
export enum Color {
  Red = 'red',
  Green = 'green',
  Blue = 'blue',
}
`);
      const members = filterByKind(entities, 'enum_member');
      expect(members).toHaveLength(3);
      const names = members.map(m => m.name).sort();
      expect(names).toEqual(['Blue', 'Green', 'Red']);
    });
  });

  // ─── 7. Type Alias ─────────────────────────────────────────────

  describe('type alias', () => {
    it('extracts an exported type alias', () => {
      const entities = extract('export type UserId = string;');
      const t = findByKind(entities, 'type');
      expect(t).toBeDefined();
      expect(t!.name).toBe('UserId');
      expect(t!.kind).toBe('type');
      expect(t!.visibility).toBe('public');
    });
  });

  // ─── 8. Module-Scope Variable ──────────────────────────────────

  describe('module-scope variable', () => {
    it('extracts a const with non-arrow value as variable, not function', () => {
      const entities = extract('export const MAX_RETRIES = 3;');
      const v = findByKind(entities, 'variable');
      expect(v).toBeDefined();
      expect(v!.name).toBe('MAX_RETRIES');
      expect(v!.kind).toBe('variable');
      expect(v!.visibility).toBe('public');

      // Should NOT be extracted as a function
      const fns = filterByKind(entities, 'function');
      expect(fns).toHaveLength(0);
    });

    it('extracts let and var variables', () => {
      const entities = extract(`
let counter = 0;
var legacy = 'old';
`);
      const vars = filterByKind(entities, 'variable');
      expect(vars).toHaveLength(2);
      const names = vars.map(v => v.name).sort();
      expect(names).toEqual(['counter', 'legacy']);
    });

    it('non-exported variables have internal visibility', () => {
      const entities = extract('const secret = 42;');
      const v = findByKind(entities, 'variable');
      expect(v).toBeDefined();
      expect(v!.visibility).toBe('internal');
    });
  });

  // ─── 9. Visibility Inference ───────────────────────────────────

  describe('visibility inference', () => {
    it('detects private, protected, and public fields', () => {
      const entities = extract(`
class Service {
  private secret: string;
  protected shared: number;
  public visible: boolean;
  implicit: string;
}
`);
      const fields = filterByKind(entities, 'field');
      expect(fields).toHaveLength(4);

      const secret = findByName(entities, 'secret');
      expect(secret!.visibility).toBe('private');

      const shared = findByName(entities, 'shared');
      expect(shared!.visibility).toBe('protected');

      const visible = findByName(entities, 'visible');
      expect(visible!.visibility).toBe('public');

      const implicit = findByName(entities, 'implicit');
      expect(implicit!.visibility).toBe('public');
    });

    it('detects private method visibility', () => {
      const entities = extract(`
class Service {
  private doSecret() {}
}
`);
      const method = findByKind(entities, 'method');
      expect(method).toBeDefined();
      expect(method!.visibility).toBe('private');
    });
  });

  // ─── 10. Qualified Name ────────────────────────────────────────

  describe('qualified name construction', () => {
    it('builds correct qualified name for top-level entity', () => {
      const entities = extract(
        'export function helper() {}',
        'src/utils.ts',
      );
      const fn = findByKind(entities, 'function');
      expect(fn!.qualified_name).toBe('src/utils.ts/helper');
    });

    it('builds correct qualified name for method inside class', () => {
      const entities = extract(
        `export class UserService {
  createUser() {}
}`,
        'src/user-service.ts',
      );
      const method = findByKind(entities, 'method');
      expect(method!.qualified_name).toBe(
        'src/user-service.ts/UserService.createUser',
      );
    });

    it('builds correct qualified name for field inside class', () => {
      const entities = extract(
        `class Config {
  port: number;
}`,
        'src/config.ts',
      );
      const field = findByKind(entities, 'field');
      expect(field!.qualified_name).toBe('src/config.ts/Config.port');
    });

    it('builds correct qualified name for nested namespace entity', () => {
      const entities = extract(
        `export namespace Outer {
  export function inner() {}
}`,
        'src/utils.ts',
      );
      const fn = findByKind(entities, 'function');
      expect(fn!.qualified_name).toBe('src/utils.ts/Outer.inner');
    });
  });

  // ─── 11. Location (1-based) ────────────────────────────────────

  describe('location (1-based line numbers)', () => {
    it('returns 1-based line numbers from 0-based ast-grep range', () => {
      const code = `export class Foo {
  bar() {}
}`;
      const entities = extract(code);
      const cls = findByKind(entities, 'class');
      expect(cls).toBeDefined();
      // The class_declaration starts on line 1 (0-based line 0)
      expect(cls!.location.line_start).toBe(1);
      // Ends on line 3 (0-based line 2)
      expect(cls!.location.line_end).toBe(3);
    });

    it('has positive column values', () => {
      const entities = extract('export class Foo {}');
      const cls = findByKind(entities, 'class');
      expect(cls!.location.column_start).toBeGreaterThan(0);
    });
  });

  // ─── 12. Namespace ─────────────────────────────────────────────

  describe('namespace', () => {
    it('extracts an exported namespace', () => {
      const entities = extract(`
export namespace Utils {
  export function helper() {}
}
`);
      const ns = findByKind(entities, 'namespace');
      expect(ns).toBeDefined();
      expect(ns!.name).toBe('Utils');
      expect(ns!.kind).toBe('namespace');
      expect(ns!.visibility).toBe('public');
    });

    it('extracts entities nested inside a namespace', () => {
      const entities = extract(`
export namespace Utils {
  export function helper() {}
  export class Service {}
}
`);
      const fn = findByKind(entities, 'function');
      expect(fn).toBeDefined();
      expect(fn!.name).toBe('helper');

      const cls = findByKind(entities, 'class');
      expect(cls).toBeDefined();
      expect(cls!.name).toBe('Service');
    });
  });

  // ─── 13. Decorator ─────────────────────────────────────────────

  describe('decorator', () => {
    it('extracts decorator on a class', () => {
      const entities = extract(`
@Controller('/api')
class ApiController {}
`);
      const dec = findByKind(entities, 'decorator');
      expect(dec).toBeDefined();
      expect(dec!.name).toBe('Controller');
      expect(dec!.kind).toBe('decorator');
    });

    it('extracts multiple decorators', () => {
      const entities = extract(`
@Controller('/api')
@Injectable()
class ApiController {}
`);
      const decorators = filterByKind(entities, 'decorator');
      expect(decorators).toHaveLength(2);
      const names = decorators.map(d => d.name).sort();
      expect(names).toEqual(['Controller', 'Injectable']);
    });

    it('extracts decorator inside class body on method', () => {
      const entities = extract(`
class ApiController {
  @Get('/')
  getIndex() {}
}
`);
      const dec = findByKind(entities, 'decorator');
      expect(dec).toBeDefined();
      expect(dec!.name).toBe('Get');
    });
  });

  // ─── 14. Parameters ────────────────────────────────────────────

  describe('parameters', () => {
    it('extracts function parameters', () => {
      const entities = extract(
        'function greet(name: string, age: number) {}',
      );
      const params = filterByKind(entities, 'parameter');
      expect(params).toHaveLength(2);
      const names = params.map(p => p.name).sort();
      expect(names).toEqual(['age', 'name']);
    });

    it('extracts optional parameters', () => {
      const entities = extract(
        'function foo(required: string, optional?: number) {}',
      );
      const params = filterByKind(entities, 'parameter');
      expect(params).toHaveLength(2);
      expect(findByName(entities, 'optional')).toBeDefined();
    });

    it('extracts rest parameters', () => {
      const entities = extract(
        'function foo(...items: string[]) {}',
      );
      const params = filterByKind(entities, 'parameter');
      expect(params).toHaveLength(1);
      expect(params[0].name).toBe('items');
    });

    it('extracts method parameters', () => {
      const entities = extract(`
class Foo {
  bar(x: number, y: string) {}
}
`);
      const params = filterByKind(entities, 'parameter');
      expect(params).toHaveLength(2);
      const names = params.map(p => p.name).sort();
      expect(names).toEqual(['x', 'y']);
    });
  });

  // ─── Entity Metadata ──────────────────────────────────────────

  describe('entity metadata', () => {
    it('sets file path correctly', () => {
      const entities = extract('export class Foo {}', 'src/foo.ts');
      const cls = findByKind(entities, 'class');
      expect(cls!.file).toBe('src/foo.ts');
    });

    it('sets language correctly', () => {
      const entities = extract('export class Foo {}', 'src/foo.ts', 'typescript');
      const cls = findByKind(entities, 'class');
      expect(cls!.language).toBe('typescript');
    });

    it('generates a deterministic id', () => {
      const e1 = extract('export class Foo {}', 'src/foo.ts');
      const e2 = extract('export class Foo {}', 'src/foo.ts');
      const cls1 = findByKind(e1, 'class')!;
      const cls2 = findByKind(e2, 'class')!;
      expect(cls1.id).toBe(cls2.id);
      expect(cls1.id).toHaveLength(16); // sha256 truncated to 16 hex chars
    });

    it('includes line_count in metrics', () => {
      const entities = extract(`export class Foo {
  bar() {
    return 1;
  }
}`);
      const cls = findByKind(entities, 'class');
      expect(cls!.metrics).toBeDefined();
      expect(cls!.metrics!.line_count).toBeGreaterThan(0);
    });
  });

  // ─── Comprehensive Scenario ────────────────────────────────────

  describe('comprehensive scenario', () => {
    it('extracts all entity kinds from a complex file', () => {
      const code = `
export namespace Utils {
  export function helper() {}
}

@Controller('/api')
export class UserService {
  private name: string;
  public age: number;

  constructor(name: string) {
    this.name = name;
  }

  createUser(data: string) {}
  protected deleteUser() {}
}

export interface IUser {
  id: string;
}

export function greet(name: string): string {
  return name;
}

export const add = (a: number, b: number) => a + b;
export const MAX_RETRIES = 3;
export type UserId = string;

export enum Status {
  Active,
  Inactive,
}
`;
      const entities = extract(code, 'src/complex.ts');

      // namespace
      expect(filterByKind(entities, 'namespace')).toHaveLength(1);
      // classes
      expect(filterByKind(entities, 'class')).toHaveLength(1);
      // interfaces
      expect(filterByKind(entities, 'interface')).toHaveLength(1);
      // functions: greet + add + helper = 3
      expect(filterByKind(entities, 'function')).toHaveLength(3);
      // methods: constructor + createUser + deleteUser = 3
      expect(filterByKind(entities, 'method')).toHaveLength(3);
      // variables: MAX_RETRIES = 1
      expect(filterByKind(entities, 'variable')).toHaveLength(1);
      // fields: name + age = 2
      expect(filterByKind(entities, 'field')).toHaveLength(2);
      // type: UserId = 1
      expect(filterByKind(entities, 'type')).toHaveLength(1);
      // enum: Status = 1
      expect(filterByKind(entities, 'enum')).toHaveLength(1);
      // enum_member: Active + Inactive = 2
      expect(filterByKind(entities, 'enum_member')).toHaveLength(2);
      // decorator: @Controller = 1
      expect(filterByKind(entities, 'decorator')).toHaveLength(1);
      // parameters: helper() has 0, constructor(name) has 1,
      // createUser(data) has 1, deleteUser() has 0,
      // greet(name) has 1, add(a, b) has 2 = 5
      expect(filterByKind(entities, 'parameter')).toHaveLength(5);
    });
  });
});
