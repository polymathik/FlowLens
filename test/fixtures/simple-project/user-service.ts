import type { User, CreateUserInput } from './types';

export class UserService {
  private users: User[] = [];

  createUser(input: CreateUserInput): User {
    const user = { id: String(this.users.length + 1), ...input };
    this.users.push(user);
    return user;
  }

  getUser(id: string): User | undefined {
    return this.users.find(u => u.id === id);
  }
}
