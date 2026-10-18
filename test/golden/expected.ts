/**
 * Expected cross-file edges for each golden fixture, written by hand from
 * the fixture sources. Format: `type from_qualified_name -> to_qualified_name`.
 * File entities use their path; module entities their directory.
 */
export interface GoldenExpectation {
  edges: string[];
  /** Qualified names that must exist. */
  entities?: string[];
  /** Same-file duplicate declarations the parser is expected to merge. */
  duplicates?: number;
}

const S = 'src/services/service.ts';
const L = 'src/lib';
const J = 'src/main/java/com/acme';

export const EXPECTED: Record<string, GoldenExpectation> = {
  'ts-esm': {
    edges: [
      `import ${L}/index.ts -> ${L}/base.ts`,
      `import ${L}/index.ts -> ${L}/util.ts`,
      `import src/models/user.ts -> ${L}/base.ts`,
      `import ${S} -> ${L}/index.ts`,
      `import ${S} -> ${L}/base.ts`,
      `import ${S} -> ${L}/util.ts`,
      `import ${S} -> src/models/user.ts`,
      `import src/main.ts -> ${S}`,
      `extend ${S}/Service -> ${L}/base.ts/Base`,
      `implement src/models/user.ts/User -> ${L}/base.ts/Runnable`,
      `override ${S}/Service.run -> ${L}/base.ts/Base.run`,
      `override ${S}/Service.describe -> ${L}/base.ts/Base.describe`,
      `call ${S}/Service.run -> ${S}/Service.describe`,
      // typed receivers (`const s = new Service(); s.run()`): resolved since parser-truth-2 (PARSER_VERSION 8.2.0)
      `call ${S}/Service.run -> src/models/user.ts/User.run`,
      `call src/main.ts/main -> ${S}/Service.run`,
      `call ${S}/Service.run -> ${L}/util.ts/helper`,
      `call ${S}/Service.describe -> ${L}/util.ts/format`,
      `call ${S}/Other.run -> ${S}/Other.describe`,
      `create ${S}/Service.run -> src/models/user.ts/User`,
      `create src/main.ts/main -> ${S}/Service`,
      `create src/main.ts/start -> ${S}/Service`,
      `throw ${S}/Service.fail -> ${L}/base.ts/AppError`,
      `return src/main.ts/start -> ${S}/Service`,
    ],
    entities: [`${S}/Service.run`, `${S}/Other.run`, 'src/main.ts/start.name'],
  },
  'ts-workspace': {
    edges: [
      'import packages/app/src/app.ts -> packages/core/src/index.ts',
      'import packages/app/src/app.ts -> packages/utils/src/index.ts',
      'extend packages/app/src/app.ts/App -> packages/core/src/index.ts/Engine',
      'call packages/app/src/app.ts/App.boot -> packages/core/src/index.ts/Engine.start',
      'call packages/app/src/app.ts/App.boot -> packages/utils/src/index.ts/slug',
    ],
  },
  'js-mixed': {
    edges: [
      'import lib/b.mjs -> lib/a.js',
      'import cjs/c.cjs -> cjs/d.cjs',
      'import index.js -> lib/b.mjs',
      'extend lib/b.mjs/B -> lib/a.js/A',
      'extend index.js/Widget -> lib/b.mjs/B',
      'override lib/b.mjs/B.greet -> lib/a.js/A.greet',
      'call lib/b.mjs/B.greet -> lib/a.js/A.greet',
      'call cjs/c.cjs/C.go -> cjs/d.cjs/helper',
      'call cjs/c.cjs/C.go -> cjs/d.cjs/unused',
      'create index.js/start -> lib/b.mjs/B',
    ],
  },
  'py-pkg': {
    edges: [
      'import app/__init__.py -> app/models.py',
      'import app/models.py -> app/base.py',
      'import app/service.py -> app/models.py',
      'import app/service.py -> app/base.py',
      'import app/service.py -> app/__init__.py',
      'import app/service.py -> app/util.py',
      'extend app/models.py/User -> app/base.py/Base',
      'extend app/models.py/Admin -> app/models.py/User',
      'extend app/service.py/Service -> app/base.py/Base',
      'override app/models.py/User.save -> app/base.py/Base.save',
      'override app/service.py/Service.save -> app/base.py/Base.save',
      'call app/models.py/User.save -> app/base.py/Base.validate',
      'call app/models.py/User.save -> app/models.py/User.name',
      'call app/service.py/Service.run -> app/util.py/helper',
      'call app/service.py/Service.save -> app/base.py/Base.save',
      'create app/service.py/Service.run -> app/models.py/User',
      'create app/service.py/Service.run -> app/models.py/Admin',
      'decorate app/base.py/Base.save.@tracked -> app/base.py/Base.save',
      'decorate app/models.py/Admin.level.@property -> app/models.py/Admin.level',
      'decorate app/models.py/Admin.level.@level.setter -> app/models.py/Admin.level',
    ],
    duplicates: 1,
  },
  'java-app': {
    edges: [
      `import ${J}/service/Kennel.java -> ${J}/model/Animal.java`,
      `import ${J}/service/Kennel.java -> ${J}/model/Dog.java`,
      `extend ${J}/model/Dog.java/Dog -> ${J}/model/Animal.java/Animal`,
      `implement ${J}/model/Dog.java/Dog -> ${J}/model/Pet.java/Pet`,
      `override ${J}/model/Dog.java/Dog.speak -> ${J}/model/Animal.java/Animal.speak`,
      `override ${J}/model/Dog.java/Dog.play -> ${J}/model/Pet.java/Pet.play`,
      `call ${J}/model/Dog.java/Dog.play -> ${J}/model/Animal.java/Animal.eat`,
      `create ${J}/service/Kennel.java/Kennel.adopt -> ${J}/model/Dog.java/Dog`,
      `call ${J}/service/Kennel.java/Kennel.adopt -> ${J}/model/Dog.java/Dog.speak`,
      `throw ${J}/service/Kennel.java/Kennel.fail -> ${J}/service/KennelException.java/KennelException`,
      `return ${J}/service/Kennel.java/Kennel.adopt -> ${J}/model/Animal.java/Animal`,
      `decorate ${J}/model/Dog.java/Dog.speak.@Override -> ${J}/model/Dog.java/Dog.speak`,
      `decorate ${J}/model/Dog.java/Dog.play.@Override -> ${J}/model/Dog.java/Dog.play`,
    ],
    duplicates: 1,
  },
  'go-app': {
    edges: [
      'import main.go -> internal/shapes/shape.go',
      'import main.go -> internal/shapes/util.go',
      'call main.go/main -> internal/shapes/shape.go/NewRect',
      'call main.go/main -> internal/shapes/util.go/Total',
      'call internal/shapes/util.go/Total -> internal/shapes/shape.go/helper',
      'create internal/shapes/shape.go/NewRect -> internal/shapes/shape.go/Rect',
      'create main.go/main -> internal/shapes/shape.go/Rect',
    ],
    entities: ['internal/shapes/shape.go/Rect.Area'],
  },
};
