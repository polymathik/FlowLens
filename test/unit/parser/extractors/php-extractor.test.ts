import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { phpExtractor } from '../../../../src/parser/extractors/php-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/App.php';

function extractEntities(code: string, filePath = FP): Entity[] {
  return phpExtractor.extractEntities(parse('php', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('php', code).root();
  const entities = phpExtractor.extractEntities(root, filePath);
  const relations = phpExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('PHP extractor — entities', () => {
  it('extracts classes', () => {
    const entities = extractEntities(`<?php
class UserService {}
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('UserService');
    expect(classes[0].visibility).toBe('public');
  });

  it('extracts interfaces', () => {
    const entities = extractEntities(`<?php
interface Greeter {
    public function greet(string $name): string;
}
`);
    const ifaces = findByKind(entities, 'interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('Greeter');
  });

  it('extracts enums and enum cases', () => {
    const entities = extractEntities(`<?php
enum Status {
    case Active;
    case Inactive;
}
`);
    const enums = findByKind(entities, 'enum');
    expect(enums).toHaveLength(1);
    expect(enums[0].name).toBe('Status');

    const members = findByKind(entities, 'enum_member');
    expect(members).toHaveLength(2);
    expect(members.map(m => m.name).sort()).toEqual(['Active', 'Inactive']);
  });

  it('extracts standalone functions', () => {
    const entities = extractEntities(`<?php
function helper(string $x): string {
    return strtoupper($x);
}
`);
    const fns = findByKind(entities, 'function');
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('helper');
    expect(fns[0].kind).toBe('function');
  });

  it('extracts methods with visibility', () => {
    const entities = extractEntities(`<?php
class Foo {
    public function getName(): string { return ""; }
    private function doSecret(): void {}
    protected function doShared(): void {}
}
`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(3);

    expect(findByName(entities, 'getName')!.visibility).toBe('public');
    expect(findByName(entities, 'doSecret')!.visibility).toBe('private');
    expect(findByName(entities, 'doShared')!.visibility).toBe('protected');
  });

  it('extracts properties (fields) with visibility', () => {
    const entities = extractEntities(`<?php
class Foo {
    private string $name;
    protected int $age;
    public bool $active;
}
`);
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(3);
    expect(findByName(entities, 'name')!.visibility).toBe('private');
    expect(findByName(entities, 'age')!.visibility).toBe('protected');
    expect(findByName(entities, 'active')!.visibility).toBe('public');
  });

  it('extracts PHP 8 attributes as decorator entities', () => {
    const entities = extractEntities(`<?php
#[Route('/api')]
class Controller {
    #[HttpGet]
    public function index(): void {}
}
`);
    const decs = findByKind(entities, 'decorator');
    expect(decs.length).toBeGreaterThanOrEqual(2);
    const names = decs.map(d => d.name);
    expect(names).toContain('Route');
    expect(names).toContain('HttpGet');
  });

  it('builds correct qualified names', () => {
    const entities = extractEntities(`<?php
class UserService {
    public function createUser(): void {}
}
`, 'src/UserService.php');
    const method = findByName(entities, 'createUser');
    expect(method!.qualified_name).toBe('src/UserService.php/UserService.createUser');
  });

  it('handles empty input gracefully', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });

  it('handles broken input gracefully', () => {
    const entities = extractEntities('<?php class {');
    expect(Array.isArray(entities)).toBe(true);
  });
});

describe('PHP extractor — relations', () => {
  it('extracts use (import) relations', () => {
    const { relations } = extractRelations(`<?php
use App\\Services\\BaseService;
use App\\Contracts\\UserInterface;

class Foo {}
`);
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(2);
  });

  it('extracts extend relations', () => {
    const { relations } = extractRelations(`<?php
class Animal {}
class Dog extends Animal {}
`);
    const extends_ = relations.filter(r => r.type === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts implement relations', () => {
    const { relations } = extractRelations(`<?php
interface Serializable {}
class Foo implements Serializable {}
`);
    const impls = relations.filter(r => r.type === 'implement');
    expect(impls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for methods', () => {
    const { relations } = extractRelations(`<?php
class Foo {
    public function bar(): void {}
}
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts create relations from new', () => {
    const { relations } = extractRelations(`<?php
class User {}
class Foo {
    public function bar() {
        $u = new User();
    }
}
`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts call relations for function calls', () => {
    const { relations } = extractRelations(`<?php
function helper(): string { return ""; }
class Foo {
    public function bar() {
        helper();
    }
}
`);
    const calls = relations.filter(r => r.type === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts decorate relations from attributes', () => {
    const { relations } = extractRelations(`<?php
#[Route('/api')]
class Controller {}
`);
    const decorates = relations.filter(r => r.type === 'decorate');
    expect(decorates.length).toBeGreaterThanOrEqual(1);
  });
});
