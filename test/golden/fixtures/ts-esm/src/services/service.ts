import { Base, AppError, aliasHelper, format } from '../lib/index.js';
import { User } from '../models/user.js';
import * as util from '../lib/util.js';

export class Service extends Base {
  run(): void {
    const u = new User();
    u.run();
    this.describe();
    aliasHelper(1);
    util.helper(2);
  }

  describe(): string {
    return format('s', 3);
  }

  fail(): never {
    throw new AppError();
  }
}

export class Other {
  run(): void {
    this.describe();
  }

  describe(): string {
    return 'o';
  }
}
