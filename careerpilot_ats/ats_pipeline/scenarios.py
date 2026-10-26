"""Hand-written inference scenarios (§19) and hallucination tests (§20).

These are SYNTHETIC TEST INPUTS written for this project. They are never used
for training and are not real candidates. Each one targets a specific case the
spec requires: strong/weak, fresher/experienced, poor extraction, missing
sections, strong/weak/unrelated job matches.
"""

STRONG = """Aarav Kumar
candidate@example.com | +1-555-0100 | linkedin.com/in/candidate

Summary
Backend engineer with 4 years building high-throughput Python and Go services on AWS.

Experience
Senior Software Engineer | Fintech Co | Jan 2022 - Present
- Designed a payments ledger service in Python and PostgreSQL handling 2,000,000 transactions per day
- Reduced API p99 latency by 45% by introducing Redis caching and query optimisation
- Led migration of 14 services to Kubernetes on AWS EKS, cutting infrastructure cost by 30%
Software Engineer | Logistics Startup | Jul 2020 - Dec 2021
- Built REST APIs in Django serving 150,000 users
- Automated CI/CD with GitHub Actions and Docker, reducing release time from 2 days to 3 hours

Projects
Distributed Rate Limiter
- Go and Redis token-bucket limiter benchmarked at 50,000 requests per second

Education
B.Tech, Computer Science, National Institute of Technology (2020), CGPA 8.7/10

Skills
Python, Go, Django, PostgreSQL, Redis, Docker, Kubernetes, AWS, Git, REST APIs, Microservices

Certifications
AWS Certified Solutions Architect - Associate
"""

WEAK = """Rahul
I am a hard working person. I was responsible for many tasks. I worked on computers and helped with things.
I was involved in some projects. I like to learn new things and am a team player.
"""

FRESHER = """Priya Sharma
candidate@example.com | +1-555-0100

Career Objective
Final-year Computer Science student seeking a software engineering role.

Education
B.E. Computer Engineering, Pune University (Expected 2026), CGPA 8.9/10

Projects
Campus Placement Portal
- Built a React and Node.js portal with MongoDB used by 600 students
- Implemented JWT authentication and role-based access control
Sentiment Analyzer
- Trained a Python scikit-learn classifier on 20,000 reviews reaching 88% accuracy

Skills
Java, Python, JavaScript, React, Node.js, MongoDB, SQL, Git, Data Structures, Algorithms

Achievements
- Winner, college hackathon 2025 (120 teams)
"""

EXPERIENCED = """Meera Iyer
candidate@example.com | +1-555-0100

Professional Summary
Engineering manager with 12 years in data platforms, leading teams of up to 18 engineers.

Experience
Engineering Manager, Data Platform | Retail Group | 2019 - Present
- Led 3 teams building a Spark and Kafka streaming platform processing 4 TB per day
- Improved pipeline reliability from 97% to 99.9% availability
- Hired and mentored 11 engineers; introduced quarterly architecture reviews
Senior Data Engineer | Telecom Co | 2013 - 2019
- Built Hadoop and Hive ETL pipelines for billing analytics across 30 million subscribers

Education
M.Tech, Computer Science, IIT Madras (2013)

Skills
Spark, Kafka, Hadoop, Hive, Python, Scala, SQL, Airflow, AWS, Leadership
"""

POOR_EXTRACTION = ("SummaryBackend developer with Python and Django experienceExperienceSoftware Engineer ABC Tech "
                   "2021 - 2024Built REST APIs in Django and PostgreSQLImproved query speed by 30%EducationB.Tech "
                   "Computer Science 2021SkillsPython Django PostgreSQL Docker Git")

MISSING_SECTIONS = """Karan Mehta

Skills
Python, Pandas, NumPy, Matplotlib, SQL, Excel
"""

NO_QUANT = """Sneha Rao
candidate@example.com | +1-555-0100

Summary
Frontend developer.

Experience
Frontend Developer | Web Agency | 2022 - 2024
- Responsible for building pages
- Worked on the website
- Helped with bug fixes

Education
B.Sc Computer Science (2022)

Skills
HTML, CSS, JavaScript, React
"""

DATA_SCIENTIST = """Vikram Singh
candidate@example.com | +1-555-0100

Summary
Data scientist with 3 years building production machine learning models.

Experience
Data Scientist | Insurance Co | 2022 - Present
- Built a gradient-boosted fraud model in Python (XGBoost) that reduced false positives by 25%
- Deployed models as FastAPI services in Docker, monitored with MLflow
Data Analyst | Consulting Firm | 2021 - 2022
- Built Tableau dashboards and SQL reports for 40 clients

Projects
Customer Churn Prediction
- PyTorch model on 1,000,000 records reaching 0.91 AUC

Education
M.Sc Statistics, Delhi University (2021)

Skills
Python, SQL, Pandas, scikit-learn, XGBoost, PyTorch, TensorFlow, FastAPI, Docker, MLflow, Tableau, Statistics
"""

