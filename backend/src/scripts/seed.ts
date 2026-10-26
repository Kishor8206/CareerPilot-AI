/**
 * Database seeding (§40, §41).
 *
 * Run it:
 *     npm run seed              (from the repository root or backend/)
 *     npm run seed -- --reset   (wipe demo data first)
 *
 * Everything created here is tagged `provenance: 'DEMO'` and every demo account
 * has `isDemoAccount: true`, so demo records can always be distinguished from -
 * and never mixed with - real institutional data (§42).
 */
import { AssessmentType, DataProvenance, Difficulty, SkillCategory, UserRole, VerificationStatus } from '@careerpilot/shared';
import {
  APTITUDE_QUESTIONS,
  COMPANY_SEEDS,
  RAG_DOCUMENTS,
  ROLE_SEEDS,
  TECHNICAL_QUESTIONS,
} from '@careerpilot/database';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import {
  AlumniProfile,
  Assessment,
  AssessmentQuestion,
  CodingProblem,
  Company,
  JobDescription,
  JobRole,
  PlacementOfficer,
  RAGDocument,
  Skill,
  StudentProfile,
  User,
} from '../models';
import { syncDsaProblems } from '../services/coding.service';
import { configService } from '../services/config.service';
import { slugify } from '../utils/helpers';

const log = logger.child({ module: 'seed' });

/** Shared password for every demo account. Development only. */
const DEMO_PASSWORD = 'Demo@Pass123';

interface DemoAccount {
  email: string;
  fullName: string;
  role: UserRole;
  department?: string;
}

const DEMO_ACCOUNTS: Record<string, DemoAccount> = {
  student: { email: 'student@careerpilot.demo', fullName: 'Aarthi Ramesh', role: UserRole.STUDENT, department: 'Computer Science' },
  student2: { email: 'student2@careerpilot.demo', fullName: 'Vikram Iyer', role: UserRole.STUDENT, department: 'Information Technology' },
  alumni: { email: 'alumni@careerpilot.demo', fullName: 'Sneha Krishnan', role: UserRole.ALUMNI, department: 'Computer Science' },
  alumni2: { email: 'alumni2@careerpilot.demo', fullName: 'Rahul Menon', role: UserRole.ALUMNI, department: 'Information Technology' },
  officer: { email: 'officer@careerpilot.demo', fullName: 'Dr. Lakshmi Narayanan', role: UserRole.PLACEMENT_OFFICER },
  admin: { email: 'admin@careerpilot.demo', fullName: 'System Administrator', role: UserRole.ADMIN },
};

const SKILL_CATALOGUE: Array<{ name: string; category: SkillCategory; aliases: string[]; demand: number }> = [
  { name: 'Python', category: SkillCategory.PROGRAMMING_LANGUAGE, aliases: ['python3', 'py'], demand: 95 },
  { name: 'Java', category: SkillCategory.PROGRAMMING_LANGUAGE, aliases: ['core java', 'j2ee'], demand: 90 },
  { name: 'JavaScript', category: SkillCategory.PROGRAMMING_LANGUAGE, aliases: ['js', 'es6'], demand: 92 },
  { name: 'TypeScript', category: SkillCategory.PROGRAMMING_LANGUAGE, aliases: ['ts'], demand: 80 },
  { name: 'C++', category: SkillCategory.PROGRAMMING_LANGUAGE, aliases: ['cpp'], demand: 75 },
  { name: 'SQL', category: SkillCategory.DATABASE, aliases: [], demand: 96 },
  { name: 'React', category: SkillCategory.FRAMEWORK, aliases: ['reactjs', 'react.js'], demand: 88 },
  { name: 'Node.js', category: SkillCategory.FRAMEWORK, aliases: ['nodejs', 'node'], demand: 84 },
  { name: 'Spring Boot', category: SkillCategory.FRAMEWORK, aliases: ['spring'], demand: 78 },
  { name: 'MongoDB', category: SkillCategory.DATABASE, aliases: ['mongo'], demand: 70 },
  { name: 'MySQL', category: SkillCategory.DATABASE, aliases: [], demand: 82 },
  { name: 'Docker', category: SkillCategory.CLOUD, aliases: [], demand: 76 },
  { name: 'AWS', category: SkillCategory.CLOUD, aliases: ['amazon web services'], demand: 85 },
  { name: 'Git', category: SkillCategory.TOOL, aliases: ['github'], demand: 94 },
  { name: 'Data Structures', category: SkillCategory.CS_FUNDAMENTAL, aliases: ['dsa'], demand: 98 },
  { name: 'Algorithms', category: SkillCategory.CS_FUNDAMENTAL, aliases: [], demand: 97 },
  { name: 'DBMS', category: SkillCategory.CS_FUNDAMENTAL, aliases: ['rdbms'], demand: 90 },
  { name: 'Operating Systems', category: SkillCategory.CS_FUNDAMENTAL, aliases: [], demand: 82 },
  { name: 'Computer Networks', category: SkillCategory.CS_FUNDAMENTAL, aliases: ['networking'], demand: 78 },
  { name: 'System Design', category: SkillCategory.CS_FUNDAMENTAL, aliases: ['hld', 'lld'], demand: 86 },
  { name: 'Object Oriented Programming', category: SkillCategory.CS_FUNDAMENTAL, aliases: ['oops', 'oop'], demand: 92 },
  { name: 'Machine Learning', category: SkillCategory.DOMAIN, aliases: ['ml'], demand: 80 },
  { name: 'Data Analysis', category: SkillCategory.DOMAIN, aliases: ['data analytics'], demand: 83 },
  { name: 'Communication', category: SkillCategory.SOFT_SKILL, aliases: [], demand: 99 },
  { name: 'Problem Solving', category: SkillCategory.SOFT_SKILL, aliases: [], demand: 97 },
  { name: 'Teamwork', category: SkillCategory.SOFT_SKILL, aliases: ['collaboration'], demand: 93 },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#]/g, '');
}

