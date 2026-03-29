export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
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

const DEEP_EXTRACTION_LANGUAGES = new Set([
  'typescript', 'tsx', 'javascript', 'jsx',
]);

export function extensionToLanguage(ext: string): string | null {
  return LANGUAGE_EXTENSIONS[ext] ?? null;
}

export function isDeepExtractionLanguage(language: string): boolean {
  return DEEP_EXTRACTION_LANGUAGES.has(language);
}

export function normalizeRelativePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
