import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { UserRole } from '@careerpilot/shared';
import { API, VALID_PASSWORD, auth, getApp, registerUser, uniqueEmail } from './helpers';

describe('Authentication (§28)', () => {
  describe('registration', () => {
    it('creates a student account and returns tokens', async () => {
      const email = uniqueEmail('student');
      const response = await request(getApp()).post(`${API}/auth/register`).send({
        fullName: 'Aarthi Ramesh',
        email,
        password: VALID_PASSWORD,
        role: UserRole.STUDENT,
        department: 'Computer Science',
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(email);
      expect(response.body.data.user.role).toBe(UserRole.STUDENT);
      expect(response.body.data.tokens.accessToken).toBeTruthy();
      // The password hash must never appear in an API response.
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    });

    it('creates the matching StudentProfile', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const { StudentProfile } = await import('../src/models/StudentProfile');
      const profile = await StudentProfile.findOne({ userId: user.userId });
      expect(profile).not.toBeNull();
    });

    it('creates alumni as PENDING verification, never auto-verified', async () => {
      const user = await registerUser(UserRole.ALUMNI);
      const { AlumniProfile } = await import('../src/models/AlumniProfile');
      const profile = await AlumniProfile.findOne({ userId: user.userId });
      expect(profile?.verificationStatus).toBe('PENDING');
    });

    it('rejects a duplicate email address', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const response = await request(getApp()).post(`${API}/auth/register`).send({
        fullName: 'Duplicate',
        email: user.email,
        password: VALID_PASSWORD,
        role: UserRole.STUDENT,
      });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('rejects a weak password with field-level detail', async () => {
      const response = await request(getApp()).post(`${API}/auth/register`).send({
        fullName: 'Weak Password',
        email: uniqueEmail(),
        password: 'short',
        role: UserRole.STUDENT,
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.some((d: { path: string }) => d.path === 'password')).toBe(true);
    });

    it('rejects a malformed email address', async () => {
      const response = await request(getApp()).post(`${API}/auth/register`).send({
        fullName: 'Bad Email',
        email: 'not-an-email',
        password: VALID_PASSWORD,
        role: UserRole.STUDENT,
      });
      expect(response.status).toBe(400);
    });

    it('refuses privilege escalation: ADMIN cannot be self-registered', async () => {
      const response = await request(getApp()).post(`${API}/auth/register`).send({
        fullName: 'Would-be Admin',
        email: uniqueEmail('admin'),
        password: VALID_PASSWORD,
        role: 'ADMIN',
      });
      expect(response.status).toBe(400);
    });

    it('requires company and domain for alumni registration', async () => {
      const response = await request(getApp()).post(`${API}/auth/register`).send({
        fullName: 'Incomplete Alumni',
        email: uniqueEmail('alumni'),
        password: VALID_PASSWORD,
        role: UserRole.ALUMNI,
      });
      expect(response.status).toBe(400);
    });
  });

  describe('login', () => {
    it('signs in with correct credentials', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const response = await request(getApp())
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: user.password });

      expect(response.status).toBe(200);
      expect(response.body.data.tokens.accessToken).toBeTruthy();
      // The refresh token is delivered as a signed httpOnly cookie.
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('cp_refresh=') && c.includes('HttpOnly'))).toBe(true);
    });

    it('rejects a wrong password', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const response = await request(getApp())
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'WrongPassw0rd!' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('gives an identical response for unknown and wrong-password accounts', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const [unknownAccount, wrongPassword] = await Promise.all([
        request(getApp()).post(`${API}/auth/login`).send({ email: uniqueEmail('ghost'), password: VALID_PASSWORD }),
        request(getApp()).post(`${API}/auth/login`).send({ email: user.email, password: 'WrongPassw0rd!' }),
      ]);

      // Account enumeration defence: same status and same message either way.
      expect(unknownAccount.status).toBe(wrongPassword.status);
      expect(unknownAccount.body.error.message).toBe(wrongPassword.body.error.message);
    });

    it('writes an audit record for a failed sign-in', async () => {
      const email = uniqueEmail('audited');
      await request(getApp()).post(`${API}/auth/login`).send({ email, password: VALID_PASSWORD });
      const { AuditLog } = await import('../src/models/AuditLog');
      const entry = await AuditLog.findOne({ action: 'auth.login.failure', actorEmail: email });
      expect(entry).not.toBeNull();
      expect(entry?.status).toBe('FAILURE');
    });
  });

  describe('token lifecycle', () => {
    it('returns the current user for a valid token', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const response = await request(getApp()).get(`${API}/auth/me`).set(auth(user));
      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(user.userId);
    });

    it('rejects a request with no token', async () => {
      const response = await request(getApp()).get(`${API}/auth/me`);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a tampered token', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const response = await request(getApp())
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${user.accessToken.slice(0, -4)}AAAA`);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('rotates the refresh token and revokes the presented one', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const login = await request(getApp())
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: user.password });
      const refreshToken = login.body.data.tokens.refreshToken;

      const first = await request(getApp()).post(`${API}/auth/refresh`).send({ refreshToken });
      expect(first.status).toBe(200);
      expect(first.body.data.tokens.refreshToken).not.toBe(refreshToken);

      // Replaying the original token must fail (rotation detection).
      const replay = await request(getApp()).post(`${API}/auth/refresh`).send({ refreshToken });
      expect(replay.status).toBe(401);
    });

    it('revokes the whole token family when a used token is replayed', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const login = await request(getApp())
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: user.password });
      const original = login.body.data.tokens.refreshToken;

      const rotated = await request(getApp()).post(`${API}/auth/refresh`).send({ refreshToken: original });
      const newToken = rotated.body.data.tokens.refreshToken;

      // Replay the stolen original: this must burn the whole family...
      await request(getApp()).post(`${API}/auth/refresh`).send({ refreshToken: original });
      // ...including the legitimately rotated token.
      const afterBreach = await request(getApp()).post(`${API}/auth/refresh`).send({ refreshToken: newToken });
      expect(afterBreach.status).toBe(401);
    });

    it('rejects an unknown refresh token', async () => {
      const response = await request(getApp())
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: 'a'.repeat(96) });
      expect(response.status).toBe(401);
    });
  });

  describe('password management', () => {
    it('does not reveal whether an email is registered', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const known = await request(getApp()).post(`${API}/auth/forgot-password`).send({ email: user.email });
      const unknown = await request(getApp()).post(`${API}/auth/forgot-password`).send({ email: uniqueEmail('ghost') });

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(known.body.data.message).toBe(unknown.body.data.message);
    });

    it('changes the password and invalidates existing sessions', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const login = await request(getApp())
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: user.password });
      const refreshToken = login.body.data.tokens.refreshToken;

      const change = await request(getApp())
        .post(`${API}/auth/change-password`)
        .set('Authorization', `Bearer ${login.body.data.tokens.accessToken}`)
        .send({ currentPassword: user.password, newPassword: 'BrandNewPassw0rd!' });
      expect(change.status).toBe(200);

      const staleRefresh = await request(getApp()).post(`${API}/auth/refresh`).send({ refreshToken });
      expect(staleRefresh.status).toBe(401);

      const newLogin = await request(getApp())
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'BrandNewPassw0rd!' });
      expect(newLogin.status).toBe(200);
    });

    it('rejects a password change with the wrong current password', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const response = await request(getApp())
        .post(`${API}/auth/change-password`)
        .set(auth(user))
        .send({ currentPassword: 'NotMyPassw0rd!', newPassword: 'AnotherPassw0rd!' });
      expect(response.status).toBe(400);
    });
  });

  describe('input hardening', () => {
    it('neutralises a NoSQL operator injected into the login body', async () => {
      const response = await request(getApp())
        .post(`${API}/auth/login`)
        .send({ email: { $ne: null }, password: { $ne: null } });
      // The sanitiser strips `$ne`, leaving an empty object that fails validation.
      expect([400, 401]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });

    it('returns a structured error envelope for unknown endpoints', async () => {
      const response = await request(getApp()).get(`${API}/does-not-exist`);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      expect(response.body.error.message).toBeTruthy();
      expect(response.body.error.stack).toBeUndefined();
    });

    it('attaches a correlation id to every response', async () => {
      const response = await request(getApp()).get('/health/live');
      expect(response.headers['x-request-id']).toBeTruthy();
    });
  });
});