ACCOUNTANT = """Anita Desai
candidate@example.com | +1-555-0100

Summary
Chartered accountant with 6 years in audit and financial reporting.

Experience
Senior Accountant | Manufacturing Co | 2019 - Present
- Managed month-end close and consolidation for 5 entities
- Reduced audit adjustments by 40% through reconciliation controls

Education
B.Com, Mumbai University (2017); Chartered Accountant (2019)

Skills
Financial Reporting, Auditing, IFRS, Taxation, Excel, SAP, Tally
"""

LONG_CAREER_GAP = """Ravi Nair
candidate@example.com | +1-555-0100

Experience
Java Developer | Services Co | 2012 - 2016
- Developed Java and Spring applications

Education
B.Tech, Information Technology (2012)

Skills
Java, Spring, SQL, Hibernate
"""

GENERAL_CASES: list[tuple[str, str]] = [
    ("strong resume", STRONG),
    ("weak resume", WEAK),
    ("student / fresher", FRESHER),
    ("experienced resume", EXPERIENCED),
    ("poor formatting extraction", POOR_EXTRACTION),
    ("missing sections", MISSING_SECTIONS),
    ("no quantified impact", NO_QUANT),
    ("data scientist", DATA_SCIENTIST),
    ("non-technical (accountant)", ACCOUNTANT),
    ("dated / career gap", LONG_CAREER_GAP),
]

JD_BACKEND = """Backend Engineer (Python)
We are hiring a backend engineer to build scalable services.
Requirements: Python, Django or FastAPI, PostgreSQL, Redis, Docker, Kubernetes, AWS, REST APIs.
3+ years of experience. Bachelor's degree in Computer Science or related field."""

JD_FRONTEND = """Frontend Engineer
Build responsive web applications. Requirements: JavaScript, TypeScript, React, Redux, HTML, CSS, Jest.
Experience with Next.js is a plus. Bachelor's degree preferred."""

JD_DATA = """Machine Learning Engineer
Design and deploy ML models. Requirements: Python, PyTorch or TensorFlow, scikit-learn, SQL, Docker,
MLflow, AWS. Experience deploying models to production. Master's degree preferred."""

JD_NURSE = """Registered Nurse (ICU)
Provide critical patient care in the intensive care unit. Requirements: RN licence, BLS and ACLS
certification, 2+ years of ICU experience, patient assessment, medication administration."""

JD_GRAD_SDE = """Graduate Software Engineer (2026 batch)
Requirements: strong Data Structures and Algorithms, Java or Python, SQL, Git.
Projects demonstrating web development (React, Node.js) are a plus. B.Tech/B.E. with CGPA 7.0+."""

JD_DATA_ENG = """Principal Data Engineer
Lead a data platform team. Requirements: Spark, Kafka, Airflow, Python, Scala, SQL, AWS, leadership of
engineering teams, 10+ years of experience."""

JOB_MATCH_CASES: list[tuple[str, str, str]] = [
    ("strong technical match", STRONG, JD_BACKEND),
    ("weak technical match", NO_QUANT, JD_BACKEND),
    ("missing skills (frontend vs backend JD)", NO_QUANT, JD_FRONTEND),
    ("unrelated job (engineer vs ICU nurse)", STRONG, JD_NURSE),
    ("fresher vs graduate SDE role", FRESHER, JD_GRAD_SDE),
    ("experienced vs principal data engineer", EXPERIENCED, JD_DATA_ENG),
    ("data scientist vs ML engineer", DATA_SCIENTIST, JD_DATA),
    ("poor extraction vs backend", POOR_EXTRACTION, JD_BACKEND),
    ("missing sections vs ML engineer", MISSING_SECTIONS, JD_DATA),
    ("accountant vs backend (domain mismatch)", ACCOUNTANT, JD_BACKEND),
]

# (name, resume, jd, skills that MUST be matched, skills that must NEVER be matched)
HALLUCINATION_CASES: list[tuple[str, str, str, list[str], list[str]]] = [
    ("spec example: Python/JS vs Python/Java/AWS/Docker",
     "Skills\nPython, JavaScript\nExperience\nBuilt web apps in JavaScript and Python.",
     "We need Python, Java, AWS and Docker.",
     ["Python"], ["Java", "AWS", "Docker"]),
    ("Java must not be inferred from JavaScript",
     "Skills\nJavaScript, TypeScript, React\nExperience\nFrontend developer using JavaScript.",
     "Requirements: Java, Spring Boot, JavaScript.",
     ["JavaScript"], ["Java", "Spring Boot"]),
    ("no skill overlap at all",
     "Skills\nFinancial Reporting, Auditing, Excel\nExperience\nSenior accountant for 6 years.",
     "Requirements: Python, Kubernetes, Go, gRPC.",
     [], ["Python", "Kubernetes", "Go"]),
    ("related-but-different tools (MySQL vs PostgreSQL)",
     "Skills\nMySQL, PHP, Laravel\nExperience\nBuilt PHP apps backed by MySQL.",
     "Requirements: PostgreSQL, Python, Django.",
     [], ["PostgreSQL", "Python", "Django"]),
    ("cloud vendor confusion (Azure vs AWS)",
     "Skills\nAzure, C#, .NET\nExperience\nDeployed .NET services on Azure.",
     "Requirements: AWS, Terraform, C#.",
     ["C#"], ["AWS", "Terraform"]),
]
