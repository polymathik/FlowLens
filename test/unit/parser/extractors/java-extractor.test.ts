import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { javaExtractor } from '../../../../src/parser/extractors/java-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/App.java';

function extractEntities(code: string, filePath = FP): Entity[] {
  return javaExtractor.extractEntities(parse('java', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('java', code).root();
  const entities = javaExtractor.extractEntities(root, filePath);
  const relations = javaExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('Java extractor — entities', () => {
  it('extracts public class', () => {
    const entities = extractEntities(`
public class UserService {
}
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('UserService');
    expect(classes[0].visibility).toBe('public');
  });

  it('extracts package-private class as internal', () => {
    const entities = extractEntities('class Internal {}');
    const cls = findByName(entities, 'Internal');
    expect(cls!.visibility).toBe('internal');
  });

  it('extracts interfaces', () => {
    const entities = extractEntities(`
interface Greeter {
    String greet(String name);
}
`);
    const ifaces = findByKind(entities, 'interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('Greeter');
  });

  it('extracts enums and enum members', () => {
    const entities = extractEntities(`
enum Status {
    ACTIVE,
    INACTIVE
}
`);
    const enums = findByKind(entities, 'enum');
    expect(enums).toHaveLength(1);
    expect(enums[0].name).toBe('Status');

    const members = findByKind(entities, 'enum_member');
    expect(members).toHaveLength(2);
    expect(members.map(m => m.name).sort()).toEqual(['ACTIVE', 'INACTIVE']);
  });

  it('extracts methods with visibility', () => {
    const entities = extractEntities(`
class Foo {
    public String getName() { return ""; }
    private void doSecret() {}
    protected void doShared() {}
}
`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(3);

    const getName = findByName(entities, 'getName');
    expect(getName!.visibility).toBe('public');

    const doSecret = findByName(entities, 'doSecret');
    expect(doSecret!.visibility).toBe('private');
  });

  it('extracts constructors as methods', () => {
    const entities = extractEntities(`
class Foo {
    public Foo(String name) {}
}
`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('Foo');
  });

  it('extracts fields with visibility', () => {
    const entities = extractEntities(`
class Foo {
    private String name;
    protected int age;
    public boolean active;
}
`);
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(3);
    expect(findByName(entities, 'name')!.visibility).toBe('private');
    expect(findByName(entities, 'age')!.visibility).toBe('protected');
    expect(findByName(entities, 'active')!.visibility).toBe('public');
  });

  it('extracts annotations as decorator entities', () => {
    const entities = extractEntities(`
@Service
public class UserService {
    @Override
    public String toString() { return ""; }
}
`);
    const decs = findByKind(entities, 'decorator');
    expect(decs.length).toBeGreaterThanOrEqual(2);
    const names = decs.map(d => d.name);
    expect(names).toContain('Service');
    expect(names).toContain('Override');
  });

  it('builds correct qualified names', () => {
    const entities = extractEntities(`
class UserService {
    void createUser() {}
}
`, 'src/UserService.java');
    const method = findByName(entities, 'createUser');
    expect(method!.qualified_name).toBe('src/UserService.java/UserService.createUser');
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

describe('Java extractor — relations', () => {
  it('extracts import relations', () => {
    const { relations } = extractRelations(`
import java.util.List;
import java.util.Optional;

class Foo {}
`);
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(2);
  });

  it('extracts extend relations', () => {
    const { relations } = extractRelations(`
class Animal {}
class Dog extends Animal {}
`);
    const extends_ = relations.filter(r => r.type === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts implement relations', () => {
    const { relations } = extractRelations(`
interface Serializable {}
class Foo implements Serializable {}
`);
    const impls = relations.filter(r => r.type === 'implement');
    expect(impls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations', () => {
    const { relations } = extractRelations(`
class Foo {
    void bar() {}
}
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts throw relations', () => {
    const { relations } = extractRelations(`
class Foo {
    void bar() throws IOException {}
}
`);
    const throws = relations.filter(r => r.type === 'throw');
    expect(throws.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts create relations from new', () => {
    const { relations } = extractRelations(`
class User {}
class Foo {
    void bar() {
        User u = new User();
    }
}
`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts decorate relations from annotations', () => {
    const { relations } = extractRelations(`
@Service
class Foo {}
`);
    const decorates = relations.filter(r => r.type === 'decorate');
    expect(decorates.length).toBeGreaterThanOrEqual(1);
  });
});
