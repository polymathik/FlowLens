import { Controller, Get, Post } from '@nestjs/common';
import { query } from '../db/client.js';

@Controller('cats')
export class CatsController {
  @Get(':id')
  findOne(id: string) {
    return query(id);
  }

  @Post()
  create() {
    return query('cat');
  }
}
