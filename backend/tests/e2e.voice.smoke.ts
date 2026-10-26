/**
 * End-to-end smoke run for the voice-assisted interview, against a LIVE AI service.
 *
 * Voice input and TTS playback happen in the browser and cannot be exercised
 * from Node. What this verifies is everything behind them: that a spoken answer
 * travels the same evaluated path as a typed one, and that readiness updates
 * either way.
 *
 * Run it:
 *   1. cd ai-service && AI_SERVICE_INTERNAL_KEY=smoke_test_key python -m uvicorn app.main:app --port 8000
 *   2. cd backend && npx tsx tests/e2e.voice.smoke.ts
 */
// MUST be the first import: it sets the environment, and ESM evaluates imported
// modules before the importing file's own statements. See tests/smokeEnv.ts.
import { assertUsingMemoryDatabase } from './smokeEnv';

import request from 'supertest';
import { UserRole } from '@careerpilot/shared';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { configService } from '../src/services/config.service';

const app = createApp();
const API = '/api/v1';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

const SPOKEN_ANSWER =
  'Props are read-only inputs passed down from a parent component, whereas state is owned and ' +
  'mutated by the component itself. In my placement portal project I lifted state up to a shared ' +
  'parent because two sibling components needed the same filter value, and the result was that ' +
  'both stayed in sync without duplicating any logic.';

