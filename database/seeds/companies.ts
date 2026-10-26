/**
 * DEMO DATA (§40).
 *
 * Every record here is marked `provenance: 'DEMO'`.
 *
 * IMPORTANT: the recruitment patterns below are illustrative structures for
 * demonstrating the platform. Where `sources` is empty, the information is NOT
 * verified and the application will not present it as fact - the UI labels it
 * as unverified, and the RAG layer refuses to cite it. Replace these with
 * sourced, officially published information before any real deployment.
 */

export interface CompanySeed {
  name: string;
  industry: string;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3' | 'PRODUCT' | 'SERVICE' | 'STARTUP';
  website: string;
  headquarters: string;
  description: string;
  recruitmentPattern: {
    rounds: Array<{ name: string; description?: string; durationMinutes?: number }>;
    eligibility?: { minCgpa?: number; maxBacklogs?: number; allowedDepartments?: string[] };
    averagePackageLpa?: number;
    hiringSeason?: string;
    sources: string[];
  };
}

export const COMPANY_SEEDS: CompanySeed[] = [
  {
    name: 'TCS',
    industry: 'IT Services',
    tier: 'SERVICE',
    website: 'https://www.tcs.com',
    headquarters: 'Mumbai, India',
    description:
      'Tata Consultancy Services is a large Indian multinational IT services and consulting company. It is one of the '
      + 'highest-volume campus recruiters in India, hiring across engineering disciplines for software engineering, '
      + 'support and consulting roles.',
    recruitmentPattern: {
      rounds: [
        { name: 'National Qualifier Test', description: 'Online test covering numerical ability, verbal ability and reasoning.', durationMinutes: 180 },
        { name: 'Technical Interview', description: 'Fundamentals, projects and programming.', durationMinutes: 45 },
        { name: 'Managerial Round', description: 'Situational judgement and role fit.', durationMinutes: 30 },
        { name: 'HR Interview', description: 'Motivation, relocation and joining logistics.', durationMinutes: 20 },
      ],
      eligibility: { minCgpa: 6.0, maxBacklogs: 1, allowedDepartments: [] },
      averagePackageLpa: 3.6,
      hiringSeason: 'Aug - Dec',
      sources: [],
    },
  },
  {
    name: 'Infosys',
    industry: 'IT Services',
    tier: 'SERVICE',
    website: 'https://www.infosys.com',
    headquarters: 'Bengaluru, India',
    description:
      'Infosys is an Indian multinational providing business consulting, information technology and outsourcing '
      + 'services. Campus hiring runs through structured assessment and interview stages for engineering and '
      + 'analytics roles.',
    recruitmentPattern: {
      rounds: [
        { name: 'Online Assessment', description: 'Quantitative aptitude, reasoning, verbal ability and pseudocode.', durationMinutes: 150 },
        { name: 'Technical Interview', description: 'Programming fundamentals, DBMS and projects.', durationMinutes: 45 },
        { name: 'HR Interview', description: 'Communication and organisational fit.', durationMinutes: 25 },
      ],
      eligibility: { minCgpa: 6.0, maxBacklogs: 0, allowedDepartments: [] },
      averagePackageLpa: 3.6,
      hiringSeason: 'Sep - Jan',
      sources: [],
    },
  },
  {
    name: 'Accenture',
    industry: 'Consulting & Technology',
    tier: 'SERVICE',
    website: 'https://www.accenture.com',
    headquarters: 'Dublin, Ireland',
    description:
      'Accenture is a global professional services company with capabilities in digital, cloud and security. It '
      + 'recruits graduates into application development, technology consulting and business analysis roles.',
    recruitmentPattern: {
      rounds: [
        { name: 'Cognitive & Technical Assessment', description: 'Aptitude, verbal, and technical MCQs.', durationMinutes: 90 },
        { name: 'Coding Assessment', description: 'Two programming problems.', durationMinutes: 45 },
        { name: 'Communication Assessment', description: 'Spoken English evaluation.', durationMinutes: 20 },
        { name: 'Technical & HR Interview', description: 'Combined technical and fit discussion.', durationMinutes: 40 },
      ],
      eligibility: { minCgpa: 6.5, maxBacklogs: 0, allowedDepartments: [] },
      averagePackageLpa: 4.6,
      hiringSeason: 'Jul - Nov',
      sources: [],
    },
  },
  {
    name: 'Cognizant',
    industry: 'IT Services',
    tier: 'SERVICE',
    website: 'https://www.cognizant.com',
    headquarters: 'Teaneck, New Jersey, USA',
    description:
      'Cognizant is a multinational IT services and consulting company. Graduate hiring covers programmer analyst '
      + 'and digital engineering tracks.',
    recruitmentPattern: {
      rounds: [
        { name: 'Aptitude Assessment', description: 'Quantitative, logical and verbal reasoning.', durationMinutes: 90 },
        { name: 'Automata Coding Round', description: 'Programming problems with automated evaluation.', durationMinutes: 60 },
        { name: 'Technical Interview', description: 'Data structures, DBMS and project discussion.', durationMinutes: 40 },
        { name: 'HR Interview', description: 'Fit, flexibility and communication.', durationMinutes: 20 },
      ],
      eligibility: { minCgpa: 6.0, maxBacklogs: 0, allowedDepartments: [] },
      averagePackageLpa: 4.0,
      hiringSeason: 'Aug - Dec',
      sources: [],
    },
  },
  {
    name: 'Zoho',
    industry: 'Software Products',
    tier: 'PRODUCT',
    website: 'https://www.zoho.com',
    headquarters: 'Chennai, India',
    description:
      'Zoho Corporation builds a broad suite of cloud-based business software. Its hiring is known for emphasising '
      + 'programming ability and problem solving over academic percentage alone.',
    recruitmentPattern: {
      rounds: [
        { name: 'Aptitude & Basic Programming', description: 'Written test covering logic and programming basics.', durationMinutes: 90 },
        { name: 'Advanced Programming Round', description: 'Problem solving, often written on paper.', durationMinutes: 120 },
        { name: 'Technical Interview', description: 'Deep discussion of the submitted solutions.', durationMinutes: 60 },
        { name: 'HR Interview', description: 'Motivation and long-term interest.', durationMinutes: 25 },
      ],
      eligibility: { minCgpa: 6.0, maxBacklogs: 2, allowedDepartments: [] },
      averagePackageLpa: 6.5,
      hiringSeason: 'Sep - Feb',
      sources: [],
    },
  },
  {
    name: 'Deloitte',
    industry: 'Consulting & Audit',
    tier: 'TIER_1',
    website: 'https://www.deloitte.com',
    headquarters: 'London, United Kingdom',
    description:
      'Deloitte provides audit, consulting, financial advisory, risk advisory and tax services. Graduate hiring '
      + 'covers technology consulting, business analysis and risk advisory tracks.',
    recruitmentPattern: {
      rounds: [
        { name: 'Online Assessment', description: 'Aptitude and situational judgement.', durationMinutes: 75 },
        { name: 'Group Discussion', description: 'Case-based discussion in small groups.', durationMinutes: 30 },
        { name: 'Technical / Case Interview', description: 'Domain knowledge and structured problem solving.', durationMinutes: 45 },
        { name: 'Partner / HR Interview', description: 'Fit, values and career direction.', durationMinutes: 30 },
      ],
      eligibility: { minCgpa: 7.0, maxBacklogs: 0, allowedDepartments: [] },
      averagePackageLpa: 7.5,
      hiringSeason: 'Jul - Oct',
      sources: [],
    },
  },
  {
    name: 'Amazon',
    industry: 'E-commerce & Cloud',
    tier: 'PRODUCT',
    website: 'https://www.amazon.jobs',
    headquarters: 'Seattle, Washington, USA',
    description:
      'Amazon is a multinational technology company focused on e-commerce, cloud computing and digital streaming. '
      + 'Graduate software roles emphasise data structures, algorithms and system design, alongside its published '
      + 'leadership principles.',
    recruitmentPattern: {
      rounds: [
        { name: 'Online Assessment', description: 'Two coding problems plus a work-style survey.', durationMinutes: 105 },
        { name: 'Technical Interview 1', description: 'Data structures and algorithms.', durationMinutes: 60 },
        { name: 'Technical Interview 2', description: 'Problem solving and low-level design.', durationMinutes: 60 },
        { name: 'Bar Raiser', description: 'Behavioural interview against the leadership principles.', durationMinutes: 60 },
      ],
      eligibility: { minCgpa: 7.0, maxBacklogs: 0, allowedDepartments: [] },
      averagePackageLpa: 24.0,
      hiringSeason: 'Aug - Dec',
      sources: [],
    },
  },
];

