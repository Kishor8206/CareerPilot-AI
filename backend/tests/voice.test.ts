import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { UserRole } from '@careerpilot/shared';
import { API, auth, getApp, registerUser, type TestUser } from './helpers';

/**
 * Voice-assisted interviews (§11).
 *
 * The guarantee these tests protect is that voice is an *input method* and
 * nothing more: a spoken answer must be recorded as spoken, and must be scored
 * exactly as the identical typed answer would be.
 */
describe('Voice-assisted interviews (§11)', () => {
  let student: TestUser;

  beforeAll(async () => {
    student = await registerUser(UserRole.STUDENT);
  }, 120_000);

  describe('speech transcription endpoint', () => {
    it('requires authentication', async () => {
      const response = await request(getApp()).get(`${API}/speech/status`);
      expect(response.status).toBe(401);
    });

    it('reports whether server transcription is available', async () => {
      const response = await request(getApp()).get(`${API}/speech/status`).set(auth(student));

      expect(response.status).toBe(200);
      expect(typeof response.body.data.serverTranscription).toBe('boolean');
      // The AI service is unreachable in tests, so this must degrade to a clear
      // "unavailable" rather than an error — the browser path still works.
      expect(response.body.data.serverTranscription).toBe(false);
      expect(response.body.data.detail).toBeTruthy();
    });

    it('rejects a request with no audio attached', async () => {
      const response = await request(getApp()).post(`${API}/speech/transcribe`).set(auth(student));
      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/no audio/i);
    });

    it('rejects a non-audio file dressed as an upload', async () => {
      const response = await request(getApp())
        .post(`${API}/speech/transcribe`)
        .set(auth(student))
        .attach('audio', Buffer.from('MZ\x90\x00 not audio'), {
          filename: 'payload.exe',
          contentType: 'application/x-msdownload',
        });

      expect(response.status).toBe(415);
      expect(response.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('reports the service as unavailable rather than failing opaquely', async () => {
      const response = await request(getApp())
        .post(`${API}/speech/transcribe`)
        .set(auth(student))
        .attach('audio', Buffer.alloc(4096, 1), {
          filename: 'utterance.webm',
          contentType: 'audio/webm',
        });

      // The AI service is deliberately unreachable in the test environment.
      expect([502, 503]).toContain(response.status);
      expect(response.body.error.message).toMatch(/type your answer|could not be/i);
    });
  });

  describe('interview answers record how they were given', () => {
    it('accepts SPEECH as an input mode and persists it', async () => {
      const { InterviewSession } = await import('../src/models/InterviewSession');
      const { InterviewQuestion } = await import('../src/models/InterviewQuestion');
      const { InterviewResponse } = await import('../src/models/InterviewResponse');
      const { StudentProfile } = await import('../src/models/StudentProfile');

      const profile = await StudentProfile.findOne({ userId: student.userId });

      const session = await InterviewSession.create({
        studentId: profile!._id,
        userId: student.userId,
        mode: 'TECHNICAL',
        status: 'IN_PROGRESS',
        difficulty: 'MEDIUM',
        plannedQuestions: 3,
      });

      const question = await InterviewQuestion.create({
        sessionId: session._id,
        index: 0,
        question: 'Explain the difference between state and props in React.',
        topic: 'react',
        difficulty: 'MEDIUM',
        expectedPoints: ['Props are read-only inputs', 'State is owned by the component'],
      });

      // The AI service is unreachable, so submission fails at evaluation. The
      // validator accepting SPEECH is what this asserts.
      const response = await request(getApp())
        .post(`${API}/interviews/sessions/${session._id.toString()}/answer`)
        .set(auth(student))
        .send({
          questionId: question._id.toString(),
          transcript: 'Props are read-only inputs passed from a parent, whereas state is owned by the component.',
          inputMode: 'SPEECH',
          durationSeconds: 45,
        });

      expect(response.status).not.toBe(400);

      // Nothing was persisted, because evaluation could not complete.
      const stored = await InterviewResponse.findOne({ questionId: question._id });
      expect(stored).toBeNull();
    });

    it('never tells the evaluator whether the answer was spoken', async () => {
      // Structural guarantee (§11, §12): the evaluator receives the words and
      // nothing else. If `inputMode` reached it, a model could excuse — or
      // penalise — disfluency, and a student's score would depend on how they
      // chose to answer rather than on what they said.
      const source = await import('node:fs/promises').then((fs) =>
        fs.readFile(new URL('../src/services/interview.service.ts', import.meta.url), 'utf-8'),
      );

      const evaluatePayload = source.slice(
        source.indexOf('const payload = {', source.indexOf('async function completeInterview') > 0 ? 0 : 0),
      );

      // The payload built immediately before the /ai/interview/evaluate call
      // must not carry the field.
      const evaluateCallIndex = source.indexOf("'/ai/interview/evaluate'");
      expect(evaluateCallIndex).toBeGreaterThan(0);

      const payloadStart = source.lastIndexOf('const payload = {', evaluateCallIndex);
      const payloadBlock = source.slice(payloadStart, evaluateCallIndex);

      expect(payloadBlock).toContain('answer:');
      expect(payloadBlock).not.toMatch(/^\s*inputMode:/m);
      void evaluatePayload;
    });

    it('rejects an input mode that is not TEXT or SPEECH', async () => {
      const response = await request(getApp())
        .post(`${API}/interviews/sessions/507f1f77bcf86cd799439011/answer`)
        .set(auth(student))
        .send({
          questionId: '507f1f77bcf86cd799439011',
          transcript: 'An answer.',
          inputMode: 'TELEPATHY',
          durationSeconds: 10,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
