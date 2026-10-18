import express from 'express';
import { listUsers, createUser } from './handlers/users.js';
import { requireAuth } from './middleware/auth.js';
import ordersRouter from './routes/orders.js';

const app = express();

app.get('/api/users', requireAuth, listUsers);
app.post('/api/users', async (req, res) => {
  res.json(await createUser(req.body));
});
app.use('/api', ordersRouter);
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

export function start(port: number) {
  return app.listen(port);
}
