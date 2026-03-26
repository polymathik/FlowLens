/**
 * Central registration for all language extractors.
 *
 * Imports each language extractor and registers it with the
 * singleton extractor registry. Called once during parser initialization.
 */
import { extractorRegistry } from '../extractor-registry.js';
import { pythonExtractor } from './python-extractor.js';
import { javaExtractor } from './java-extractor.js';
import { kotlinExtractor } from './kotlin-extractor.js';
import { csharpExtractor } from './csharp-extractor.js';
import { phpExtractor } from './php-extractor.js';
import { goExtractor } from './go-extractor.js';
import { rustExtractor } from './rust-extractor.js';
import { cExtractor } from './c-extractor.js';
import { cppExtractor } from './cpp-extractor.js';
import { swiftExtractor } from './swift-extractor.js';

let registered = false;

/**
 * Register all language extractors. Safe to call multiple times.
 */
export function registerAllExtractors(): void {
  if (registered) return;

  extractorRegistry.register(pythonExtractor);
  extractorRegistry.register(javaExtractor);
  extractorRegistry.register(kotlinExtractor);
  extractorRegistry.register(csharpExtractor);
  extractorRegistry.register(phpExtractor);
  extractorRegistry.register(goExtractor);
  extractorRegistry.register(rustExtractor);
  extractorRegistry.register(cExtractor);
  extractorRegistry.register(cppExtractor);
  extractorRegistry.register(swiftExtractor);

  registered = true;
}
