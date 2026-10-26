/**
 * End-to-end smoke run for the career roadmap feature, against a LIVE AI service.
 *
 *   1. cd ai-service && AI_SERVICE_INTERNAL_KEY=smoke_test_key python -m uvicorn app.main:app --port 8000
 *   2. cd backend && npx tsx tests/e2e.career.smoke.ts
 *
 * Exercises the real path: browser-facing API -> Node gateway -> FastAPI ->
 * skill-gap service -> planner -> resource resolution -> MongoDB.
 */
// MUST be the first import: it sets the environment before config is read. See tests/smokeEnv.ts.
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

const hours = (tasks: string[]) =>
  tasks.reduce((sum, t) => sum + [...t.matchAll(/\(([\d.]+)h\)/g)].reduce((s, m) => s + Number(m[1]), 0), 0);

async function register(role: UserRole, tag: string) {
  const email = `${tag}.${Date.now()}@test.careerpilot.local`;
  const res = await request(app).post(`${API}/auth/register`).send({
    email, password: 'SmokeTest123!', fullName: `Smoke ${tag}`, role, department: 'Computer Science', acceptedPrivacyPolicy: true,
  });
  return { Authorization: `Bearer ${res.body.data?.tokens?.accessToken}` };
}

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(72) + '\n  CareerPilot AI - career roadmap, end-to-end\n' + '='.repeat(72));
  await connectDatabase();
  await assertUsingMemoryDatabase();
  await configService.bootstrap();

  const student = await register(UserRole.STUDENT, 'career');
  const other = await register(UserRole.STUDENT, 'career2');

  console.log('\n1. Access control');
  check('Unauthenticated request refused', (await request(app).get(`${API}/career/catalogue`)).status === 401);
  const alumni = await register(UserRole.ALUMNI, 'careeralumni');
  check('Non-student role refused', [401, 403].includes((await request(app).get(`${API}/career/plan`).set(alumni)).status));

  console.log('\n2. Catalogue');
  const cat = await request(app).get(`${API}/career/catalogue`).set(student);
  check('Catalogue served', cat.status === 200, `status ${cat.status}`);
  check('Roles and skills listed', cat.body.data?.roles?.length >= 20 && cat.body.data?.skills?.length > 100,
    `${cat.body.data?.roles?.length} roles, ${cat.body.data?.skills?.length} skills`);

  console.log('\n3. Generate a plan');
  check('No plan before generating', (await request(app).get(`${API}/career/plan`).set(student)).body.data?.plan === null);
  const body = {
    targetRole: 'full stack developer', hoursPerDay: 2, daysPerWeek: 6, deadlineWeeks: 16, experienceLevel: 'STUDENT',
    skills: [{ skill: 'JS', level: 'intermediate' }, { skill: 'ReactJS', level: 'intermediate' }, { skill: 'SQL', level: 'beginner' }],
  };
  const gen = await request(app).post(`${API}/career/plan`).set(student).send(body);
  const doc = gen.body.data?.plan;
  const plan = doc?.plan;
  check('Plan created', gen.status === 201, `status ${gen.status} ${gen.body.error?.message ?? ''}`);
  check('Role alias resolved', doc?.targetRole === 'Full Stack Developer', doc?.targetRole);
  check('Skill gaps with priorities', plan?.skill_gap?.length > 0 && plan.skill_gap.every((g: any) => ['HIGH', 'MEDIUM', 'LOW'].includes(g.priority)),
    `${plan?.skill_gap?.length} gaps`);
  check('Known skills are not recommended', !plan?.skill_gap?.some((g: any) => ['JavaScript', 'React', 'HTML', 'CSS'].includes(g.skill)));
  check('Phased roadmap', plan?.roadmap?.length >= 2, `${plan?.roadmap?.length} phases`);
  check('Study plan within the deadline', plan?.study_plan?.length > 0 && plan.study_plan.length <= 16, `${plan?.study_plan?.length} weeks`);
  check('No week exceeds 12 hours', plan?.study_plan?.every((w: any) => hours(w.tasks) <= 12.11));
  check('Projects and interview preparation', plan?.projects?.length > 0 && plan?.interview_preparation?.length > 0);
  check('Plan contains resource IDs, never URLs', plan?.resource_ids?.length > 0 && !/https?:\/\//.test(JSON.stringify(plan)));
  check('Resources resolved to verified entries', doc?.resources?.length === plan?.resource_ids?.length
    && doc.resources.every((r: any) => ['verified', 'reachable'].includes(r.verification_status) && /^https:\/\//.test(r.url)),
    `${doc?.resources?.length} resources`);
  check('Daily plan respects 2 hours a day', doc?.dailyPlan?.[0]?.days?.every((d: any) => hours(d.tasks) <= 2.01));
  check('How the plan was produced is recorded', typeof doc?.inference?.provider === 'string', doc?.inference?.provider);

  console.log('\n4. Validation');
  const bad = await request(app).post(`${API}/career/plan`).set(student).send({ ...body, targetRole: 'Dragon Tamer' });
  check('Unknown role rejected with a clear message', bad.status >= 400 && bad.status < 500, `status ${bad.status}`);
  const tooMany = await request(app).post(`${API}/career/plan`).set(student).send({ ...body, hoursPerDay: 40 });
  check('Impossible hours rejected', tooMany.status === 400);

  console.log('\n5. Progress adaptation');
  const first = plan.skill_gap[0].skill;
  const prog = await request(app).post(`${API}/career/progress`).set(student).send({ completedSkills: [first] });
  const next = prog.body.data?.plan;
  check('Progress recorded and plan regenerated', prog.status === 200, `status ${prog.status}`);
  check('Completed skill no longer recommended', !next?.plan?.skill_gap?.some((g: any) => g.skill === first), first);
  check('Readiness increased', next?.readiness?.percent > doc.readiness.percent, `${doc.readiness.percent}% -> ${next?.readiness?.percent}%`);
  const foreign = await request(app).post(`${API}/career/progress`).set(student).send({ completedSkills: ['Underwater Basket Weaving'] });
  check('A skill outside the plan cannot be marked complete', foreign.status === 400);
  const hist = await request(app).get(`${API}/career/history`).set(student);
  check('History keeps both plans', hist.body.data?.history?.length === 2);

  console.log('\n6. Isolation between students');
  check("Another student sees no plan", (await request(app).get(`${API}/career/plan`).set(other)).body.data?.plan === null);

  console.log('\n' + '='.repeat(72) + `\n  RESULT: ${passed} passed, ${failed} failed\n` + '='.repeat(72));
  await disconnectDatabase();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
