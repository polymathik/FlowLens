/**
 * Public entry points of the health engine. Consumers (CLI report, canvas
 * Health screen, Home cards, MCP `flowlens://health`) import from here.
 */
export { buildHealthReport, summarizeHealth } from './engine.js';
export { loadHealthInput, HealthGraphMissingError } from './load.js';
export { renderMarkdown } from './render/markdown.js';
export { renderHtml } from './render/html.js';
export { GLOSSARY, BANNED_JARGON, findJargon } from './glossary.js';
export { HEALTH_THRESHOLDS } from './config.js';

import type { HealthReport } from '../contracts/health.js';
import { renderHtml } from './render/html.js';
import { renderMarkdown } from './render/markdown.js';

import type { HealthFormat } from '../contracts/health.js';

export type { HealthFormat } from '../contracts/health.js';

export function renderHealth(report: HealthReport, format: HealthFormat): string {
  if (format === 'html') return renderHtml(report);
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  return renderMarkdown(report);
}
