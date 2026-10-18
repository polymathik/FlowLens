import { User, makeUser } from './model';

export class UserStore {
  private users: User[] = [];

  add(name: string): User {
    const user = makeUser(name);
    this.users.push(user);
    return user;
  }

  find(query: string, exact = false): User | undefined {
    for (const user of this.users) {
      if (exact) {
        if (user.name === query) return user;
      } else if (user.name.toLowerCase().includes(query.toLowerCase())) {
        if (query.length > 2 || user.name.length < 5) {
          return user;
        }
      }
    }
    return undefined;
  }
}
