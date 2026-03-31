// Allowed: Routes → Services
import { UserService } from '../services/user-service';

export function getUsers() {
  return UserService.findAll();
}
