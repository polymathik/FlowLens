/**
 * Generates a synthetic TypeScript project for benchmarking. Files are
 * realistic enough to exercise the full pipeline (imports, classes,
 * functions, inter-file edges) but deterministic so runs are comparable.
 *
 * Each file contains:
 *   - K imports from other files in the project (modulo N to create a
 *     dense dependency graph)
 *   - 1 class with E exported methods (exercises both class + function
 *     extractors)
 *   - 1 standalone exported function (exercises top-level function path)
 *
 * Randomness uses a seeded LCG so outputs are reproducible.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface GeneratorOptions {
  /** Absolute path to the output directory (usually a temp dir). */
  rootDir: string;
  /** Number of files to generate. */
  fileCount: number;
  /** Imports per file. Default: 3. */
  importsPerFile?: number;
  /** Methods per class. Default: 4. */
  methodsPerClass?: number;
  /** PRNG seed. Default: 42. */
  seed?: number;
}

export interface GeneratorResult {
  filesCreated: number;
  rootDir: string;
}

export async function generateSyntheticProject(
  options: GeneratorOptions,
): Promise<GeneratorResult> {
  const {
    rootDir,
    fileCount,
    importsPerFile = 3,
    methodsPerClass = 4,
    seed = 42,
  } = options;

  const srcDir = join(rootDir, 'src');
  await mkdir(srcDir, { recursive: true });

  // Seeded LCG — rand() returns a value in [0, 1)
  let state = seed;
  const rand = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  for (let i = 0; i < fileCount; i++) {
    const imports: string[] = [];
    for (let k = 0; k < importsPerFile; k++) {
      const target = Math.floor(rand() * fileCount);
      if (target !== i) {
        imports.push(`import { Class${target} } from './mod${target}.js';`);
      }
    }

    const methods: string[] = [];
    for (let m = 0; m < methodsPerClass; m++) {
      methods.push(`  method${m}(arg: number): number { return arg * ${m + 1}; }`);
    }

    const content = [
      imports.join('\n'),
      '',
      `export class Class${i} {`,
      methods.join('\n'),
      '}',
      '',
      `export function helper${i}(x: number): number {`,
      `  return x + ${i};`,
      `}`,
      '',
    ].join('\n');

    await writeFile(join(srcDir, `mod${i}.ts`), content);
  }

  // Add tsconfig so the project looks real
  await writeFile(
    join(rootDir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext' } }),
  );
  // Minimal package.json so file walker treats this as a project root
  await writeFile(
    join(rootDir, 'package.json'),
    JSON.stringify({ name: 'synthetic', version: '0.0.0' }),
  );

  return { filesCreated: fileCount, rootDir };
}
