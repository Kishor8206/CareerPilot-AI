import type { Express } from 'express';
import request from 'supertest';
import { UserRole } from '@careerpilot/shared';
import { createApp } from '../src/app';

let app: Express | null = null;

export function getApp(): Express {
  if (!app) app = createApp();
  return app;
}

export const API = '/api/v1';

export interface TestUser {
  email: string;
  password: string;
  accessToken: string;
  userId: string;
  role: UserRole;
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@test.careerpilot.local`;
}

export const VALID_PASSWORD = 'TestPassw0rd!';

/** Registers a user through the public API and returns usable credentials. */
export async function registerUser(
  role: UserRole = UserRole.STUDENT,
  overrides: Record<string, unknown> = {},
): Promise<TestUser> {
  const email = uniqueEmail(role.toLowerCase());
  const body: Record<string, unknown> = {
    fullName: `Test ${role}`,
    email,
    password: VALID_PASSWORD,
    role,
    department: 'Computer Science',
    ...(role === UserRole.ALUMNI
      ? { company: 'Test Corp', designation: 'Senior Engineer', domain: 'Software Engineering', experienceYears: 5 }
      : {}),
    ...overrides,
  };

  const response = await request(getApp()).post(`${API}/auth/register`).send(body);
  if (response.status !== 201) {
    throw new Error(`Registration failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return {
    email,
    password: VALID_PASSWORD,
    accessToken: response.body.data.tokens.accessToken,
    userId: response.body.data.user.id,
    role,
  };
}

/**
 * Creates a privileged account. Admin and placement-officer roles cannot be
 * self-registered, so the record is created directly and then signed in.
 */
export async function createPrivilegedUser(role: UserRole): Promise<TestUser> {
  const { User } = await import('../src/models/User');
  const { PlacementOfficer } = await import('../src/models/PlacementOfficer');

  const email = uniqueEmail(role.toLowerCase());
  const user = await User.create({
    email,
    passwordHash: await User.hashPassword(VALID_PASSWORD),
    fullName: `Test ${role}`,
    role,
    emailVerified: true,
  });

  if (role === UserRole.PLACEMENT_OFFICER) {
    await PlacementOfficer.create({ userId: user._id, departments: [] });
  }

  const login = await request(getApp()).post(`${API}/auth/login`).send({ email, password: VALID_PASSWORD });
  return {
    email,
    password: VALID_PASSWORD,
    accessToken: login.body.data.tokens.accessToken,
    userId: user._id.toString(),
    role,
  };
}

export function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.accessToken}` };
}
