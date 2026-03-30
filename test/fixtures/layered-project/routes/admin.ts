// VIOLATION: Routes → Data (Routes may only access Services)
import { UserRepo } from '../data/user-repo';

export function getAdminUsers() {
  return UserRepo.findAdmins();
}
