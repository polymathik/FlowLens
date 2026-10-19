/**
 * Published identity of this package. The npm name is scoped because the
 * registry refused the bare `flowlens` (too similar to `flow-lens`); the CLI
 * binary is still `flowlens`, so `npx flowlens …` keeps working once the
 * package is installed in a project. The bare name is still accepted when
 * locating the package root (source checkouts, older tarballs, test stubs).
 */
export const PACKAGE_NAME = '@polymathik/flowlens';
export const LEGACY_PACKAGE_NAME = 'flowlens';
export const CLI_BIN_NAME = 'flowlens';

export function isFlowLensPackageName(name: unknown): boolean {
  return name === PACKAGE_NAME || name === LEGACY_PACKAGE_NAME;
}
