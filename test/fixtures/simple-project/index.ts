import { UserService } from './user-service';
import { formatName } from './utils';
import type { User } from './types';

const service = new UserService();
service.createUser({ name: formatName('John'), age: 30 });
