export class User {
  public name: string = '';
  public email: string = '';

  getUser(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name;
  }
}

export type UserId = string;

export function validateUser(user: User): boolean {
  return user.name.length > 0;
}
