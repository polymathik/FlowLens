export interface DiscoveryConfig {
  rootDir: string;
  excludePatterns: string[];
  supportedExtensions: string[];
}

export interface DiscoveredFile {
  path: string;
  absolutePath: string;
  extension: string;
  language: string;
}

export interface FileDiscovery {
  discover(config: DiscoveryConfig): Promise<DiscoveredFile[]>;
}
