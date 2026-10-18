/**
 * Java package + import bindings (pass 1).
 *
 * Java resolves names by package, not by file, so bindings carry
 * `source_package` and pass 2 finds the declaring file through the
 * package index:
 *   import com.x.Foo;            → local Foo, package com.x, imported Foo
 *   import com.x.Outer.Inner;    → local Inner, package com.x, imported Outer.Inner
 *   import com.x.*;              → wildcard over package com.x
 *   import static com.x.U.m;     → local m, package com.x, imported U.m
 * Packages not present in the project resolve as external in pass 2.
 */
import type { SgNode } from '@ast-grep/napi';
import type { FileSymbols, ImportBinding } from '../../contracts/symbols.js';
import { loc } from '../symbols/emitter.js';

export function extractJavaSymbols(root: SgNode, filePath: string): FileSymbols {
  let pkg = '';
  const imports: ImportBinding[] = [];
  for (const node of root.children()) {
    const k = node.kind();
    if (k === 'package_declaration') {
      const id = node.children().find((c) => c.kind() === 'scoped_identifier' || c.kind() === 'identifier');
      if (id) pkg = id.text();
    } else if (k === 'import_declaration') {
      const binding = importBinding(node);
      if (binding) imports.push(binding);
    }
  }
  return { file: filePath, language: 'java', package: pkg, imports, exports: [], reexports: [], implicit_exports: true };
}

function importBinding(node: SgNode): ImportBinding | null {
  const children = node.children();
  const id = children.find((c) => c.kind() === 'scoped_identifier' || c.kind() === 'identifier');
  if (!id) return null;
  const path = id.text().split('.');
  const wildcard = children.some((c) => c.kind() === 'asterisk');
  const location = loc(node);
  if (wildcard) {
    // `import com.x.*` (package) or `import com.x.Outer.*` (nested types)
    const split = splitPackage(path);
    return {
      local: '*', imported: split.type.length > 0 ? split.type.join('.') : '*',
      specifier: id.text() + '.*', source_file: null, source_package: split.pkg, external: false, location,
    };
  }
  const split = splitPackage(path);
  if (split.type.length === 0) return null;
  return {
    local: path[path.length - 1],
    imported: split.type.join('.'),
    specifier: id.text(),
    source_file: null,
    source_package: split.pkg,
    external: false,
    location,
  };
}

/** Package = leading segments up to the first capitalised one (Java naming convention). */
function splitPackage(path: string[]): { pkg: string; type: string[] } {
  const idx = path.findIndex((s) => /^[A-Z]/.test(s));
  if (idx < 0) return { pkg: path.join('.'), type: [] };
  return { pkg: path.slice(0, idx).join('.'), type: path.slice(idx) };
}