export interface RoleSeed {
  title: string;
  family: string;
  description: string;
  coreSkills: string[];
  interviewTopics: string[];
}

export const ROLE_SEEDS: RoleSeed[] = [
  {
    title: 'Software Developer',
    family: 'Engineering',
    description:
      'Designs, builds and maintains software applications. Works across the stack or specialises in frontend, '
      + 'backend or platform engineering.',
    coreSkills: [
      'Data Structures', 'Algorithms', 'Object Oriented Programming', 'SQL', 'Git',
      'REST API', 'DBMS', 'Operating Systems', 'System Design',
    ],
    interviewTopics: ['dsa', 'oop', 'dbms', 'os', 'system-design'],
  },
  {
    title: 'Data Analyst',
    family: 'Data',
    description:
      'Collects, cleans and interprets data to answer business questions, and communicates findings through '
      + 'dashboards and reports.',
    coreSkills: ['SQL', 'Excel', 'Python', 'Statistics', 'Data Visualization', 'Data Analysis', 'Power BI'],
    interviewTopics: ['sql', 'statistics', 'data-analysis', 'business-case'],
  },
  {
    title: 'Business Analyst',
    family: 'Business',
    description:
      'Bridges business stakeholders and technical teams: gathers requirements, models processes and defines '
      + 'acceptance criteria.',
    coreSkills: ['Business Analysis', 'SQL', 'Excel', 'Communication', 'Agile', 'Data Analysis', 'Problem Solving'],
    interviewTopics: ['business-case', 'requirements', 'sql', 'communication'],
  },
  {
    title: 'AI/ML Engineer',
    family: 'Data',
    description:
      'Builds, trains and deploys machine learning models, and takes them from experiment to production system.',
    coreSkills: [
      'Python', 'Machine Learning', 'Deep Learning', 'scikit-learn', 'TensorFlow',
      'Pandas', 'NumPy', 'Statistics', 'Data Analysis', 'SQL',
    ],
    interviewTopics: ['machine-learning', 'python', 'statistics', 'dsa', 'system-design'],
  },
  {
    title: 'HR Analyst',
    family: 'Human Resources',
    description:
      'Applies data analysis to workforce planning, recruitment effectiveness, retention and employee engagement.',
    coreSkills: ['Human Resources', 'Excel', 'Data Analysis', 'Communication', 'Statistics', 'SQL'],
    interviewTopics: ['hr', 'data-analysis', 'communication', 'behavioral'],
  },
];
