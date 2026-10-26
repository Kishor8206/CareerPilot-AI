import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { UserRole } from '@careerpilot/shared';
import { API, auth, createPrivilegedUser, getApp, registerUser, type TestUser } from './helpers';

/**
 * Comparing a resume against the student's own job description.
 *
 * The AI service is unreachable in this suite by design, so these tests cover
 * what the gateway itself decides: which inputs are accepted, and who may call.
 * The analysis result for a custom job description is covered by the AI
 * service's own tests and the live end-to-end check.
 */
const app = getApp();
const RESUME_TEXT = `Priya Sharma\npriya@example.com\nEDUCATION\nB.E. Computer Science\nSKILLS\nPython, SQL, Git\nPROJECTS\n${'Built a placement portal with Python and SQL. '.repeat(6)}`;
const JD_TEXT = 'We are hiring a Backend Developer. Required skills: Python, Django, PostgreSQL, Docker and Git. Preferred: AWS.';

describe('Resume analysis against a custom job description', () => {
  let student: TestUser;
  let admin: TestUser;
  let resumeId: string;

  beforeAll(async () => {
    student = await registerUser(UserRole.STUDENT);
    admin = await createPrivilegedUser(UserRole.ADMIN);
    const upload = await request(app)
      .post(`${API}/resumes/upload`)
      .set(auth(student))
      .attach('resume', Buffer.from(RESUME_TEXT), { filename: 'resume.txt', contentType: 'text/plain' });
    expect(upload.status).toBe(201);
    resumeId = upload.body.data.id ?? upload.body.data._id;
  });

  it('lists resumes with the id used to analyse, download and delete them', async () => {
    const res = await request(app).get(`${API}/resumes`).set(auth(student));
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(resumeId);
  });

  const analyze = (body: Record<string, unknown>) =>
    request(app).post(`${API}/resumes/${resumeId}/analyze`).set(auth(student)).send(body);

  it('rejects a job description too short to compare against', async () => {
    const res = await analyze({ jobDescriptionText: 'Python developer' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('too short');
  });

  it('rejects an over-long job description', async () => {
    const res = await analyze({ jobDescriptionText: 'x'.repeat(20_001) });
    expect(res.status).toBe(400);
  });

  it('rejects a predefined and a custom job description together', async () => {
    const res = await analyze({ jobDescriptionId: '64b7f0c2a1b2c3d4e5f60718', jobDescriptionText: JD_TEXT });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('not both');
  });

  it('accepts a valid custom job description (and then needs the AI service)', async () => {
    const res = await analyze({ jobDescriptionText: JD_TEXT, jobDescriptionLabel: 'Backend Developer at Acme' });
    // Validation passed; the only failure left is the unreachable AI service.
    expect(res.status).not.toBe(400);
    expect([502, 503]).toContain(res.status);
  });

  describe('job description file upload', () => {
    const extract = (user: TestUser | null, name: string, type: string, content: string) => {
      const req = request(app).post(`${API}/resumes/jd/extract`);
      if (user) req.set(auth(user));
      return req.attach('jd', Buffer.from(content), { filename: name, contentType: type });
    };

    it('accepts only document types', async () => {
      const res = await extract(student, 'jd.exe', 'application/x-msdownload', 'MZ');
      expect(res.status).toBe(415);
    });

    it('requires a file', async () => {
      const res = await request(app).post(`${API}/resumes/jd/extract`).set(auth(student));
      expect(res.status).toBe(400);
    });

    it('is closed to anonymous users and non-students', async () => {
      expect((await extract(null, 'jd.txt', 'text/plain', JD_TEXT)).status).toBe(401);
      expect((await extract(admin, 'jd.txt', 'text/plain', JD_TEXT)).status).toBe(403);
    });

    it('passes a valid file on to the extractor', async () => {
      const res = await extract(student, 'jd.txt', 'text/plain', JD_TEXT);
      expect([502, 503]).toContain(res.status);
    });
  });
});
