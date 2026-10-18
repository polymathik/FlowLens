import { fetchSessions } from '../lib/api';

export const load = async () => {
  return { sessions: await fetchSessions() };
};
