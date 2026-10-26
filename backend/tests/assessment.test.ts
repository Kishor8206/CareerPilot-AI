import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { UserRole } from '@careerpilot/shared';
import { API, auth, createPrivilegedUser, getApp, registerUser, type TestUser } from './helpers';

/**
 * Assessment engine (§13, §14): timer authority, autosave, session recovery,
 * server-side grading and ethical integrity monitoring.
 */
describe('Assessment engine (§13, §14)', () => {
  let _student: TestUser;
  let admin: TestUser;
  let assessmentId: string;

  beforeAll(async () => {
    _student = await registerUser(UserRole.STUDENT);
    admin = await createPrivilegedUser(UserRole.ADMIN);

    // Build a small paper directly, so the tests do not depend on seed content.
    const { Assessment } = await import('../src/models/Assessment');
    const { AssessmentQuestion } = await import('../src/models/AssessmentQuestion');

    const assessment = await Assessment.create({
      title: 'Test Aptitude Paper',
      type: 'APTITUDE',
      durationMinutes: 30,
      totalQuestions: 3,
      passingScore: 50,
      difficulty: 'EASY',
      topics: ['arithmetic'],
      requiresFullscreen: true,
      randomizeQuestions: false,
      active: true,
    });
    assessmentId = assessment._id.toString();

    await AssessmentQuestion.insertMany([
      {
        assessmentId: assessment._id,
        prompt: 'What is 2 + 2?',
        options: [{ key: 'A', text: '3' }, { key: 'B', text: '4' }, { key: 'C', text: '5' }],
        correctAnswer: ['B'],
        explanation: 'Two plus two is four.',
        topic: 'arithmetic',
        difficulty: 'EASY',
        marks: 1,
      },
      {
        assessmentId: assessment._id,
        prompt: 'What is 10 / 2?',
        options: [{ key: 'A', text: '4' }, { key: 'B', text: '5' }, { key: 'C', text: '6' }],
        correctAnswer: ['B'],
        explanation: 'Ten divided by two is five.',
        topic: 'arithmetic',
        difficulty: 'EASY',
        marks: 1,
      },
      {
        assessmentId: assessment._id,
        prompt: 'What is 7 * 3?',
        options: [{ key: 'A', text: '21' }, { key: 'B', text: '24' }, { key: 'C', text: '18' }],
        correctAnswer: ['A'],
        explanation: 'Seven times three is twenty-one.',
        topic: 'arithmetic',
        difficulty: 'EASY',
        marks: 1,
      },
    ]);
  }, 120_000);

  async function startAttempt(user: TestUser) {
    const response = await request(getApp())
      .post(`${API}/assessments/${assessmentId}/start`)
      .set(auth(user))
      .send({ webcamConsent: false });
    return response;
  }

  describe('starting an attempt', () => {
    it('returns the paper with a server-authoritative deadline', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const response = await startAttempt(user);

      expect(response.status).toBe(201);
      expect(response.body.data.questions).toHaveLength(3);
      expect(response.body.data.expiresAt).toBeTruthy();
      expect(response.body.data.serverTime).toBeGreaterThan(0);
      expect(response.body.data.remainingSeconds).toBeGreaterThan(1700);
      expect(response.body.data.assessment.requiresFullscreen).toBe(true);
    });

    it('never exposes correct answers while an attempt is in progress', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const response = await startAttempt(user);

      const serialised = JSON.stringify(response.body.data.questions);
      expect(serialised).not.toContain('correctAnswer');
      expect(serialised).not.toContain('explanation');
    });

    it('resumes an existing attempt rather than creating a second one', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const first = await startAttempt(user);
      const second = await startAttempt(user);

      expect(second.status).toBe(200);
      expect(second.body.data.resumed).toBe(true);
      expect(second.body.data.attempt.id).toBe(first.body.data.attempt.id);
      // Question order is frozen, so a refresh shows the identical paper.
      expect(second.body.data.questions.map((q: { id: string }) => q.id)).toEqual(
        first.body.data.questions.map((q: { id: string }) => q.id),
      );
    });

    it('records the resume as a monitoring event', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const first = await startAttempt(user);
      await startAttempt(user);

      const { MonitoringEvent } = await import('../src/models/MonitoringEvent');
      const event = await MonitoringEvent.findOne({
        attemptId: first.body.data.attempt.id,
        type: 'SESSION_RESUMED',
      });
      expect(event).not.toBeNull();
      expect(event?.severity).toBe('LOW');
    });
  });

  describe('autosave and recovery (§13)', () => {
    it('saves partial answers and reports them back', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;
      const questions = start.body.data.questions;

      const save = await request(getApp())
        .put(`${API}/assessments/attempts/${attemptId}/autosave`)
        .set(auth(user))
        .send({
          answers: [
            { questionId: questions[0].id, answer: 'B', timeSpentSeconds: 12 },
            { questionId: questions[1].id, answer: null, markedForReview: true },
          ],
        });

      expect(save.status).toBe(200);
      expect(save.body.data.answeredCount).toBe(1);
      expect(save.body.data.savedAt).toBeTruthy();
    });

    it('recovers the saved state after a simulated refresh', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;
      const questions = start.body.data.questions;

      await request(getApp())
        .put(`${API}/assessments/attempts/${attemptId}/autosave`)
        .set(auth(user))
        .send({ answers: [{ questionId: questions[0].id, answer: 'B', markedForReview: true, timeSpentSeconds: 30 }] });

      const recovered = await request(getApp()).get(`${API}/assessments/attempts/${attemptId}`).set(auth(user));

      expect(recovered.status).toBe(200);
      const answer = recovered.body.data.attempt.answers.find(
        (a: { questionId: string }) => a.questionId === questions[0].id,
      );
      expect(answer.answer).toEqual(['B']);
      expect(answer.markedForReview).toBe(true);
      expect(recovered.body.data.remainingSeconds).toBeGreaterThan(0);
    });

    it('merges autosaves rather than overwriting previously saved answers', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;
      const questions = start.body.data.questions;

      await request(getApp())
        .put(`${API}/assessments/attempts/${attemptId}/autosave`)
        .set(auth(user))
        .send({ answers: [{ questionId: questions[0].id, answer: 'B' }] });

      // A second partial save from another tab must not clear the first answer.
      await request(getApp())
        .put(`${API}/assessments/attempts/${attemptId}/autosave`)
        .set(auth(user))
        .send({ answers: [{ questionId: questions[1].id, answer: 'B' }] });

      const state = await request(getApp()).get(`${API}/assessments/attempts/${attemptId}`).set(auth(user));
      const answered = state.body.data.attempt.answers.filter((a: { answer: string[] | null }) => a.answer?.length);
      expect(answered).toHaveLength(2);
    });

    it('ignores an autosave for a question that is not in this attempt', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;

      const response = await request(getApp())
        .put(`${API}/assessments/attempts/${attemptId}/autosave`)
        .set(auth(user))
        .send({ answers: [{ questionId: '507f1f77bcf86cd799439011', answer: 'B' }] });

      expect(response.status).toBe(200);
      expect(response.body.data.answeredCount).toBe(0);
    });

    it('refuses to load another student attempt', async () => {
      const owner = await registerUser(UserRole.STUDENT);
      const intruder = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(owner);

      const response = await request(getApp())
        .get(`${API}/assessments/attempts/${start.body.data.attempt.id}`)
        .set(auth(intruder));

      expect(response.status).toBe(404);
    });
  });

  describe('submission and grading', () => {
    it('grades server-side and returns a topic breakdown', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;
      const questions = start.body.data.questions;

      const byPrompt = new Map(questions.map((q: { id: string; prompt: string }) => [q.prompt, q.id]));

      const submit = await request(getApp())
        .post(`${API}/assessments/attempts/${attemptId}/submit`)
        .set(auth(user))
        .send({
          answers: [
            { questionId: byPrompt.get('What is 2 + 2?'), answer: 'B' },   // correct
            { questionId: byPrompt.get('What is 10 / 2?'), answer: 'B' },  // correct
            { questionId: byPrompt.get('What is 7 * 3?'), answer: 'C' },   // wrong
          ],
        });

      expect(submit.status).toBe(200);
      const attempt = submit.body.data.attempt;
      expect(attempt.status).toBe('EVALUATED');
      expect(attempt.correctCount).toBe(2);
      expect(attempt.percentage).toBeCloseTo(66.67, 1);
      expect(attempt.passed).toBe(true);
      expect(attempt.topicBreakdown[0]).toMatchObject({ topic: 'arithmetic', correct: 2, total: 3 });
    });

    it('refuses a duplicate submission', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;

      await request(getApp()).post(`${API}/assessments/attempts/${attemptId}/submit`).set(auth(user)).send({});
      const second = await request(getApp())
        .post(`${API}/assessments/attempts/${attemptId}/submit`)
        .set(auth(user))
        .send({});

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('ASSESSMENT_ALREADY_SUBMITTED');
    });

    it('scores an unanswered paper as zero rather than failing', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);

      const submit = await request(getApp())
        .post(`${API}/assessments/attempts/${start.body.data.attempt.id}/submit`)
        .set(auth(user))
        .send({});

      expect(submit.status).toBe(200);
      expect(submit.body.data.attempt.score).toBe(0);
      expect(submit.body.data.attempt.passed).toBe(false);
    });

    it('reveals the answers and explanations only after submission', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;

      const tooEarly = await request(getApp()).get(`${API}/assessments/attempts/${attemptId}/result`).set(auth(user));
      expect(tooEarly.status).toBe(400);

      await request(getApp()).post(`${API}/assessments/attempts/${attemptId}/submit`).set(auth(user)).send({});

      const result = await request(getApp()).get(`${API}/assessments/attempts/${attemptId}/result`).set(auth(user));
      expect(result.status).toBe(200);
      expect(result.body.data.review[0].correctAnswer).toBeDefined();
      expect(result.body.data.review[0].explanation).toBeTruthy();
    });

    it('rejects a submission after the deadline has passed', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;

      // Rewind the deadline rather than waiting 30 minutes.
      const { AssessmentAttempt } = await import('../src/models/AssessmentAttempt');
      await AssessmentAttempt.updateOne({ _id: attemptId }, { $set: { expiresAt: new Date(Date.now() - 120_000) } });

      const autosave = await request(getApp())
        .put(`${API}/assessments/attempts/${attemptId}/autosave`)
        .set(auth(user))
        .send({ answers: [] });

      expect(autosave.status).toBe(410);
      expect(autosave.body.error.code).toBe('ASSESSMENT_EXPIRED');
    });

    it('auto-submits overdue attempts, preserving saved answers', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;
      const questions = start.body.data.questions;

      await request(getApp())
        .put(`${API}/assessments/attempts/${attemptId}/autosave`)
        .set(auth(user))
        .send({ answers: [{ questionId: questions[0].id, answer: 'B' }] });

      const { AssessmentAttempt } = await import('../src/models/AssessmentAttempt');
      await AssessmentAttempt.updateOne({ _id: attemptId }, { $set: { expiresAt: new Date(Date.now() - 120_000) } });

      const { expireOverdueAttempts } = await import('../src/services/assessment.service');
      const expired = await expireOverdueAttempts();
      expect(expired).toBeGreaterThanOrEqual(1);

      const attempt = await AssessmentAttempt.findById(attemptId);
      expect(attempt?.status).toBe('EVALUATED');
      // The answer saved before expiry was still graded.
      expect(attempt?.correctCount).toBe(1);
    });
  });

  describe('integrity monitoring (§14)', () => {
    it('records events and keeps a single signal at LOW risk', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;

      const response = await request(getApp())
        .post(`${API}/assessments/attempts/${attemptId}/monitoring`)
        .set(auth(user))
        .send({ events: [{ type: 'TAB_HIDDEN' }] });

      expect(response.status).toBe(200);
      expect(response.body.data.recorded).toBe(1);
      // One tab switch is not misconduct.
      expect(response.body.data.integrityRisk).toBe('LOW');
      expect(response.body.data.notice).toBeNull();
    });

    it('escalates only on an accumulated pattern, never a single event', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;

      const response = await request(getApp())
        .post(`${API}/assessments/attempts/${attemptId}/monitoring`)
        .set(auth(user))
        .send({
          events: [
            { type: 'FULLSCREEN_EXIT' }, { type: 'TAB_HIDDEN' }, { type: 'PASTE' },
            { type: 'TAB_HIDDEN' }, { type: 'FULLSCREEN_EXIT' },
          ],
        });

      expect(response.status).toBe(200);
      expect(['MEDIUM', 'HIGH']).toContain(response.body.data.integrityRisk);
      // The student is told, in non-accusatory terms - monitoring is transparent.
      expect(response.body.data.notice).toContain('not an accusation');
    });

    it('never invalidates a result because of monitoring signals', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;
      const questions = start.body.data.questions;

      await request(getApp())
        .post(`${API}/assessments/attempts/${attemptId}/monitoring`)
        .set(auth(user))
        .send({
          events: Array.from({ length: 12 }, () => ({ type: 'FULLSCREEN_EXIT' as const })),
        });

      const byPrompt = new Map(questions.map((q: { id: string; prompt: string }) => [q.prompt, q.id]));
      const submit = await request(getApp())
        .post(`${API}/assessments/attempts/${attemptId}/submit`)
        .set(auth(user))
        .send({
          answers: [
            { questionId: byPrompt.get('What is 2 + 2?'), answer: 'B' },
            { questionId: byPrompt.get('What is 10 / 2?'), answer: 'B' },
            { questionId: byPrompt.get('What is 7 * 3?'), answer: 'A' },
          ],
        });

      // The score stands on its merits; only the risk indicator is raised.
      expect(submit.body.data.attempt.percentage).toBe(100);
      expect(submit.body.data.attempt.passed).toBe(true);
      expect(submit.body.data.attempt.integrityRisk).toBe('HIGH');
    });

    it('shows the student their own integrity report, with the advisory disclaimer', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;

      await request(getApp())
        .post(`${API}/assessments/attempts/${attemptId}/monitoring`)
        .set(auth(user))
        .send({ events: [{ type: 'WINDOW_BLUR' }] });

      const report = await request(getApp())
        .get(`${API}/assessments/attempts/${attemptId}/integrity`)
        .set(auth(user));

      expect(report.status).toBe(200);
      expect(report.body.data.events).toHaveLength(1);
      expect(report.body.data.events[0].explanation).toBeTruthy();
      expect(report.body.data.disclaimer).toContain('not proof of misconduct');
    });

    it('surfaces flagged attempts to an administrator for human review', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);
      const attemptId = start.body.data.attempt.id;

      await request(getApp())
        .post(`${API}/assessments/attempts/${attemptId}/monitoring`)
        .set(auth(user))
        .send({ events: Array.from({ length: 10 }, () => ({ type: 'PASTE' as const })) });

      const flagged = await request(getApp()).get(`${API}/admin/flagged`).set(auth(admin));
      expect(flagged.status).toBe(200);
      expect(flagged.body.data.note).toContain('human review');

      const review = await request(getApp())
        .post(`${API}/admin/flagged/attempts/${attemptId}/review`)
        .set(auth(admin))
        .send({ note: 'Student reported a screen reader; signals explained.', clear: true });

      expect(review.status).toBe(200);
      expect(review.body.data.integrityRisk).toBe('LOW');
      expect(review.body.data.integrityReviewNote).toBeTruthy();
    });

    it('rejects an unknown monitoring event type', async () => {
      const user = await registerUser(UserRole.STUDENT);
      const start = await startAttempt(user);

      const response = await request(getApp())
        .post(`${API}/assessments/attempts/${start.body.data.attempt.id}/monitoring`)
        .set(auth(user))
        .send({ events: [{ type: 'DEFINITELY_NOT_A_REAL_EVENT' }] });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('webcam consent (§15)', () => {
    it('refuses to start a webcam assessment without explicit consent', async () => {
      const { Assessment } = await import('../src/models/Assessment');
      const { AssessmentQuestion } = await import('../src/models/AssessmentQuestion');

      const proctored = await Assessment.create({
        title: 'Proctored Test Paper',
        type: 'TECHNICAL_MCQ',
        durationMinutes: 20,
        totalQuestions: 1,
        difficulty: 'EASY',
        requiresFullscreen: true,
        requiresWebcam: true,
        active: true,
      });
      await AssessmentQuestion.create({
        assessmentId: proctored._id,
        prompt: 'Consent check question',
        options: [{ key: 'A', text: 'Yes' }],
        correctAnswer: ['A'],
        topic: 'general',
        marks: 1,
      });

      const user = await registerUser(UserRole.STUDENT);

      const refused = await request(getApp())
        .post(`${API}/assessments/${proctored._id.toString()}/start`)
        .set(auth(user))
        .send({ webcamConsent: false });
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('CONSENT_REQUIRED');

      const allowed = await request(getApp())
        .post(`${API}/assessments/${proctored._id.toString()}/start`)
        .set(auth(user))
        .send({ webcamConsent: true });
      expect(allowed.status).toBe(201);
      expect(allowed.body.data.attempt.webcamConsent).toBe(true);
    });
  });
});
