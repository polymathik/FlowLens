// Changes from before:
// - User.email field removed (breaking)
// - User.getUser renamed to User.findUser (breaking: removed + added)
// - User.setName gained extra parameter (breaking: parameter_added)
// - UserId type expanded (type_changed)
// - validateUser visibility changed to private (breaking: visibility)
// - New function added (non-breaking)

export class User {
  public name: string = '';
  // email removed

  findUser(): string {
    return this.name;
  }

  setName(name: string, force: boolean): void {
    this.name = name;
  }
}

export type UserId = string | number; // expanded

function validateUser(user: User): boolean {
  return user.name.length > 0;
}

export function formatUser(user: User): string {
  return user.name;
}
