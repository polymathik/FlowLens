import { fetchSessions } from '../../../lib/api';

export async function GET() {
  return fetchSessions();
}

export const POST = async () => {
  return new Response('pong');
};
