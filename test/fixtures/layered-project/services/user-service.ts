// Allowed: Services → Data
import { UserRepo } from '../data/user-repo';

export class UserService {
  static findAll() {
    return UserRepo.findAll();
  }
}