async function upsertUser(account: DemoAccount): Promise<InstanceType<typeof User>> {
  const existing = await User.findOne({ email: account.email });
  if (existing) return existing;

  return User.create({
    email: account.email,
    passwordHash: await User.hashPassword(DEMO_PASSWORD),
    fullName: account.fullName,
    role: account.role,
    department: account.department ?? null,
    emailVerified: true,
    isDemoAccount: true,
  });
}

async function seedSkills(): Promise<number> {
  let created = 0;
  for (const skill of SKILL_CATALOGUE) {
    const result = await Skill.updateOne(
      { name: skill.name },
      {
        $setOnInsert: {
          name: skill.name,
          normalized: normalize(skill.name),
          category: skill.category,
          aliases: skill.aliases,
          demandScore: skill.demand,
          active: true,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount) created += 1;
  }
  return created;
}

async function seedCompaniesAndRoles() {
  const companies = new Map<string, InstanceType<typeof Company>>();
  const roles = new Map<string, InstanceType<typeof JobRole>>();

  for (const seed of COMPANY_SEEDS) {
    const company = await Company.findOneAndUpdate(
      { name: seed.name },
      {
        $setOnInsert: {
          name: seed.name,
          slug: slugify(seed.name),
          industry: seed.industry,
          tier: seed.tier,
          website: seed.website,
          headquarters: seed.headquarters,
          description: seed.description,
          recruitmentPattern: seed.recruitmentPattern,
          active: true,
          provenance: DataProvenance.DEMO,
        },
      },
      { upsert: true, new: true },
    );
    companies.set(seed.name, company);
  }

  for (const seed of ROLE_SEEDS) {
    const role = await JobRole.findOneAndUpdate(
      { title: seed.title },
      {
        $setOnInsert: {
          title: seed.title,
          slug: slugify(seed.title),
          family: seed.family,
          description: seed.description,
          coreSkills: seed.coreSkills,
          interviewTopics: seed.interviewTopics,
          active: true,
          provenance: DataProvenance.DEMO,
        },
      },
      { upsert: true, new: true },
    );
    roles.set(seed.title, role);
  }

  return { companies, roles };
}

/**
 * Builds one job description per (company, role) pair that makes sense.
 * Skills are drawn from the role's core skills plus a company-flavoured extra,
 * so matching produces genuinely different results per company.
 */
async function seedJobDescriptions(
  companies: Map<string, InstanceType<typeof Company>>,
  roles: Map<string, InstanceType<typeof JobRole>>,
): Promise<number> {
  const pairings: Array<{ company: string; role: string; extraRequired: string[]; preferred: string[]; packageLpa: number }> = [
    { company: 'TCS', role: 'Software Developer', extraRequired: ['Java', 'SQL'], preferred: ['Spring Boot', 'AWS'], packageLpa: 3.6 },
    { company: 'Infosys', role: 'Software Developer', extraRequired: ['Java', 'DBMS'], preferred: ['React', 'Docker'], packageLpa: 3.6 },
    { company: 'Accenture', role: 'Software Developer', extraRequired: ['JavaScript', 'REST API'], preferred: ['React', 'Node.js'], packageLpa: 4.6 },
    { company: 'Cognizant', role: 'Software Developer', extraRequired: ['Java', 'SQL'], preferred: ['Angular', 'Docker'], packageLpa: 4.0 },
    { company: 'Zoho', role: 'Software Developer', extraRequired: ['C++', 'Data Structures'], preferred: ['Python', 'Linux'], packageLpa: 6.5 },
    { company: 'Amazon', role: 'Software Developer', extraRequired: ['System Design', 'Algorithms'], preferred: ['AWS', 'Java'], packageLpa: 24.0 },
    { company: 'Deloitte', role: 'Business Analyst', extraRequired: ['SQL', 'Excel'], preferred: ['Power BI', 'Agile'], packageLpa: 7.5 },
    { company: 'Accenture', role: 'Data Analyst', extraRequired: ['SQL', 'Python'], preferred: ['Tableau', 'Statistics'], packageLpa: 5.5 },
    { company: 'Amazon', role: 'AI/ML Engineer', extraRequired: ['Machine Learning', 'Python'], preferred: ['PyTorch', 'AWS'], packageLpa: 26.0 },
    { company: 'Deloitte', role: 'HR Analyst', extraRequired: ['Human Resources', 'Excel'], preferred: ['Power BI'], packageLpa: 6.0 },
  ];

  let created = 0;

  for (const pairing of pairings) {
    const company = companies.get(pairing.company);
    const role = roles.get(pairing.role);
    if (!company || !role) continue;

    const title = `${pairing.role} - ${pairing.company}`;
    const exists = await JobDescription.findOne({ companyId: company._id, roleId: role._id });
    if (exists) continue;

    const requiredSkills = [...new Set([...role.coreSkills.slice(0, 5), ...pairing.extraRequired])];

    await JobDescription.create({
      companyId: company._id,
      roleId: role._id,
      title,
      location: company.headquarters?.split(',')[0] ?? 'India',
      experienceLevel: 'Fresher',
      packageLpa: pairing.packageLpa,
      descriptionText:
        `${company.name} is hiring ${pairing.role}s from the current graduating batch.\n\n`
        + `${role.description}\n\n`
        + `You will work with ${requiredSkills.slice(0, 4).join(', ')} in a collaborative team environment, `
        + `contributing to production systems from your first months.\n\n`
        + `Required: ${requiredSkills.join(', ')}.\n`
        + `Preferred: ${pairing.preferred.join(', ')}.\n\n`
        + `Selection follows ${company.recruitmentPattern.rounds.length} rounds: `
        + `${company.recruitmentPattern.rounds.map((r) => r.name).join(', ')}.`,
      requiredSkills,
      preferredSkills: pairing.preferred,
      responsibilities: [
        `Design and build features using ${requiredSkills[0]} and ${requiredSkills[1] ?? 'related tools'}`,
        'Participate in code review and follow the team engineering standards',
        'Write tests and documentation for the work you deliver',
        'Collaborate with product and QA through the delivery cycle',
      ],
      qualifications: [
        'Bachelor degree in Engineering, Computer Applications or a related field',
        `Minimum CGPA of ${company.recruitmentPattern.eligibility?.minCgpa ?? 6.0}`,
        'Strong fundamentals in data structures and problem solving',
        'Good written and verbal communication',
      ],
      atsKeywords: [...new Set([...requiredSkills, ...pairing.preferred])],
      active: true,
      provenance: DataProvenance.DEMO,
    });

    created += 1;
  }

  return created;
}

async function seedCodingProblems(): Promise<number> {
  const { upserted } = await syncDsaProblems();
  return upserted;
}

async function seedAssessments(
  companies: Map<string, InstanceType<typeof Company>>,
): Promise<number> {
  const definitions = [
    {
      title: 'General Aptitude Assessment',
      type: AssessmentType.APTITUDE,
      description: 'Quantitative aptitude, logical reasoning and verbal ability, in the format used by most campus recruiters.',
      durationMinutes: 30,
      difficulty: Difficulty.MEDIUM,
      topics: ['quantitative', 'reasoning', 'verbal'],
      questions: APTITUDE_QUESTIONS,
      requiresFullscreen: true,
    },
    {
      title: 'Technical Fundamentals Assessment',
      type: AssessmentType.TECHNICAL_MCQ,
      description: 'Data structures, DBMS, operating systems, networks and OOP fundamentals.',
      durationMinutes: 25,
      difficulty: Difficulty.MEDIUM,
      topics: ['data-structures', 'dbms', 'operating-systems', 'oop'],
      questions: TECHNICAL_QUESTIONS,
      requiresFullscreen: true,
    },
  ];

  let created = 0;

  for (const definition of definitions) {
    if (await Assessment.findOne({ title: definition.title })) continue;

    const assessment = await Assessment.create({
      title: definition.title,
      type: definition.type,
      description: definition.description,
      durationMinutes: definition.durationMinutes,
      totalQuestions: definition.questions.length,
      passingScore: 40,
      difficulty: definition.difficulty,
      topics: definition.topics,
      requiresFullscreen: definition.requiresFullscreen,
      requiresWebcam: false,
      randomizeQuestions: true,
      maxAttempts: 0,
      active: true,
      provenance: DataProvenance.DEMO,
    });

    await AssessmentQuestion.insertMany(
      definition.questions.map((q) => ({
        assessmentId: assessment._id,
        type: 'MCQ',
        prompt: q.prompt,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        topic: q.topic,
        difficulty: q.difficulty,
        marks: 1,
        negativeMarks: 0,
        active: true,
        provenance: DataProvenance.DEMO,
      })),
    );

    created += 1;
  }

  // A company-specific paper, to demonstrate targeted preparation (§9).
  const zoho = companies.get('Zoho');
  if (zoho && !(await Assessment.findOne({ title: 'Zoho Programming Aptitude' }))) {
    const assessment = await Assessment.create({
      title: 'Zoho Programming Aptitude',
      type: AssessmentType.APTITUDE,
      description: 'Logic and programming-oriented aptitude, reflecting the emphasis of product-company screening.',
      durationMinutes: 20,
      totalQuestions: 6,
      passingScore: 50,
      difficulty: Difficulty.HARD,
      companyId: zoho._id,
      topics: ['logic', 'programming-aptitude'],
      requiresFullscreen: true,
      randomizeQuestions: true,
      active: true,
      provenance: DataProvenance.DEMO,
    });

    await AssessmentQuestion.insertMany(
      [...APTITUDE_QUESTIONS.slice(0, 3), ...TECHNICAL_QUESTIONS.slice(0, 3)].map((q) => ({
        assessmentId: assessment._id,
        type: 'MCQ',
        prompt: q.prompt,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        topic: q.topic,
        difficulty: q.difficulty,
        marks: 1,
        active: true,
        provenance: DataProvenance.DEMO,
      })),
    );

    created += 1;
  }

  return created;
}

async function seedRagDocuments(companies: Map<string, InstanceType<typeof Company>>): Promise<number> {
  let created = 0;

  for (const seed of RAG_DOCUMENTS) {
    if (await RAGDocument.findOne({ title: seed.title })) continue;

    await RAGDocument.create({
      title: seed.title,
      category: seed.category,
      content: seed.content,
      companyId: seed.companyName ? companies.get(seed.companyName)?._id ?? null : null,
      sourceUrls: [],
      sourceNote: seed.sourceNote,
      tags: seed.tags,
      active: true,
      provenance: DataProvenance.DEMO,
    });
    created += 1;
  }

  // One company-profile document per company, from the seeded description.
  for (const [name, company] of companies) {
    const title = `${name} Company Profile`;
    if (await RAGDocument.findOne({ title })) continue;

    const verified = (company.recruitmentPattern?.sources ?? []).length > 0;

    await RAGDocument.create({
      title,
      category: 'COMPANY_PROFILE',
      content:
        `${company.name} operates in ${company.industry} and is headquartered in ${company.headquarters}.\n\n`
        + `${company.description}\n\n`
        + `Recruitment structure used in this demonstration dataset: `
        + `${company.recruitmentPattern.rounds.map((r) => `${r.name} (${r.description ?? ''})`).join('; ')}.\n\n`
        + (verified
          ? ''
          : 'NOTE: This recruitment structure is illustrative demonstration data and has NOT been verified '
            + 'against an official source. Do not rely on it as a statement of this company\'s actual hiring '
            + 'policy - confirm with the official careers page or your placement office.'),
      companyId: company._id,
      sourceUrls: company.website ? [company.website] : [],
      sourceNote: verified ? 'Sourced from official publication.' : 'UNVERIFIED demonstration data.',
      tags: ['company', company.industry.toLowerCase()],
      active: true,
      provenance: DataProvenance.DEMO,
    });
    created += 1;
  }

  return created;
}

async function seedDemoAccounts(
  companies: Map<string, InstanceType<typeof Company>>,
  roles: Map<string, InstanceType<typeof JobRole>>,
) {
  const users: Record<string, InstanceType<typeof User>> = {};
  for (const [key, account] of Object.entries(DEMO_ACCOUNTS)) {
    users[key] = await upsertUser(account);
  }

  /* ---- Students ---- */
  const studentProfiles = [
    {
      user: users.student,
      rollNumber: 'CS21B001',
      department: 'Computer Science',
      degree: 'B.Tech',
      batch: '2021-2025',
      section: 'A',
      graduationYear: 2025,
      cgpa: 8.6,
      headline: 'Final-year CS student | Full-stack & ML',
      summary:
        'Final-year Computer Science student with hands-on experience building full-stack web applications and '
        + 'machine learning models. Seeking a software engineering role.',
      skills: ['Python', 'Java', 'JavaScript', 'React', 'Node.js', 'MongoDB', 'SQL', 'Git', 'Data Structures', 'DBMS', 'Machine Learning'],
      targetCompanies: ['Zoho', 'Amazon'],
      targetRoles: ['Software Developer'],
      projects: [
        { title: 'Placement Portal', description: 'Full-stack portal used by 400 students, reducing coordination time by 60%.', technologies: ['React', 'Node.js', 'MongoDB'] },
        { title: 'Sentiment Analysis Engine', description: 'LSTM model reaching 89% accuracy on 50,000 product reviews.', technologies: ['Python', 'TensorFlow'] },
      ],
      certifications: [
        { name: 'AWS Certified Cloud Practitioner', issuer: 'Amazon Web Services', issuedOn: '2024' },
        { name: 'Machine Learning Specialization', issuer: 'Coursera', issuedOn: '2023' },
      ],
      experience: [
        { company: 'Infosys', role: 'Software Development Intern', type: 'INTERNSHIP' as const, startDate: 'Jun 2024', endDate: 'Aug 2024', description: 'Built REST APIs in Spring Boot; cut query response time from 800ms to 250ms.' },
      ],
    },
    {
      user: users.student2,
      rollNumber: 'IT21B045',
      department: 'Information Technology',
      degree: 'B.Tech',
      batch: '2021-2025',
      section: 'B',
      graduationYear: 2025,
      cgpa: 7.2,
      headline: 'IT student | Data analysis',
      summary: 'Information Technology student focused on data analysis and business intelligence.',
      skills: ['SQL', 'Python', 'Excel', 'Data Analysis', 'Communication'],
      targetCompanies: ['Deloitte', 'Accenture'],
      targetRoles: ['Data Analyst', 'Business Analyst'],
      projects: [
        { title: 'Sales Dashboard', description: 'Interactive dashboard analysing three years of retail sales data.', technologies: ['Power BI', 'SQL'] },
      ],
      certifications: [],
      experience: [],
    },
  ];

  for (const seed of studentProfiles) {
    const existing = await StudentProfile.findOne({ userId: seed.user._id });
    if (existing) continue;

    await StudentProfile.create({
      userId: seed.user._id,
      rollNumber: seed.rollNumber,
      department: seed.department,
      degree: seed.degree,
      batch: seed.batch,
      section: seed.section,
      graduationYear: seed.graduationYear,
      cgpa: seed.cgpa,
      backlogs: 0,
      headline: seed.headline,
      summary: seed.summary,
      skills: seed.skills.map((name) => ({
        name,
        category:
          SKILL_CATALOGUE.find((s) => s.name === name)?.category ?? SkillCategory.PROGRAMMING_LANGUAGE,
        proficiency: 65,
        source: 'SELF' as const,
        verified: false,
      })),
      education: [
        { degree: seed.degree, institution: 'Demo Institute of Technology', fieldOfStudy: seed.department, startYear: 2021, endYear: seed.graduationYear, cgpa: seed.cgpa },
      ],
      projects: seed.projects,
      experience: seed.experience,
      certifications: seed.certifications,
      achievements: [],
      targetCompanies: seed.targetCompanies.map((n) => companies.get(n)?._id).filter(Boolean) as never[],
      targetRoles: seed.targetRoles.map((t) => roles.get(t)?._id).filter(Boolean) as never[],
      targetCompanyNames: seed.targetCompanies,
      targetRoleTitles: seed.targetRoles,
      provenance: DataProvenance.DEMO,
    });
  }

  /* ---- Alumni: one verified, one pending, to demonstrate the gate (§18) ---- */
  const alumniSeeds = [
    {
      user: users.alumni,
      company: 'Amazon',
      designation: 'Software Development Engineer II',
      experienceYears: 5,
      domain: 'Software Engineering',
      expertise: ['System Design', 'Data Structures', 'Algorithms', 'AWS'],
      skills: ['Java', 'Python', 'AWS', 'System Design', 'Data Structures'],
      department: 'Computer Science',
      graduationYear: 2019,
      bio: 'SDE II at Amazon. I mentor students on data structures, system design and interview communication.',
      verificationStatus: VerificationStatus.VERIFIED,
      availability: [
        { dayOfWeek: 6, startTime: '10:00', endTime: '13:00', timezone: 'Asia/Kolkata' },
        { dayOfWeek: 0, startTime: '15:00', endTime: '18:00', timezone: 'Asia/Kolkata' },
      ],
    },
    {
      user: users.alumni2,
      company: 'Deloitte',
      designation: 'Senior Business Analyst',
      experienceYears: 4,
      domain: 'Consulting',
      expertise: ['Business Analysis', 'SQL', 'Data Analysis'],
      skills: ['SQL', 'Excel', 'Power BI', 'Business Analysis'],
      department: 'Information Technology',
      graduationYear: 2020,
      bio: 'Senior Business Analyst at Deloitte, focused on case-interview preparation.',
      // Left PENDING on purpose: unverified alumni must not appear in search.
      verificationStatus: VerificationStatus.PENDING,
      availability: [{ dayOfWeek: 6, startTime: '11:00', endTime: '14:00', timezone: 'Asia/Kolkata' }],
    },
  ];

  for (const seed of alumniSeeds) {
    if (await AlumniProfile.findOne({ userId: seed.user._id })) continue;

    await AlumniProfile.create({
      userId: seed.user._id,
      company: seed.company,
      companyId: companies.get(seed.company)?._id ?? null,
      designation: seed.designation,
      experienceYears: seed.experienceYears,
      domain: seed.domain,
      expertise: seed.expertise,
      skills: seed.skills,
      college: 'Demo Institute of Technology',
      graduationYear: seed.graduationYear,
      department: seed.department,
      bio: seed.bio,
      verificationStatus: seed.verificationStatus,
      verifiedAt: seed.verificationStatus === VerificationStatus.VERIFIED ? new Date() : null,
      verificationNote: seed.verificationStatus === VerificationStatus.VERIFIED ? 'Demo account verified during seeding.' : null,
      availability: seed.availability,
      acceptingMentees: true,
      maxMenteesPerMonth: 5,
      employmentProof: { workEmail: `${seed.user.fullName.split(' ')[0].toLowerCase()}@${seed.company.toLowerCase()}.example`, submittedAt: new Date() },
      provenance: DataProvenance.DEMO,
    });
  }

  /* ---- Placement officer ---- */
  if (!(await PlacementOfficer.findOne({ userId: users.officer._id }))) {
    await PlacementOfficer.create({
      userId: users.officer._id,
      employeeId: 'PO-001',
      designation: 'Head of Placements',
      departments: [],
      institution: 'Demo Institute of Technology',
      canExportData: true,
    });
  }

  return users;
}

async function resetDemoData(): Promise<void> {
  log.warn('Resetting demo data');

  const demoUsers = await User.find({ isDemoAccount: true }).select('_id');
  const userIds = demoUsers.map((u) => u._id);

  const studentProfiles = await StudentProfile.find({ userId: { $in: userIds } }).select('_id');
  const studentIds = studentProfiles.map((p) => p._id);

  const models = await import('../models');

  await Promise.all([
    models.PlacementReadiness.deleteMany({ studentId: { $in: studentIds } }),
    models.SkillGap.deleteMany({ studentId: { $in: studentIds } }),
    models.Recommendation.deleteMany({ studentId: { $in: studentIds } }),
    models.AssessmentAttempt.deleteMany({ studentId: { $in: studentIds } }),
    models.InterviewSession.deleteMany({ studentId: { $in: studentIds } }),
    models.Resume.deleteMany({ studentId: { $in: studentIds } }),
    models.ResumeAnalysis.deleteMany({ studentId: { $in: studentIds } }),
    models.MentorshipRequest.deleteMany({ studentId: { $in: studentIds } }),
    models.MentorshipSession.deleteMany({ studentId: { $in: studentIds } }),
    models.Notification.deleteMany({ userId: { $in: userIds } }),
  ]);

  await Promise.all([
    StudentProfile.deleteMany({ userId: { $in: userIds } }),
    AlumniProfile.deleteMany({ userId: { $in: userIds } }),
    PlacementOfficer.deleteMany({ userId: { $in: userIds } }),
    User.deleteMany({ isDemoAccount: true }),
    Company.deleteMany({ provenance: DataProvenance.DEMO }),
    JobRole.deleteMany({ provenance: DataProvenance.DEMO }),
    JobDescription.deleteMany({ provenance: DataProvenance.DEMO }),
    CodingProblem.deleteMany({ provenance: DataProvenance.DEMO }),
    Assessment.deleteMany({ provenance: DataProvenance.DEMO }),
    AssessmentQuestion.deleteMany({ provenance: DataProvenance.DEMO }),
    RAGDocument.deleteMany({ provenance: DataProvenance.DEMO }),
  ]);
}

export async function runSeed(options: { reset?: boolean } = {}): Promise<Record<string, number>> {
  if (options.reset) await resetDemoData();

  await configService.bootstrap();

  const skills = await seedSkills();
  const { companies, roles } = await seedCompaniesAndRoles();
  const jobDescriptions = await seedJobDescriptions(companies, roles);
  const codingProblems = await seedCodingProblems();
  const assessments = await seedAssessments(companies);
  const ragDocuments = await seedRagDocuments(companies);
  await seedDemoAccounts(companies, roles);

  return {
    skills,
    companies: companies.size,
    roles: roles.size,
    jobDescriptions,
    codingProblems,
    assessments,
    ragDocuments,
    demoAccounts: Object.keys(DEMO_ACCOUNTS).length,
  };
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');

  await connectDatabase();
  const summary = await runSeed({ reset });

  /* eslint-disable no-console */
  console.log('\n' + '='.repeat(70));
  console.log('  CareerPilot AI - DEMO DATA SEEDED');
  console.log('='.repeat(70));
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key.padEnd(20)} ${value}`);
  }
  console.log('\n  Demo accounts (all use the password below):');
  console.log(`  Password: ${DEMO_PASSWORD}\n`);
  for (const account of Object.values(DEMO_ACCOUNTS)) {
    console.log(`    ${account.role.padEnd(20)} ${account.email}`);
  }
  console.log('\n  All records above are tagged provenance=DEMO and isDemoAccount=true.');
  console.log('  They are demonstration data and must never be mixed with real');
  console.log('  institutional records or reported as research results.');
  console.log('\n  Next: run "npm run dev" and sign in as the student account.');
  console.log('='.repeat(70) + '\n');
  /* eslint-enable no-console */

  await disconnectDatabase();
}

if (require.main === module) {
  main().catch((error) => {
    log.error({ err: error }, 'Seeding failed');
    process.exit(1);
  });
}

export { DEMO_ACCOUNTS, DEMO_PASSWORD };
