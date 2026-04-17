export interface MCPServerConfig {
  graphPath: string;
  configPath: string;
  port?: number;
}

export interface MCPToolResponse<T> {
  data: T;
  last_indexed: string;
  truncated: boolean;
  total_count?: number;
  /** Deep-link to the canvas view for this response's primary target. */
  canvas_url?: string;
}
