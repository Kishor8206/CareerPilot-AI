/**
 * End-to-end smoke run against a LIVE AI service.
 *
 * Unlike the unit and integration suites (which point the AI client at a closed
 * port to prove graceful degradation), this exercises the real cross-service
 * path: Node gateway -> FastAPI -> agents -> APIE -> MongoDB.
 *
 * Run it:
 *   1. Start the AI service:
 *        cd ai-service && AI_SERVICE_INTERNAL_KEY=smoke_test_key python -m uvicorn app.main:app --port 8000
 *   2. From backend/:
 *        npx tsx tests/e2e.smoke.ts
 *
 * It is a script rather than a vitest file precisely because it needs an
 * external service running; the automated suites must never depend on that.
 */
// MUST be the first import: it sets the environment, and ESM evaluates imported
// modules before the importing file's own statements. See tests/smokeEnv.ts.
import { assertUsingMemoryDatabase } from './smokeEnv';

import request from 'supertest';
import { UserRole } from '@careerpilot/shared';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { configService } from '../src/services/config.service';
import { runSeed } from '../src/scripts/seed';

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

const SAMPLE_RESUME = `
PRIYA SHARMA
priya.sharma@example.com | +91 98765 43210 | linkedin.com/in/priyasharma | github.com/priyasharma

CAREER OBJECTIVE
Final-year Computer Science student seeking a software engineering role.

EDUCATION
B.Tech in Computer Science and Engineering
Anna University, Chennai
2021 - 2025 | CGPA: 8.6/10

TECHNICAL SKILLS
Languages: Python, Java, JavaScript, C++, SQL
Frameworks: React, Node.js, Express.js, Django, TensorFlow
Databases: MongoDB, MySQL, PostgreSQL
Tools: Git, Docker, Postman
Fundamentals: Data Structures, Algorithms, DBMS, Operating Systems, Computer Networks, OOPS

PROJECTS
Placement Portal - Full Stack Web Application
Technologies: React, Node.js, MongoDB, Express.js
Built a placement management portal used by 400 students, reducing manual coordination time by 60%.

Sentiment Analysis Engine
Technologies: Python, TensorFlow, NLP
Developed an LSTM model achieving 89% accuracy on 50000 product reviews.

INTERNSHIPS
Software Development Intern
Infosys, Chennai
Jun 2024 - Aug 2024
Developed REST APIs in Spring Boot, reducing response time from 800ms to 250ms.

CERTIFICATIONS
AWS Certified Cloud Practitioner - Amazon Web Services, 2024
Machine Learning Specialization - Coursera, 2023

ACHIEVEMENTS
Winner, Smart India Hackathon 2024
Solved 400+ problems on LeetCode
`;

