import { describe, it, expect } from 'vitest';
import { findUsers } from '../src/services/user-service.js';

describe('users', () => {
  it('finds users', () => {
    expect(findUsers()).toBeTruthy();
  });
});
