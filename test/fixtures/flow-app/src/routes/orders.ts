import { Router } from 'express';
import { listOrders } from '../handlers/orders.js';

const router = Router();

router.get('/orders', listOrders);
router.post('/orders/:id/cancel', (_req, res) => {
  res.json(listOrders());
});

export default router;
