/**
 * DEMO DATA (§40): assessment questions and knowledge-base documents. Coding
 * problems live in dsaProblems.ts. Everything is marked `provenance: 'DEMO'`.
 */

export interface QuestionSeed {
  prompt: string;
  options: Array<{ key: string; text: string }>;
  correctAnswer: string[];
  explanation: string;
  topic: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

export const APTITUDE_QUESTIONS: QuestionSeed[] = [
  {
    prompt: 'A train 150 metres long is running at 90 km/h. How long does it take to pass a stationary pole?',
    options: [{ key: 'A', text: '5 seconds' }, { key: 'B', text: '6 seconds' }, { key: 'C', text: '8 seconds' }, { key: 'D', text: '10 seconds' }],
    correctAnswer: ['B'],
    explanation: '90 km/h = 25 m/s. Time = distance / speed = 150 / 25 = 6 seconds.',
    topic: 'speed-distance-time',
    difficulty: 'EASY',
  },
  {
    prompt: 'If the cost price of 20 articles equals the selling price of 16 articles, what is the profit percentage?',
    options: [{ key: 'A', text: '20%' }, { key: 'B', text: '25%' }, { key: 'C', text: '30%' }, { key: 'D', text: '15%' }],
    correctAnswer: ['B'],
    explanation: 'Let CP of 1 article be 1. CP of 20 = 20 = SP of 16, so SP of 1 = 20/16 = 1.25. Profit = 0.25, which is 25%.',
    topic: 'profit-loss',
    difficulty: 'MEDIUM',
  },
  {
    prompt: 'A can complete a task in 12 days and B in 18 days. Working together, how many days will they take?',
    options: [{ key: 'A', text: '6.5 days' }, { key: 'B', text: '7.2 days' }, { key: 'C', text: '8 days' }, { key: 'D', text: '9 days' }],
    correctAnswer: ['B'],
    explanation: 'Combined rate = 1/12 + 1/18 = 5/36 per day. Time = 36/5 = 7.2 days.',
    topic: 'time-and-work',
    difficulty: 'MEDIUM',
  },
  {
    prompt: 'What is the next number in the series: 3, 7, 15, 31, 63, ?',
    options: [{ key: 'A', text: '95' }, { key: 'B', text: '127' }, { key: 'C', text: '128' }, { key: 'D', text: '124' }],
    correctAnswer: ['B'],
    explanation: 'Each term follows the rule next = 2 * current + 1. So 2 * 63 + 1 = 127.',
    topic: 'number-series',
    difficulty: 'EASY',
  },
  {
    prompt: 'In a class of 60 students, 35 play cricket, 30 play football and 15 play both. How many play neither?',
    options: [{ key: 'A', text: '5' }, { key: 'B', text: '10' }, { key: 'C', text: '15' }, { key: 'D', text: '20' }],
    correctAnswer: ['B'],
    explanation: 'Playing at least one = 35 + 30 - 15 = 50. Neither = 60 - 50 = 10.',
    topic: 'sets-venn-diagrams',
    difficulty: 'MEDIUM',
  },
  {
    prompt: 'The average of five consecutive even numbers is 26. What is the largest of them?',
    options: [{ key: 'A', text: '28' }, { key: 'B', text: '30' }, { key: 'C', text: '32' }, { key: 'D', text: '34' }],
    correctAnswer: ['B'],
    explanation: 'The middle number equals the average, 26. The numbers are 22, 24, 26, 28, 30, so the largest is 30.',
    topic: 'averages',
    difficulty: 'EASY',
  },
  {
    prompt: 'If DELHI is coded as CDKGH, how is MUMBAI coded?',
    options: [{ key: 'A', text: 'LTLAZH' }, { key: 'B', text: 'NVNCBJ' }, { key: 'C', text: 'LTKAZH' }, { key: 'D', text: 'LSLAZH' }],
    correctAnswer: ['A'],
    explanation: 'Each letter moves back by one position. M->L, U->T, M->L, B->A, A->Z, I->H gives LTLAZH.',
    topic: 'coding-decoding',
    difficulty: 'MEDIUM',
  },
  {
    prompt: 'A sum doubles in 8 years at simple interest. In how many years will it become four times?',
    options: [{ key: 'A', text: '16 years' }, { key: 'B', text: '24 years' }, { key: 'C', text: '32 years' }, { key: 'D', text: '12 years' }],
    correctAnswer: ['B'],
    explanation: 'Doubling means interest equals the principal in 8 years. Four times needs interest of 3x the principal, so 3 * 8 = 24 years.',
    topic: 'simple-interest',
    difficulty: 'MEDIUM',
  },
  {
    prompt: 'Which word is the odd one out: Rigid, Firm, Solid, Fluid?',
    options: [{ key: 'A', text: 'Rigid' }, { key: 'B', text: 'Firm' }, { key: 'C', text: 'Solid' }, { key: 'D', text: 'Fluid' }],
    correctAnswer: ['D'],
    explanation: 'Rigid, firm and solid all describe inflexibility. Fluid is the opposite.',
    topic: 'verbal-ability',
    difficulty: 'EASY',
  },
  {
    prompt: 'A shopkeeper marks goods 40% above cost and offers a 25% discount. What is the profit percentage?',
    options: [{ key: 'A', text: '5%' }, { key: 'B', text: '10%' }, { key: 'C', text: '15%' }, { key: 'D', text: '12%' }],
    correctAnswer: ['A'],
    explanation: 'Let CP = 100. Marked price = 140. SP after 25% discount = 105. Profit = 5%.',
    topic: 'profit-loss',
    difficulty: 'HARD',
  },
];

export const TECHNICAL_QUESTIONS: QuestionSeed[] = [
  {
    prompt: 'What is the average-case time complexity of searching for a key in a well-distributed hash table?',
    options: [{ key: 'A', text: 'O(1)' }, { key: 'B', text: 'O(log n)' }, { key: 'C', text: 'O(n)' }, { key: 'D', text: 'O(n log n)' }],
    correctAnswer: ['A'],
    explanation: 'With a good hash function and low load factor, lookup is O(1) on average. The worst case degrades to O(n) when every key collides.',
    topic: 'data-structures',
    difficulty: 'EASY',
  },
  {
    prompt: 'Which normal form eliminates transitive dependencies on the primary key?',
    options: [{ key: 'A', text: 'First Normal Form' }, { key: 'B', text: 'Second Normal Form' }, { key: 'C', text: 'Third Normal Form' }, { key: 'D', text: 'BCNF' }],
    correctAnswer: ['C'],
    explanation: '3NF requires that no non-key attribute depends transitively on the primary key.',
    topic: 'dbms',
    difficulty: 'MEDIUM',
  },
  {
    prompt: 'Which of these is NOT one of the four conditions required for a deadlock?',
    options: [{ key: 'A', text: 'Mutual exclusion' }, { key: 'B', text: 'Hold and wait' }, { key: 'C', text: 'Circular wait' }, { key: 'D', text: 'Priority inversion' }],
    correctAnswer: ['D'],
    explanation: 'The four Coffman conditions are mutual exclusion, hold and wait, no preemption and circular wait. Priority inversion is a separate scheduling problem.',
    topic: 'operating-systems',
    difficulty: 'MEDIUM',
  },
  {
    prompt: 'In OOP, what does method overriding require?',
    options: [
      { key: 'A', text: 'The same method name with different parameters in the same class' },
      { key: 'B', text: 'The same method signature in a subclass' },
      { key: 'C', text: 'A static method in a subclass' },
      { key: 'D', text: 'A private method with the same name' },
    ],
    correctAnswer: ['B'],
    explanation: 'Overriding replaces a superclass method with a subclass implementation of the same signature. Different parameters in one class is overloading.',
    topic: 'oop',
    difficulty: 'EASY',
  },
  {
    prompt: 'Which HTTP status code indicates that the request was understood but the client lacks permission?',
    options: [{ key: 'A', text: '400' }, { key: 'B', text: '401' }, { key: 'C', text: '403' }, { key: 'D', text: '404' }],
    correctAnswer: ['C'],
    explanation: '403 Forbidden means the request was understood and the client is identified, but access is refused. 401 means authentication is missing or invalid.',
    topic: 'computer-networks',
    difficulty: 'EASY',
  },
  {
    prompt: 'What does the ACID property "Isolation" guarantee?',
    options: [
      { key: 'A', text: 'Transactions are permanently stored once committed' },
      { key: 'B', text: 'Concurrent transactions do not interfere with each other' },
      { key: 'C', text: 'A transaction completes entirely or not at all' },
      { key: 'D', text: 'The database moves between valid states' },
    ],
    correctAnswer: ['B'],
    explanation: 'Isolation ensures concurrent transactions produce the same result as if they had run sequentially, preventing dirty and phantom reads.',
    topic: 'dbms',
    difficulty: 'MEDIUM',
  },
  {
    prompt: 'Which data structure gives the best performance for implementing an LRU cache?',
    options: [
      { key: 'A', text: 'Array only' },
      { key: 'B', text: 'Hash map plus doubly linked list' },
      { key: 'C', text: 'Binary search tree' },
      { key: 'D', text: 'Min heap' },
    ],
    correctAnswer: ['B'],
    explanation: 'The hash map gives O(1) lookup and the doubly linked list gives O(1) reordering and eviction, so both operations stay constant time.',
    topic: 'data-structures',
    difficulty: 'HARD',
  },
  {
    prompt: 'In Git, what does `git rebase` do that `git merge` does not?',
    options: [
      { key: 'A', text: 'It combines two branches' },
      { key: 'B', text: 'It rewrites commit history to produce a linear sequence' },
      { key: 'C', text: 'It deletes the source branch' },
      { key: 'D', text: 'It pushes changes to the remote' },
    ],
    correctAnswer: ['B'],
    explanation: 'Rebase replays commits onto a new base, rewriting history. Merge preserves the original history and adds a merge commit.',
    topic: 'version-control',
    difficulty: 'MEDIUM',
  },
];

export interface RagDocumentSeed {
  title: string;
  category: string;
  content: string;
  companyName?: string;
  tags: string[];
  sourceNote: string;
}

/**
 * Knowledge-base documents.
 *
 * Note `sourceNote`: none of these carry a verified external source, so the RAG
 * layer treats them as general preparation guidance rather than authoritative
 * company policy. Nothing here asserts a specific company's hiring criteria.
 */
export const RAG_DOCUMENTS: RagDocumentSeed[] = [
  {
    title: 'Preparing for an IT Services Campus Interview',
    category: 'INTERVIEW_PREP',
    content:
      'Campus interviews at large Indian IT services companies typically follow a consistent structure. The first '
      + 'stage is an online assessment covering quantitative aptitude, logical reasoning and verbal ability, often '
      + 'with a programming or pseudocode section.\n\n'
      + 'The technical interview that follows focuses on fundamentals rather than advanced specialisation. '
      + 'Interviewers commonly ask about data structures, object-oriented programming concepts, database normalisation '
      + 'and SQL queries, and the projects listed on the resume. Be prepared to explain any technology you have '
      + 'listed: claiming a skill you cannot discuss is the most common avoidable failure.\n\n'
      + 'The HR round assesses communication, willingness to relocate, and genuine interest in the organisation. '
      + 'Prepare a specific answer to "why this company" - generic praise is the most frequent reason candidates are '
      + 'filtered at this stage.\n\n'
      + 'Practical preparation advice: revise one CS fundamental subject per week, solve two coding problems per day, '
      + 'and rehearse a two-minute explanation of your strongest project including the problem, your specific '
      + 'contribution and the measurable outcome.',
    tags: ['interview', 'it-services', 'campus-placement'],
    sourceNote: 'General preparation guidance compiled for this platform. Not sourced from any employer publication.',
  },
  {
    title: 'Product Company Technical Interview Expectations',
    category: 'INTERVIEW_PREP',
    content:
      'Product companies weight algorithmic problem solving and system design far more heavily than IT services '
      + 'companies do. The typical loop includes an online assessment with two coding problems, followed by one or '
      + 'more technical interviews conducted live.\n\n'
      + 'In a live coding interview, the process matters as much as the answer. Restate the problem, ask clarifying '
      + 'questions about input size and edge cases, state your approach and its complexity before writing code, then '
      + 'walk through your solution on an example. Interviewers are evaluating how you think under uncertainty.\n\n'
      + 'Core topics to master: arrays and hashing, two pointers, sliding window, binary search, trees and graphs, '
      + 'dynamic programming, and heaps. For system design at graduate level, be able to discuss load balancing, '
      + 'caching, database choice, and the trade-off between consistency and availability.\n\n'
      + 'Behavioural rounds at product companies are structured. Prepare four or five detailed stories using the STAR '
      + 'format - situation, task, action, result - that you can adapt to questions about conflict, failure, '
      + 'initiative and learning.',
    tags: ['interview', 'product-company', 'dsa', 'system-design'],
    sourceNote: 'General preparation guidance compiled for this platform. Not sourced from any employer publication.',
  },
  {
    title: 'Group Discussion Techniques and Assessment Criteria',
    category: 'GD_TOPIC',
    content:
      'A group discussion evaluates content, communication, structure, argument quality, listening and leadership. '
      + 'Evaluators typically sit outside the group and score each participant against these dimensions.\n\n'
      + 'Entering early matters. The first two or three speakers set the framing of the discussion, and silence is '
      + 'scored as a non-performance rather than as neutrality. If you cannot open with a strong point, open by '
      + 'defining the scope of the topic - that is always available and always useful.\n\n'
      + 'Structure each contribution as claim, reason, example. Assertions without reasoning score poorly regardless '
      + 'of how confidently they are delivered. Referencing and building on another participant\'s point demonstrates '
      + 'listening, which is separately scored.\n\n'
      + 'Avoid dominating the discussion, interrupting, or raising your voice. Aggression is consistently penalised. '
      + 'If the discussion fragments, a summarising intervention that pulls the threads together is one of the '
      + 'highest-scoring contributions available.\n\n'
      + 'Common topic areas include technology and ethics, workplace and culture, industry trends, education policy '
      + 'and business strategy.',
    tags: ['group-discussion', 'communication'],
    sourceNote: 'General preparation guidance compiled for this platform.',
  },
  {
    title: 'Resume Writing for Engineering Freshers',
    category: 'CAREER_RESOURCE',
    content:
      'A fresher resume should fit on one page and be readable by an applicant-tracking system. Use a single-column '
      + 'layout: multi-column and table-based designs frequently scramble during automated text extraction, which '
      + 'means a recruiter never sees your content.\n\n'
      + 'Place your name, phone number, email address and LinkedIn or GitHub link as plain text at the top of the '
      + 'document. Details placed inside headers, footers or images are routinely lost during parsing.\n\n'
      + 'Use conventional section headings: Education, Technical Skills, Projects, Internships, Certifications, '
      + 'Achievements. Creative headings defeat automated section detection.\n\n'
      + 'Write project and experience bullets in the form: action verb, what you built, technology used, measurable '
      + 'outcome. "Built a placement portal in React and Node.js used by 400 students, reducing manual coordination '
      + 'time by 60%" is far stronger than "Worked on a web development project".\n\n'
      + 'State your CGPA explicitly, for example "CGPA: 8.4/10". Most campus recruiters apply a hard academic '
      + 'cut-off, and a missing score is frequently treated as a fail rather than as unknown.\n\n'
      + 'Mirror the terminology used in the job description. ATS keyword matching is literal: a posting asking for '
      + '"React.js" may not match a resume that only says "ReactJS", so use the phrasing the employer used.',
    tags: ['resume', 'ats', 'career'],
    sourceNote: 'General preparation guidance compiled for this platform.',
  },
  {
    title: 'HR Interview Question Bank and Strategy',
    category: 'HR_PREP',
    content:
      'HR rounds test motivation, self-awareness, communication and organisational fit. The questions are '
      + 'predictable, which means preparation reliably improves performance.\n\n'
      + '"Tell me about yourself" should be a structured 90-second narrative: your academic background, the '
      + 'experience most relevant to this role, and why that leads you here. It is not a biography.\n\n'
      + '"Why do you want to join us" requires specific, researched reasons. Name something concrete about the '
      + 'organisation\'s work and connect it to your own direction. Generic praise is the most common elimination '
      + 'trigger in this round.\n\n'
      + 'For "your greatest weakness", name a genuine, non-fatal weakness and describe the concrete action you have '
      + 'taken about it and the evidence of progress. The disguised-strength answer is transparent and is scored '
      + 'as evasion.\n\n'
      + 'For behavioural questions, use STAR: describe the situation and task briefly, spend most of your answer on '
      + 'the action you personally took, and finish with a measurable result and what you learned.\n\n'
      + 'Always prepare two questions to ask the interviewer about the role or the team. Having none suggests a lack '
      + 'of genuine interest.',
    tags: ['hr', 'interview', 'behavioral'],
    sourceNote: 'General preparation guidance compiled for this platform.',
  },
  {
    title: 'Common Coding Interview Patterns',
    category: 'CODING_PATTERN',
    content:
      'Most coding interview problems are variations on a small number of recurring patterns. Recognising the '
      + 'pattern is usually more valuable than memorising individual solutions.\n\n'
      + 'Two pointers: use for sorted arrays, palindromes, and pair-sum problems. Reduces many O(n^2) scans to O(n).\n\n'
      + 'Sliding window: use for contiguous subarray or substring problems with a constraint, such as the longest '
      + 'substring without repeating characters.\n\n'
      + 'Hash map: use whenever the question involves counting, deduplication, or looking up a complement. This is '
      + 'the single most frequently useful pattern.\n\n'
      + 'Binary search: applicable beyond sorted arrays. If you can phrase the answer as "the smallest value for '
      + 'which a predicate is true", you can often binary search the answer space.\n\n'
      + 'BFS and DFS: BFS finds shortest paths on unweighted graphs; DFS suits cycle detection, topological sorting '
      + 'and exhaustive exploration.\n\n'
      + 'Dynamic programming: look for optimal substructure and overlapping subproblems. Start with the recursive '
      + 'formulation, add memoisation, then convert to tabulation if space matters.\n\n'
      + 'Heaps: use for "top k" and streaming problems where sorting the entire dataset is wasteful or impossible.',
    tags: ['coding', 'dsa', 'patterns'],
    sourceNote: 'General preparation guidance compiled for this platform.',
  },
  {
    title: 'Data Analyst Role Requirements and Preparation',
    category: 'ROLE_REQUIREMENTS',
    content:
      'A graduate data analyst is expected to be fluent in SQL, comfortable with a spreadsheet tool, and able to '
      + 'communicate findings to a non-technical audience.\n\n'
      + 'SQL is the core screening skill. Be confident with joins and the difference between INNER and LEFT JOIN, '
      + 'GROUP BY with HAVING, window functions such as ROW_NUMBER and RANK, subqueries and common table '
      + 'expressions.\n\n'
      + 'Statistics questions focus on descriptive measures, distributions, correlation versus causation, and basic '
      + 'hypothesis testing. Being able to explain why correlation does not imply causation with a concrete example '
      + 'is asked frequently.\n\n'
      + 'Expect a business case question: given a metric that has dropped, how would you investigate? Structure your '
      + 'answer - segment the metric, check for data quality issues, form hypotheses, and state what data you would '
      + 'need to test each one.\n\n'
      + 'Portfolio work matters. One end-to-end analysis with a clear question, visible methodology and a stated '
      + 'conclusion is worth more than several unfinished dashboards.',
    tags: ['data-analyst', 'sql', 'role'],
    sourceNote: 'General preparation guidance compiled for this platform.',
  },
];
