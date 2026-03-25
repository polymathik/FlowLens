import { createRequire } from 'node:module';
import { registerDynamicLanguage } from '@ast-grep/napi';

const require = createRequire(import.meta.url);

let registered = false;

/**
 * Register all dynamic languages with @ast-grep/napi.
 * Safe to call multiple times — only registers once.
 */
export function ensureLanguagesRegistered(): void {
  if (registered) return;

  const langs: Record<string, any> = {};

  const langPackages: Record<string, string> = {
    python: '@ast-grep/lang-python',
    go: '@ast-grep/lang-go',
    rust: '@ast-grep/lang-rust',
    java: '@ast-grep/lang-java',
    kotlin: '@ast-grep/lang-kotlin',
    c: '@ast-grep/lang-c',
    cpp: '@ast-grep/lang-cpp',
    csharp: '@ast-grep/lang-csharp',
    php: '@ast-grep/lang-php',
    ruby: '@ast-grep/lang-ruby',
    swift: '@ast-grep/lang-swift',
    scala: '@ast-grep/lang-scala',
    bash: '@ast-grep/lang-bash',
    json: '@ast-grep/lang-json',
    yaml: '@ast-grep/lang-yaml',
  };

  for (const [name, pkg] of Object.entries(langPackages)) {
    try {
      const langModule = require(pkg);
      langs[name] = langModule.default ?? langModule;
    } catch {
      // Package not installed — skip silently
    }
  }

  if (Object.keys(langs).length > 0) {
    registerDynamicLanguage(langs);
  }

  registered = true;
}
