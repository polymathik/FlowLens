import { renderDashboard } from './ui/Dashboard';
import { renderSettings } from './ui/Settings';

export function main(): string {
  return renderDashboard('u1') + renderSettings();
}
