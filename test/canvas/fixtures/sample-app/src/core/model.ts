import { slugify } from '../../lib/util/strings';

export class User {
  constructor(public name: string) {}

  id(): string {
    return slugify(this.name);
  }
}

export function makeUser(name: string): User {
  return new User(name);
}
