import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { UserRole, VerificationStatus } from '@careerpilot/shared';
import { API, auth, createPrivilegedUser, getApp, registerUser, type TestUser } from './helpers';

/**
 * Role-based access control (§2, §29).
 *
 * These tests assert the negative cases as strictly as the positive ones:
 * an authorisation bug is only visible when the wrong role is refused.
 */
describe('Role-based access control (§29)', () => {
  let student: TestUser;
  let alumni: TestUser;
  let officer: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    student = await registerUser(UserRole.STUDENT);
    alumni = await registerUser(UserRole.ALUMNI);
    officer = await createPrivilegedUser(UserRole.PLACEMENT_OFFICER);
    admin = await createPrivilegedUser(UserRole.ADMIN);
  }, 120_000);

  describe('admin endpoints', () => {
    const adminRoutes = [
      { method: 'get' as const, path: '/admin/dashboard' },
      { method: 'get' as const, path: '/admin/users' },
      { method: 'get' as const, path: '/admin/audit' },
      { method: 'get' as const, path: '/admin/config' },
      { method: 'get' as const, path: '/admin/flagged' },
      { method: 'get' as const, path: '/admin/rag' },
    ];

    it('allows an administrator', async () => {
      for (const route of adminRoutes) {
        const response = await request(getApp())[route.method](`${API}${route.path}`).set(auth(admin));
        expect(response.status, `${route.path} should allow ADMIN`).toBe(200);
      }
    });

    it('refuses a student', async () => {
      for (const route of adminRoutes) {
        const response = await request(getApp())[route.method](`${API}${route.path}`).set(auth(student));
        expect(response.status, `${route.path} should refuse STUDENT`).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('refuses a placement officer', async () => {
      const response = await request(getApp()).get(`${API}/admin/users`).set(auth(officer));
      expect(response.status).toBe(403);
    });

    it('refuses an alumnus', async () => {
      const response = await request(getApp()).get(`${API}/admin/dashboard`).set(auth(alumni));
      expect(response.status).toBe(403);
    });

    it('refuses an unauthenticated caller', async () => {
      const response = await request(getApp()).get(`${API}/admin/dashboard`);
      expect(response.status).toBe(401);
    });
  });

  describe('institutional analytics', () => {
    it('allows staff roles', async () => {
      for (const staff of [officer, admin]) {
        const response = await request(getApp()).get(`${API}/analytics/placement`).set(auth(staff));
        expect(response.status).toBe(200);
        expect(response.body.data.totals).toBeDefined();
      }
    });

    it('refuses students and alumni', async () => {
      for (const user of [student, alumni]) {
        const response = await request(getApp()).get(`${API}/analytics/placement`).set(auth(user));
        expect(response.status).toBe(403);
      }
    });

    it('refuses a student the research export', async () => {
      const response = await request(getApp()).get(`${API}/analytics/research-export`).set(auth(student));
      expect(response.status).toBe(403);
    });
  });

  describe('student-only endpoints', () => {
    it('refuses an alumnus the student dashboard', async () => {
      const response = await request(getApp()).get(`${API}/students/me/dashboard`).set(auth(alumni));
      expect(response.status).toBe(403);
    });

    it('refuses an officer the student profile endpoint', async () => {
      const response = await request(getApp()).get(`${API}/students/me`).set(auth(officer));
      expect(response.status).toBe(403);
    });

    it('allows a student their own dashboard', async () => {
      const response = await request(getApp()).get(`${API}/students/me/dashboard`).set(auth(student));
      expect(response.status).toBe(200);
      expect(response.body.data.profile).toBeDefined();
    });
  });

  describe('cross-student data isolation', () => {
    it('refuses one student access to another student profile', async () => {
      const other = await registerUser(UserRole.STUDENT);
      const { StudentProfile } = await import('../src/models/StudentProfile');
      const otherProfile = await StudentProfile.findOne({ userId: other.userId });

      const response = await request(getApp())
        .get(`${API}/students/${otherProfile!._id.toString()}`)
        .set(auth(student));

      expect(response.status).toBe(403);
    });

    it('allows staff to read a student profile, and records an audit entry', async () => {
      const { StudentProfile } = await import('../src/models/StudentProfile');
      const profile = await StudentProfile.findOne({ userId: student.userId });

      const response = await request(getApp())
        .get(`${API}/students/${profile!._id.toString()}`)
        .set(auth(officer));

      expect(response.status).toBe(200);

      const { AuditLog } = await import('../src/models/AuditLog');
      const entry = await AuditLog.findOne({
        action: 'staff.student_record.access',
        resourceId: profile!._id.toString(),
      });
      expect(entry).not.toBeNull();
    });
  });

  describe('alumni verification gate (§18)', () => {
    it('refuses an unverified alumnus the mentorship dashboard', async () => {
      const response = await request(getApp()).get(`${API}/alumni/dashboard`).set(auth(alumni));
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ALUMNI_NOT_VERIFIED');
    });

    it('lets an unverified alumnus still edit their own profile', async () => {
      // Otherwise they could never supply the details needed for verification.
      const response = await request(getApp())
        .patch(`${API}/alumni/me`)
        .set(auth(alumni))
        .send({ bio: 'Updated while awaiting verification.' });
      expect(response.status).toBe(200);
    });

    it('hides unverified alumni from student search', async () => {
      const response = await request(getApp()).get(`${API}/alumni/search`).set(auth(student));
      expect(response.status).toBe(200);
      const ids = (response.body.data as Array<{ userId: string }>).map((a) => a.userId);
      expect(ids).not.toContain(alumni.userId);
    });

    it('reveals the alumnus once an administrator verifies them', async () => {
      const { AlumniProfile } = await import('../src/models/AlumniProfile');
      const profile = await AlumniProfile.findOne({ userId: alumni.userId });

      const verify = await request(getApp())
        .post(`${API}/admin/alumni/${profile!._id.toString()}/verify`)
        .set(auth(admin))
        .send({ status: VerificationStatus.VERIFIED, note: 'Verified for testing.' });
      expect(verify.status).toBe(200);

      const search = await request(getApp()).get(`${API}/alumni/search`).set(auth(student));
      const ids = (search.body.data as Array<{ userId: string }>).map((a) => a.userId);
      expect(ids).toContain(alumni.userId);

      const dashboard = await request(getApp()).get(`${API}/alumni/dashboard`).set(auth(alumni));
      expect(dashboard.status).toBe(200);
    });

    it('writes an audit entry for the verification decision', async () => {
      const { AuditLog } = await import('../src/models/AuditLog');
      const entry = await AuditLog.findOne({ action: 'admin.alumni.verify' });
      expect(entry).not.toBeNull();
      expect(entry?.actorRole).toBe(UserRole.ADMIN);
    });
  });

  describe('privilege-escalation guards', () => {
    it('refuses a student attempting to change a role', async () => {
      const response = await request(getApp())
        .patch(`${API}/admin/users/${student.userId}/role`)
        .set(auth(student))
        .send({ role: UserRole.ADMIN });
      expect(response.status).toBe(403);
    });

    it('refuses an administrator removing their own admin role', async () => {
      const response = await request(getApp())
        .patch(`${API}/admin/users/${admin.userId}/role`)
        .set(auth(admin))
        .send({ role: UserRole.STUDENT });
      expect(response.status).toBe(409);
    });

    it('refuses an administrator suspending their own account', async () => {
      const response = await request(getApp())
        .patch(`${API}/admin/users/${admin.userId}/status`)
        .set(auth(admin))
        .send({ status: 'SUSPENDED' });
      expect(response.status).toBe(409);
    });

    it('blocks a suspended account immediately, before its token expires', async () => {
      const victim = await registerUser(UserRole.STUDENT);

      const before = await request(getApp()).get(`${API}/auth/me`).set(auth(victim));
      expect(before.status).toBe(200);

      await request(getApp())
        .patch(`${API}/admin/users/${victim.userId}/status`)
        .set(auth(admin))
        .send({ status: 'SUSPENDED' });

      // The access token is still cryptographically valid, but the account
      // status is re-checked on every request.
      const after = await request(getApp()).get(`${API}/auth/me`).set(auth(victim));
      expect(after.status).toBe(403);
    });
  });

  describe('APIE configuration guards', () => {
    it('rejects weights that do not sum to 1', async () => {
      const response = await request(getApp())
        .put(`${API}/admin/config/apie.weights`)
        .set(auth(admin))
        .send({ value: { resume: 0.5, coding: 0.5, technical: 0.5, hr: 0.1, communication: 0.1, aptitude: 0.1, academic: 0.1 } });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/sum to 1/i);
    });

    it('accepts a valid weight configuration and records an audit entry', async () => {
      const value = { resume: 0.1, coding: 0.3, technical: 0.2, hr: 0.1, communication: 0.1, aptitude: 0.1, academic: 0.1 };

      const response = await request(getApp())
        .put(`${API}/admin/config/apie.weights`)
        .set(auth(admin))
        .send({ value });
      expect(response.status).toBe(200);

      const { AuditLog } = await import('../src/models/AuditLog');
      expect(await AuditLog.findOne({ action: 'admin.config.update', resourceId: 'apie.weights' })).not.toBeNull();

      // Restore the documented defaults so later tests are unaffected.
      await request(getApp())
        .put(`${API}/admin/config/apie.weights`)
        .set(auth(admin))
        .send({ value: { resume: 0.1, coding: 0.25, technical: 0.2, hr: 0.1, communication: 0.15, aptitude: 0.1, academic: 0.1 } });
    });
  });
});
