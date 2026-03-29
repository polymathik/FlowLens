import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { csharpExtractor } from '../../../../src/parser/extractors/csharp-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/App.cs';

function extractEntities(code: string, filePath = FP): Entity[] {
  return csharpExtractor.extractEntities(parse('csharp', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('csharp', code).root();
  const entities = csharpExtractor.extractEntities(root, filePath);
  const relations = csharpExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('C# extractor — entities', () => {
  it('extracts classes with correct visibility', () => {
    const entities = extractEntities(`
public class UserService {}
class InternalService {}
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(2);
    expect(classes[0].name).toBe('UserService');
    expect(classes[0].visibility).toBe('public');
    expect(classes[1].name).toBe('InternalService');
    expect(classes[1].visibility).toBe('internal');
  });

  it('extracts interfaces', () => {
    const entities = extractEntities(`
public interface IUserService {
    string GetName();
}
`);
    const ifaces = findByKind(entities, 'interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('IUserService');
    expect(ifaces[0].visibility).toBe('public');
  });

  it('extracts enums and enum members', () => {
    const entities = extractEntities(`
public enum Status {
    Active,
    Inactive
}
`);
    const enums = findByKind(entities, 'enum');
    expect(enums).toHaveLength(1);
    expect(enums[0].name).toBe('Status');

    const members = findByKind(entities, 'enum_member');
    expect(members).toHaveLength(2);
    expect(members.map(m => m.name).sort()).toEqual(['Active', 'Inactive']);
  });

  it('extracts namespaces', () => {
    const entities = extractEntities(`
namespace MyApp {
    class Foo {}
}
`);
    const ns = findByKind(entities, 'namespace');
    expect(ns).toHaveLength(1);
    expect(ns[0].name).toBe('MyApp');
  });

  it('extracts methods with visibility', () => {
    const entities = extractEntities(`
class Foo {
    public string GetName() { return ""; }
    private void DoSecret() {}
    protected void DoShared() {}
}
`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(3);

    expect(findByName(entities, 'GetName')!.visibility).toBe('public');
    expect(findByName(entities, 'DoSecret')!.visibility).toBe('private');
    expect(findByName(entities, 'DoShared')!.visibility).toBe('protected');
  });

  it('extracts constructors as methods', () => {
    const entities = extractEntities(`
class Foo {
    public Foo(string name) {}
}
`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('Foo');
  });

  it('extracts fields with visibility', () => {
    const entities = extractEntities(`
class Foo {
    private string _name;
    protected int _age;
}
`);
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
    expect(findByName(entities, '_name')!.visibility).toBe('private');
    expect(findByName(entities, '_age')!.visibility).toBe('protected');
  });

  it('extracts properties as fields', () => {
    const entities = extractEntities(`
class Foo {
    public int Age { get; set; }
}
`);
    const fields = findByKind(entities, 'field');
    expect(fields.length).toBeGreaterThanOrEqual(1);
    expect(findByName(entities, 'Age')).toBeDefined();
  });

  it('extracts attributes as decorator entities', () => {
    const entities = extractEntities(`
[Serializable]
public class Foo {
    [HttpGet("/api")]
    public void Bar() {}
}
`);
    const decs = findByKind(entities, 'decorator');
    expect(decs.length).toBeGreaterThanOrEqual(2);
    const names = decs.map(d => d.name);
    expect(names).toContain('Serializable');
    expect(names).toContain('HttpGet');
  });

  it('builds correct qualified names', () => {
    const entities = extractEntities(`
namespace MyApp {
    class UserService {
        void Create() {}
    }
}
`, 'src/UserService.cs');
    const method = findByName(entities, 'Create');
    expect(method!.qualified_name).toBe('src/UserService.cs/MyApp.UserService.Create');
  });

  it('handles empty input gracefully', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });

  it('handles broken input gracefully', () => {
    const entities = extractEntities('class {');
    expect(Array.isArray(entities)).toBe(true);
  });
});

describe('C# extractor — relations', () => {
  it('extracts using (import) relations', () => {
    const { relations } = extractRelations(`
using System;
using System.Collections.Generic;

class Foo {}
`);
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(2);
  });

  it('extracts extend relations from base class', () => {
    const { relations } = extractRelations(`
class Animal {}
class Dog : Animal {}
`);
    const extends_ = relations.filter(r => r.type === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts implement relations from interface', () => {
    const { relations } = extractRelations(`
interface IGreeter {}
class Foo : IGreeter {}
`);
    const impls = relations.filter(r => r.type === 'implement');
    expect(impls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations', () => {
    const { relations } = extractRelations(`
class Foo {
    void Bar() {}
}
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts create relations from new', () => {
    const { relations } = extractRelations(`
class User {}
class Foo {
    void Bar() {
        var u = new User();
    }
}
`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts throw relations', () => {
    const { relations } = extractRelations(`
class Foo {
    void Bar() {
        throw new Exception("oops");
    }
}
`);
    const throws = relations.filter(r => r.type === 'throw');
    expect(throws.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts decorate relations from attributes', () => {
    const { relations } = extractRelations(`
[Serializable]
class Foo {}
`);
    const decorates = relations.filter(r => r.type === 'decorate');
    expect(decorates.length).toBeGreaterThanOrEqual(1);
  });
});