async function main(): Promise<void> {
  console.log('='.repeat(72));
  console.log('  CareerPilot AI - end-to-end smoke run (live AI service)');
  console.log('='.repeat(72));

  await connectDatabase();
  await assertUsingMemoryDatabase();
  await configService.bootstrap();

  /* ---- 0. AI service reachability ---- */
  section('0. Service health');
  const health = await request(app).get('/health');
  check('GET /health responds', health.status === 200 || health.status === 503, `status ${health.status}`);
  const aiCheck = (health.body.data.checks as Array<{ name: string; status: string }>).find((c) => c.name === 'ai-service');
  check('AI service is reachable', aiCheck?.status === 'OK', `reported ${aiCheck?.status}`);

  if (aiCheck?.status !== 'OK') {
    console.error('\nThe AI service is not running. Start it first:');
    console.error('  cd ai-service && python -m uvicorn app.main:app --port 8000\n');
    process.exit(1);
  }

  /* ---- 1. Seed ---- */
  section('1. Seed demo data');
  const summary = await runSeed({});
  check('Companies seeded', summary.companies > 0, `${summary.companies}`);
  check('Job descriptions seeded', summary.jobDescriptions > 0, `${summary.jobDescriptions}`);
  check('Coding problems seeded', summary.codingProblems > 0, `${summary.codingProblems}`);
  check('Assessments seeded', summary.assessments > 0, `${summary.assessments}`);

  /* ---- 2. Register and sign in ---- */
  section('2. Authentication');
  const email = `smoke.${Date.now()}@test.local`;
  const registration = await request(app).post(`${API}/auth/register`).send({
    fullName: 'Priya Sharma',
    email,
    password: 'SmokeTest123',
    role: UserRole.STUDENT,
    department: 'Computer Science',
  });
  check('Student registered', registration.status === 201, `status ${registration.status}`);
  const token = registration.body?.data?.tokens?.accessToken as string;
  const auth = { Authorization: `Bearer ${token}` };
  check('Access token issued', Boolean(token));

  /* ---- 3. Resume upload and analysis ---- */
  section('3. Resume pipeline (live AI)');
  const upload = await request(app)
    .post(`${API}/resumes/upload`)
    .set(auth)
    .attach('resume', Buffer.from(SAMPLE_RESUME), { filename: 'resume.txt', contentType: 'text/plain' });
  check('Resume uploaded', upload.status === 201, `status ${upload.status}`);

  const resumeId = upload.body?.data?.id as string;
  const analysis = await request(app).post(`${API}/resumes/${resumeId}/analyze`).set(auth).send({});
  check('Resume analysed', analysis.status === 200, `status ${analysis.status}`);

  const report = analysis.body?.data?.analysis;
  check('ATS score produced', typeof report?.atsScore === 'number' && report.atsScore > 0, `${report?.atsScore}`);
  check('Name extracted', Boolean(report?.parsed?.name), report?.parsed?.name);
  check('Email extracted', report?.parsed?.email === 'priya.sharma@example.com');
  check('Skills extracted', (report?.parsed?.skills ?? []).length >= 10, `${report?.parsed?.skills?.length} skills`);
  check('CGPA extracted', report?.parsed?.cgpa === 8.6, `${report?.parsed?.cgpa}`);
  check('Projects extracted', (report?.parsed?.projects ?? []).length >= 2, `${report?.parsed?.projects?.length}`);
  check('Score breakdown returned', (report?.breakdown ?? []).length === 9, `${report?.breakdown?.length} criteria`);
  check('Readiness recomputed after analysis', analysis.body?.data?.readiness !== null);

  /* ---- 4. Skills merged into the profile ---- */
  section('4. Profile enrichment');
  const profile = await request(app).get(`${API}/students/me`).set(auth);
  check('Profile readable', profile.status === 200);
  const verifiedSkills = (profile.body?.data?.skills ?? []).filter((s: { verified: boolean }) => s.verified);
  check('Resume skills merged and verified', verifiedSkills.length >= 10, `${verifiedSkills.length} verified`);

  /* ---- 5. Job matching ---- */
  section('5. Job matching (live AI)');
  const jobs = await request(app).get(`${API}/jobs/descriptions`).set(auth).query({ limit: 5 });
  const jobId = jobs.body?.data?.[0]?._id ?? jobs.body?.data?.[0]?.id;
  const match = await request(app).post(`${API}/jobs/match`).set(auth).send({ jobDescriptionId: jobId });
  check('Job match computed', match.status === 200, `status ${match.status}`);
  check('Match score in range', match.body?.data?.matchScore >= 0 && match.body?.data?.matchScore <= 100, `${match.body?.data?.matchScore}`);
  check('Verdict explains the score', typeof match.body?.data?.verdict === 'string' && match.body.data.verdict.length > 20);
  check('Preparation plan produced', Array.isArray(match.body?.data?.preparationPlan));

  /* ---- 6. Assessment ---- */
  section('6. Assessment engine');
  const assessments = await request(app).get(`${API}/assessments`).set(auth);
  const assessmentId = assessments.body?.data?.[0]?.id;
  const start = await request(app).post(`${API}/assessments/${assessmentId}/start`).set(auth).send({ webcamConsent: false });
  check('Attempt started', start.status === 201, `status ${start.status}`);
  check('Server deadline supplied', Boolean(start.body?.data?.expiresAt));
  check('Correct answers withheld', !JSON.stringify(start.body.data.questions).includes('correctAnswer'));

  const attemptId = start.body?.data?.attempt?.id;
  const questions = start.body?.data?.questions ?? [];

  const autosave = await request(app)
    .put(`${API}/assessments/attempts/${attemptId}/autosave`)
    .set(auth)
    .send({ answers: [{ questionId: questions[0].id, answer: 'B', timeSpentSeconds: 20 }] });
  check('Autosave accepted', autosave.status === 200 && autosave.body?.data?.answeredCount === 1);

  const resumeAttempt = await request(app).post(`${API}/assessments/${assessmentId}/start`).set(auth).send({});
  check('In-progress attempt resumed, not duplicated', resumeAttempt.body?.data?.resumed === true);

  const monitoring = await request(app)
    .post(`${API}/assessments/attempts/${attemptId}/monitoring`)
    .set(auth)
    .send({ events: [{ type: 'TAB_HIDDEN' }, { type: 'FULLSCREEN_EXIT' }] });
  check('Monitoring events recorded', monitoring.status === 200 && monitoring.body?.data?.recorded === 2);

  const submit = await request(app)
    .post(`${API}/assessments/attempts/${attemptId}/submit`)
    .set(auth)
    .send({ answers: questions.map((q: { id: string }) => ({ questionId: q.id, answer: 'B' })) });
  check('Assessment submitted and graded', submit.status === 200, `status ${submit.status}`);
  check('Percentage computed', typeof submit.body?.data?.attempt?.percentage === 'number');
  check('Readiness recomputed after submission', submit.body?.data?.readiness !== null);

  /* ---- 7. Interview ---- */
  section('7. AI interview (live AI)');
  const interview = await request(app).post(`${API}/interviews/start`).set(auth).send({
    mode: 'TECHNICAL',
    difficulty: 'MEDIUM',
    plannedQuestions: 3,
  });
  check('Interview started', interview.status === 201, `status ${interview.status}`);
  const sessionId = interview.body?.data?.session?.id;
  const firstQuestion = interview.body?.data?.question;
  check('Question generated', typeof firstQuestion?.question === 'string' && firstQuestion.question.length > 20);

  const answer = await request(app)
    .post(`${API}/interviews/sessions/${sessionId}/answer`)
    .set(auth)
    .send({
      questionId: firstQuestion.id,
      transcript:
        'Props are read-only inputs passed from a parent component, whereas state is owned and mutated by the ' +
        'component itself. For example, in my placement portal project I lifted state up to a shared parent ' +
        'because two sibling components needed the same filter value. The result was that both stayed in sync ' +
        'without duplicating logic, and the data flow stayed unidirectional.',
      inputMode: 'TEXT',
      durationSeconds: 60,
    });
  check('Answer evaluated', answer.status === 200, `status ${answer.status}`);
  const evaluation = answer.body?.data?.evaluation;
  check('Overall score returned', typeof evaluation?.overall === 'number', `${evaluation?.overall}`);
  check('Delivery signals measured', typeof evaluation?.deliverySignals?.wordCount === 'number', `${evaluation?.deliverySignals?.wordCount} words`);
  check('Disclaimer attached', typeof evaluation?.disclaimer === 'string' && evaluation.disclaimer.length > 20);

  const feedbackText = [
    ...(evaluation?.strengths ?? []),
    ...(evaluation?.improvements ?? []),
    evaluation?.explanation ?? '',
  ].join(' ').toLowerCase();
  const forbidden = ['gender', 'race', 'ethnicity', 'accent', 'emotion', 'nervous', 'anxious', 'personality type'];
  check('No demographic or emotional inference in feedback', !forbidden.some((term) => feedbackText.includes(term)));
  check('Next question generated', Boolean(answer.body?.data?.nextQuestion));

  /* ---- 8. APIE readiness ---- */
  section('8. APIE readiness (live AI)');
  const readiness = await request(app).get(`${API}/readiness`).set(auth);
  check('Readiness returned', readiness.status === 200, `status ${readiness.status}`);
  const record = readiness.body?.data?.readiness;
  check('Score in range', record?.score >= 0 && record?.score <= 100, `${record?.score}`);
  check('Band assigned', typeof record?.band === 'string', record?.band);
  check('All 7 components present', (record?.components ?? []).length === 7);

  const withEvidence = (record?.components ?? []).filter((c: { raw: number | null }) => c.raw !== null);
  check('Components with evidence recorded', withEvidence.length >= 3, `${withEvidence.length} of 7 measured`);
  check('Missing evidence shown as null, not zero', (record?.components ?? []).some((c: { raw: number | null }) => c.raw === null));
  check('Prototype disclaimer present', String(record?.modelDisclaimer ?? '').includes('PROTOTYPE'));
  check('Weights snapshot stored', Object.keys(record?.weightsSnapshot ?? {}).length === 7);

  const componentSummary = (record?.components ?? [])
    .map((c: { key: string; raw: number | null }) => `${c.key}=${c.raw === null ? '—' : Math.round(c.raw)}`)
    .join(' ');
  console.log(`     components: ${componentSummary}`);

  /* ---- 9. Reports ---- */
  section('9. PDF reports');
  for (const type of ['RESUME_ANALYSIS', 'PLACEMENT_READINESS']) {
    const pdf = await request(app).get(`${API}/reports/${type}`).set(auth);
    const isPdf = pdf.status === 200 && Buffer.isBuffer(pdf.body) && pdf.body.subarray(0, 5).toString() === '%PDF-';
    check(`${type} PDF generated`, isPdf, isPdf ? `${Math.round(pdf.body.length / 1024)} KB` : `status ${pdf.status}`);
  }

  /* ---- 10. RAG grounding ---- */
  section('10. RAG grounding');
  const { runSeed: _unused, ...rest } = { runSeed };
  void _unused;
  void rest;

  const admin = await (async () => {
    const { User } = await import('../src/models/User');
    const adminEmail = `smoke.admin.${Date.now()}@test.local`;
    await User.create({
      email: adminEmail,
      passwordHash: await User.hashPassword('SmokeTest123'),
      fullName: 'Smoke Admin',
      role: UserRole.ADMIN,
      emailVerified: true,
    });
    const login = await request(app).post(`${API}/auth/login`).send({ email: adminEmail, password: 'SmokeTest123' });
    return { Authorization: `Bearer ${login.body.data.tokens.accessToken}` };
  })();

  const reindex = await request(app).post(`${API}/admin/rag/reindex`).set(admin).send({});
  check('Knowledge base indexed', reindex.status === 200 && reindex.body?.data?.indexed > 0, `${reindex.body?.data?.indexed} documents`);

  const grounded = await request(app).post(`${API}/admin/rag/query`).set(admin).send({
    question: 'What should I prepare for a technical interview at an IT services company?',
  });
  check('Grounded answer returned', grounded.status === 200 && grounded.body?.data?.grounded === true);
  check('Sources cited', (grounded.body?.data?.sources ?? []).length > 0, `${grounded.body?.data?.sources?.length} sources`);

  const unknown = await request(app).post(`${API}/admin/rag/query`).set(admin).send({
    question: 'What is the exact salary band for a quantum cryptography role at a company we have no data about?',
  });
  check(
    'Admits when it has no verified information',
    unknown.body?.data?.insufficientContext === true,
    'refused to speculate',
  );

  /* ---- 11. Analytics ---- */
  section('11. Institutional analytics');
  const analytics = await request(app).get(`${API}/analytics/placement`).set(admin);
  check('Analytics computed', analytics.status === 200, `status ${analytics.status}`);
  check('Totals present', typeof analytics.body?.data?.totals?.students === 'number', `${analytics.body?.data?.totals?.students} students`);
  check('Readiness distribution returned', (analytics.body?.data?.readinessDistribution ?? []).length === 4);

  const research = await request(app).get(`${API}/analytics/research-export`).set(admin).query({ format: 'json' });
  check('Research export produced', research.status === 200, `${research.body?.data?.rows?.length} rows`);
  const firstRow = research.body?.data?.rows?.[0];
  check('Records pseudonymised', firstRow && !('fullName' in firstRow) && typeof firstRow.anonymousId === 'string');
  check('Provenance tagged on every row', (research.body?.data?.rows ?? []).every((r: { provenance?: string }) => Boolean(r.provenance)));

  /* ---- Summary ---- */
  console.log('\n' + '='.repeat(72));
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(72) + '\n');

  await disconnectDatabase();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('\nSmoke run crashed:', error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