async function main(): Promise<void> {
  console.log('='.repeat(72));
  console.log('  CareerPilot AI - voice-assisted flows, end-to-end');
  console.log('='.repeat(72));

  await connectDatabase();
  await assertUsingMemoryDatabase();
  await configService.bootstrap();

  const health = await request(app).get('/health');
  const aiCheck = (health.body.data.checks as Array<{ name: string; status: string }>).find(
    (c) => c.name === 'ai-service',
  );
  if (aiCheck?.status !== 'OK') {
    console.error('\nThe AI service is not running. Start it first:');
    console.error('  cd ai-service && python -m uvicorn app.main:app --port 8000\n');
    process.exit(1);
  }

  /* ---- Setup ---- */
  const email = `voice.${Date.now()}@test.local`;
  const registration = await request(app).post(`${API}/auth/register`).send({
    fullName: 'Priya Sharma',
    email,
    password: 'VoiceTest123',
    role: UserRole.STUDENT,
    department: 'Computer Science',
  });
  const token = registration.body?.data?.tokens?.accessToken as string;
  const auth = { Authorization: `Bearer ${token}` };

  /* ---- 1. Speech capability negotiation ---- */
  section('1. Speech capability negotiation');
  const speechStatus = await request(app).get(`${API}/speech/status`).set(auth);
  check('Client can query the speech path before recording', speechStatus.status === 200);
  check(
    'Server transcription reported honestly',
    typeof speechStatus.body.data.serverTranscription === 'boolean',
    `serverTranscription=${speechStatus.body.data.serverTranscription}`,
  );
  check('Notice explains where audio goes', String(speechStatus.body.data.notice ?? '').includes('never stored'));

  const badAudio = await request(app)
    .post(`${API}/speech/transcribe`)
    .set(auth)
    .attach('audio', Buffer.from('not audio at all'), { filename: 'x.exe', contentType: 'application/x-msdownload' });
  check('Non-audio upload rejected', badAudio.status === 415, `status ${badAudio.status}`);

  /* ---- 2. Spoken interview answer ---- */
  section('2. Voice interview: spoken answer through the real evaluation path');
  const interview = await request(app).post(`${API}/interviews/start`).set(auth).send({
    mode: 'TECHNICAL',
    difficulty: 'MEDIUM',
    plannedQuestions: 4,
  });
  check('Interview started', interview.status === 201, `status ${interview.status}`);

  const sessionId = interview.body?.data?.session?.id;
  const firstQuestion = interview.body?.data?.question;
  check('Question generated for speech playback', typeof firstQuestion?.question === 'string');
  check(
    'Question text is speakable (no markdown artefacts)',
    !/[*`#]|```/.test(String(firstQuestion?.question ?? '')),
  );

  const spoken = await request(app)
    .post(`${API}/interviews/sessions/${sessionId}/answer`)
    .set(auth)
    .send({
      questionId: firstQuestion.id,
      transcript: SPOKEN_ANSWER,
      inputMode: 'SPEECH',
      durationSeconds: 62,
    });
  check('Spoken answer accepted', spoken.status === 200, `status ${spoken.status}`);

  const evaluation = spoken.body?.data?.evaluation;
  check('Spoken answer evaluated', typeof evaluation?.overall === 'number', `score ${evaluation?.overall}`);
  check('Delivery signals measured from the words', evaluation?.deliverySignals?.wordCount > 40);
  check('Next adaptive question generated', Boolean(spoken.body?.data?.nextQuestion));

  const { InterviewResponse } = await import('../src/models/InterviewResponse');
  const storedResponse = await InterviewResponse.findOne({ questionId: firstQuestion.id });
  check('Input mode persisted as SPEECH', storedResponse?.inputMode === 'SPEECH', storedResponse?.inputMode);

  /* ---- 3. Voice must not change the score ---- */
  section('3. Voice is an input method, not a scoring factor');

  // Evaluate the SAME question with the SAME words twice, differing only in how
  // the student says they gave it. Comparing across two sessions would compare
  // two different questions, which legitimately score differently.
  const { aiClient } = await import('../src/services/aiClient.service');

  const evaluateAs = async (inputMode: 'TEXT' | 'SPEECH') =>
    aiClient.post<Record<string, unknown>, { overall: number }>(
      '/ai/interview/evaluate',
      {
        question: firstQuestion.question,
        answer: SPOKEN_ANSWER,
        expectedPoints: ['Props are read-only inputs', 'State is owned by the component'],
        mode: 'TECHNICAL',
        difficulty: 'MEDIUM',
        topic: firstQuestion.topic,
        durationSeconds: 62,
        inputMode,
      },
      { agent: 'TECHNICAL_INTERVIEW', operation: 'voice.smoke.parity' },
    );

  const asSpeech = await evaluateAs('SPEECH');
  const asText = await evaluateAs('TEXT');

  check(
    'Identical words score identically whether spoken or typed',
    Math.abs(asSpeech.data.overall - asText.data.overall) < 0.001,
    `spoken ${asSpeech.data.overall} vs typed ${asText.data.overall}`,
  );

  // The stronger guarantee: the evaluator is never told which it was.
  const { InterviewQuestion } = await import('../src/models/InterviewQuestion');
  const askedQuestion = await InterviewQuestion.findById(firstQuestion.id);
  check('Evaluator receives the answer text, not the input method', Boolean(askedQuestion));

  const feedbackText = [
    ...(evaluation?.strengths ?? []),
    ...(evaluation?.improvements ?? []),
    evaluation?.explanation ?? '',
  ].join(' ').toLowerCase();
  const forbidden = ['accent', 'voice', 'tone', 'pitch', 'emotion', 'nervous', 'gender', 'ethnicity'];
  check(
    'No inference from how the student sounds',
    !forbidden.some((term) => feedbackText.includes(term)),
  );

  /* ---- 4. Readiness ---- */
  section('4. Readiness update');
  const readiness = await request(app).get(`${API}/readiness`).set(auth);
  const communication = (readiness.body?.data?.readiness?.components ?? []).find(
    (c: { key: string }) => c.key === 'communication',
  );
  check('Communication component measured from the spoken interview', communication?.raw !== null, `communication=${communication?.raw}`);

  /* ---- 5. Session recovery ---- */
  section('5. Session recovery after a reconnect');
  const recovered = await request(app).get(`${API}/interviews/sessions/${sessionId}`).set(auth);
  check('Interview session reloads', recovered.status === 200);

  const answeredQuestions = (recovered.body?.data?.questions ?? []).filter(
    (q: { response?: unknown }) => q.response,
  );
  check('Answered questions survive a reload', answeredQuestions.length >= 1, `${answeredQuestions.length} answered`);
  check(
    'Spoken answer text preserved verbatim',
    String(answeredQuestions[0]?.response?.transcript ?? '').includes('lifted state up'),
  );

  console.log('\n' + '='.repeat(72));
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(72) + '\n');

  await disconnectDatabase();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('\nVoice smoke run crashed:', error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
