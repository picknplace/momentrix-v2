import { queryOne, queryAll, execute } from '@/lib/db';
import { hashPassword } from './auth';

export interface User {
  user_id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator';
  status: 'pending' | 'active' | 'inactive';
  created_at: string;
  last_login: string | null;
}

export async function getUserById(userId: string): Promise<User | null> {
  return queryOne<User>(
    'SELECT user_id, email, name, role, status, created_at, last_login FROM users WHERE user_id = ?',
    userId
  );
}

export async function getUserWithHash(userId: string) {
  return queryOne<User & { password_hash: string }>(
    'SELECT user_id, password_hash, email, name, role, status FROM users WHERE user_id = ?',
    userId
  );
}

export async function updateLastLogin(userId: string) {
  await execute(
    "UPDATE users SET last_login = datetime('now') WHERE user_id = ?",
    userId
  );
}

export async function getAllUsers(): Promise<User[]> {
  return queryAll<User>(
    'SELECT user_id, email, name, role, status, created_at, last_login FROM users ORDER BY created_at DESC'
  );
}

export async function updateUserStatus(userId: string, status: 'active' | 'inactive') {
  await execute('UPDATE users SET status = ? WHERE user_id = ?', status, userId);
}

export async function updateUserRole(userId: string, role: 'admin' | 'operator') {
  await execute('UPDATE users SET role = ? WHERE user_id = ?', role, userId);
}

export async function resetUserPassword(userId: string, newPassword: string) {
  const hash = await hashPassword(newPassword);
  await execute('UPDATE users SET password_hash = ? WHERE user_id = ?', hash, userId);
}

export async function createUser(
  userId: string,
  password: string,
  email: string,
  name: string,
  role: 'admin' | 'operator' = 'operator',
  status: 'pending' | 'active' = 'pending'
) {
  const hash = await hashPassword(password);
  await execute(
    'INSERT INTO users (user_id, password_hash, email, name, role, status) VALUES (?, ?, ?, ?, ?, ?)',
    userId, hash, email, name, role, status
  );
}
