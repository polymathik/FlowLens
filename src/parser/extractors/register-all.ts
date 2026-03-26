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

  registered = true;
}
