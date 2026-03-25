/**
 * Registry for per-language entity and relation extractors.
 *
 * The singleton `extractorRegistry` lets each language plug in its own
 * `LanguageExtractor` implementation. The parser looks up the registry
 * by language key to decide whether deep extraction is available.
 */
import type { LanguageExtractor } from '../contracts/language-extractor.js';

class ExtractorRegistry {
  private extractors = new Map<string, LanguageExtractor>();

  /** Register an extractor for a language. */
  register(extractor: LanguageExtractor): void {
    this.extractors.set(extractor.language, extractor);
  }

  /** Retrieve the extractor for a language, if registered. */
  get(language: string): LanguageExtractor | undefined {
    return this.extractors.get(language);
  }

  /** Check whether a language has a registered extractor. */
  has(language: string): boolean {
    return this.extractors.has(language);
  }

  /** Get all registered language keys. */
  languages(): string[] {
    return [...this.extractors.keys()];
  }
}

/** Singleton registry shared across the parser subsystem. */
export const extractorRegistry = new ExtractorRegistry();
