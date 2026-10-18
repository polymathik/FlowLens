/** Validation for `flowlens agent` flags. Invalid values exit 2 with a message. */
import type { AgentEvent, AgentOutputFormat, AgentRisk } from '../contracts/agent.js';
import { MAX_BUDGET_CHARS } from './hook-output.js';

export const AGENT_EVENTS: readonly AgentEvent[] = [
  'session_start', 'prompt_submit', 'pre_edit', 'post_edit', 'pre_commit', 'stop', 'compact',
];
export const OUTPUT_FORMATS: readonly AgentOutputFormat[] = ['markdown', 'json'];
export const RISK_LEVELS: readonly AgentRisk[] = ['none', 'low', 'medium', 'high'];

export class AgentUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentUsageError';
  }
}

function oneOf<T extends string>(flag: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new AgentUsageError(`Invalid ${flag} "${String(value)}". Expected one of: ${allowed.join(', ')}.`);
}

function integer(flag: string, value: unknown, min: number, max: number): number {
  const text = String(value).trim();
  const parsed = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AgentUsageError(`Invalid ${flag} "${String(value)}". Expected an integer between ${min} and ${max}.`);
  }
  return parsed;
}

export const parseEvent = (value: unknown): AgentEvent => oneOf('--event', value, AGENT_EVENTS);
export const parseFormat = (value: unknown): AgentOutputFormat => oneOf('--format', value, OUTPUT_FORMATS);
export const parseRisk = (value: unknown): AgentRisk => oneOf('--min-risk', value, RISK_LEVELS);
export const parseMaxItems = (value: unknown): number => integer('--max-items', value, 1, 100);
export const parseBudget = (value: unknown): number => integer('--budget', value, 200, MAX_BUDGET_CHARS);

export function riskAtLeast(risk: AgentRisk, min: AgentRisk): boolean {
  return RISK_LEVELS.indexOf(risk) >= RISK_LEVELS.indexOf(min);
}

export function parseFileList(files: string | undefined): string[] {
  if (!files) return [];
  return files.split(',').map((file) => file.trim()).filter(Boolean);
}
