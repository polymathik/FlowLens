export interface User {
  id: string;
  name: string;
  age: number;
}

export interface CreateUserInput {
  name: string;
  age: number;
}

export type UserId = string;

export enum UserRole {
  Admin,
  User,
  Guest,
}
