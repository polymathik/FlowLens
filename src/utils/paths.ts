export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.svelte': 'svelte',
  '.vue': 'vue',
  '.css': 'css',
  '.html': 'html',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.lua': 'lua',
  '.rb': 'ruby',
  '.scala': 'scala',
  '.swift': 'swift',
  '.dart': 'dart',
  '.sh': 'bash',
  '.bash': 'bash',
};

/** Extensions enabled by `config.languages` (languages not listed are enabled). */
export function getSupportedExtensions(languages: Record<string, boolean>): string[] {
  return Object.entries(LANGUAGE_EXTENSIONS)
    .filter(([, lang]) => languages[lang] !== false)
    .map(([ext]) => ext);
}

export function extensionToLanguage(ext: string): string | null {
  return LANGUAGE_EXTENSIONS[ext] ?? null;
}

export function normalizeRelativePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
