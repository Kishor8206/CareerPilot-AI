"""Curated career knowledge: the hand-authored source of truth.

PROVENANCE — read this before citing anything here
    O*NET and ESCO describe occupations and list skills, but neither contains
    learning prerequisites, learning effort, role-level skill targets, projects
    or interview topics. Those are authored HERE, by hand, from standard
    computing-curriculum structure and common hiring practice. They are a
    reviewable editorial judgement, not measured facts and not an official
    standard. build_career_knowledge.py reports how much of the role-to-skill
    mapping is corroborated by O*NET and by real job descriptions.

    Skill names reuse CareerPilot's existing taxonomy (ai-service/app/nlp/
    skills_taxonomy.py) wherever a skill exists there, so ATS output and career
    knowledge share one vocabulary. Skills marked NEW exist only in this layer.

FORMAT
    SKILLS : name -> (category, subcategory, difficulty 1-5, hours, prerequisites, extra aliases)
             `hours` is the estimated study time for a beginner-with-prerequisites
             to reach INTERMEDIATE. It is an estimate for planning, not a measurement.
    ROLES  : see the dict layout below. Levels: B = beginner, I = intermediate, A = advanced.
             importance: 5 = defining skill of the role ... 1 = nice to have.
"""
from __future__ import annotations

KNOWLEDGE_VERSION = "career-knowledge-v1"

# Share of `hours` needed to reach each level from zero.
LEVEL_FRACTION = {"none": 0.0, "beginner": 0.35, "intermediate": 1.0, "advanced": 2.2}
LEVELS = ["none", "beginner", "intermediate", "advanced"]

S = {}  # filled below


def _s(name, category, sub, difficulty, hours, prereqs=(), aliases=()):
    S[name] = (category, sub, difficulty, hours, list(prereqs), list(aliases))


# ---------------------------------------------------------------- foundations
_s("Programming Fundamentals", "FOUNDATION", "programming", 1, 40, (), ("programming basics", "coding fundamentals", "programming logic"))  # NEW
_s("Object Oriented Programming", "FOUNDATION", "programming", 2, 30, ("Programming Fundamentals",))
_s("Data Structures", "FOUNDATION", "dsa", 3, 70, ("Programming Fundamentals",))
_s("Algorithms", "FOUNDATION", "dsa", 3, 80, ("Data Structures",))
_s("DSA Problem Solving", "FOUNDATION", "dsa", 4, 100, ("Algorithms",), ("competitive programming", "leetcode practice", "coding interview practice"))  # NEW
_s("Operating Systems", "FOUNDATION", "cs-core", 3, 40, ("Programming Fundamentals",))
_s("Computer Networks", "FOUNDATION", "cs-core", 3, 40)
_s("DBMS", "FOUNDATION", "cs-core", 2, 35, ("SQL",))
_s("System Design", "FOUNDATION", "architecture", 4, 80, ("DBMS", "Computer Networks", "REST API"))
_s("HTTP & Web Fundamentals", "FOUNDATION", "web", 1, 10, (), ("http", "how the web works"))  # NEW
_s("Git", "TOOL", "version-control", 1, 12)
_s("Linux", "TOOL", "os", 2, 30)
_s("Shell Scripting", "LANGUAGE", "scripting", 2, 25, ("Linux",))
_s("Agile", "PRACTICE", "process", 1, 10)
_s("Software Testing", "PRACTICE", "quality", 2, 30, ("Programming Fundamentals",))

# ------------------------------------------------------------------ languages
for _name, _diff, _hours in (("Python", 1, 50), ("Java", 2, 70), ("JavaScript", 2, 60), ("C", 2, 60), ("C++", 3, 80),
                             ("C#", 2, 70), ("Go", 2, 50), ("Rust", 4, 100), ("Kotlin", 2, 50), ("Swift", 2, 50),
                             ("PHP", 2, 45), ("Ruby", 2, 45), ("R", 2, 40)):
    _s(_name, "LANGUAGE", "general", _diff, _hours, ("Programming Fundamentals",))
_s("TypeScript", "LANGUAGE", "web", 2, 30, ("JavaScript",))
_s("Scala", "LANGUAGE", "jvm", 3, 60, ("Java",))
_s("SQL", "LANGUAGE", "data", 1, 35)

# ------------------------------------------------------------------- frontend
_s("HTML", "FRONTEND", "markup", 1, 15)
_s("CSS", "FRONTEND", "styling", 1, 25, ("HTML",))
_s("Responsive Design", "FRONTEND", "styling", 2, 15, ("CSS",), ("mobile-first design",))  # NEW
_s("Tailwind CSS", "FRONTEND", "styling", 1, 12, ("CSS",))
_s("Bootstrap", "FRONTEND", "styling", 1, 10, ("CSS",))
_s("React", "FRONTEND", "framework", 2, 60, ("JavaScript", "HTML", "CSS"))
_s("Redux", "FRONTEND", "state", 3, 20, ("React",))
_s("Next.js", "FRONTEND", "framework", 3, 35, ("React",))
_s("Angular", "FRONTEND", "framework", 3, 60, ("TypeScript", "HTML", "CSS"))
_s("Vue.js", "FRONTEND", "framework", 2, 45, ("JavaScript", "HTML", "CSS"))
_s("Jest", "FRONTEND", "testing", 2, 15, ("JavaScript",))
_s("Figma", "TOOL", "design", 1, 15)

# -------------------------------------------------------------------- backend
_s("REST API", "BACKEND", "api", 2, 25, ("HTTP & Web Fundamentals",))
_s("GraphQL", "BACKEND", "api", 3, 25, ("REST API",))
_s("Authentication & Authorization", "BACKEND", "security", 3, 25, ("REST API",), ("jwt", "oauth", "auth"))  # NEW
_s("Node.js", "BACKEND", "runtime", 2, 40, ("JavaScript",))
_s("Express.js", "BACKEND", "framework", 2, 25, ("Node.js", "REST API"))
_s("Django", "BACKEND", "framework", 2, 45, ("Python",))
_s("Flask", "BACKEND", "framework", 2, 25, ("Python",))
_s("FastAPI", "BACKEND", "framework", 2, 25, ("Python", "REST API"))
_s("Spring Boot", "BACKEND", "framework", 3, 60, ("Java", "Object Oriented Programming"))
_s("ASP.NET", "BACKEND", "framework", 3, 60, ("C#",))
_s("Laravel", "BACKEND", "framework", 2, 45, ("PHP",))
_s("Microservices", "BACKEND", "architecture", 4, 50, ("REST API", "Docker"))
_s("Apache Kafka", "BACKEND", "messaging", 4, 35, ("REST API",), ("kafka", "message queues"))  # NEW
_s("Postman", "TOOL", "api", 1, 8, ("REST API",))

# ------------------------------------------------------------------ databases
_s("MySQL", "DATABASE", "relational", 2, 25, ("SQL",))
_s("PostgreSQL", "DATABASE", "relational", 2, 25, ("SQL",))
_s("Oracle", "DATABASE", "relational", 2, 30, ("SQL",))
_s("MongoDB", "DATABASE", "document", 2, 25)
_s("Redis", "DATABASE", "cache", 2, 15)
_s("Elasticsearch", "DATABASE", "search", 3, 25, ("REST API",))
_s("Firebase", "DATABASE", "baas", 1, 15, ("JavaScript",))
_s("Database Design", "DATABASE", "modelling", 3, 30, ("SQL",), ("data modelling", "schema design", "normalization"))  # NEW

# --------------------------------------------------------------- cloud/devops
_s("Docker", "DEVOPS", "containers", 2, 25, ("Linux",))
_s("Kubernetes", "DEVOPS", "orchestration", 4, 50, ("Docker",))
_s("CI/CD", "DEVOPS", "automation", 3, 25, ("Git",))
_s("Jenkins", "DEVOPS", "automation", 2, 15, ("CI/CD",))
_s("Terraform", "DEVOPS", "iac", 3, 30, ("Linux",))
_s("Ansible", "DEVOPS", "iac", 3, 20, ("Linux",))  # NEW
_s("Nginx", "DEVOPS", "web-server", 2, 12, ("Linux",))
_s("Monitoring & Observability", "DEVOPS", "operations", 3, 25, ("Linux",), ("prometheus", "grafana", "observability"))  # NEW
_s("AWS", "CLOUD", "provider", 3, 60, ("Linux", "Computer Networks"))
_s("Azure", "CLOUD", "provider", 3, 60, ("Linux", "Computer Networks"))
_s("Google Cloud", "CLOUD", "provider", 3, 60, ("Linux", "Computer Networks"))

# ------------------------------------------------------------------- data, ML
_s("Excel", "DATA", "analysis", 1, 20)
_s("Statistics", "DATA", "maths", 3, 50)
_s("Linear Algebra", "DATA", "maths", 3, 35, (), ("matrices", "vectors"))  # NEW
_s("NumPy", "DATA", "library", 1, 15, ("Python",))
_s("Pandas", "DATA", "library", 2, 25, ("NumPy",))
_s("Jupyter", "TOOL", "notebook", 1, 5, ("Python",))
_s("Data Analysis", "DATA", "analysis", 2, 35, ("SQL",))
_s("Data Visualization", "DATA", "analysis", 2, 20)
_s("Power BI", "DATA", "bi", 2, 25)
_s("Tableau", "DATA", "bi", 2, 25)
_s("A/B Testing", "DATA", "experimentation", 3, 20, ("Statistics",), ("experimentation", "hypothesis testing"))  # NEW
_s("scikit-learn", "ML", "library", 2, 35, ("Pandas",))
_s("Machine Learning", "ML", "core", 4, 90, ("Python", "Statistics", "Pandas"))
_s("Feature Engineering", "ML", "core", 3, 25, ("Pandas",))  # NEW
_s("Deep Learning", "ML", "core", 4, 90, ("Machine Learning", "Linear Algebra"))
_s("TensorFlow", "ML", "framework", 3, 40, ("Machine Learning",))
_s("PyTorch", "ML", "framework", 3, 40, ("Machine Learning",))
_s("Natural Language Processing", "ML", "specialism", 4, 60, ("Deep Learning",))
_s("Computer Vision", "ML", "specialism", 4, 60, ("Deep Learning",))
_s("LLM Applications", "ML", "specialism", 3, 40, ("Python", "REST API"), ("generative ai", "genai", "rag", "llm"))  # NEW
_s("MLOps", "ML", "operations", 4, 45, ("Machine Learning", "Docker"))  # NEW
_s("ETL & Data Pipelines", "DATA_ENG", "pipelines", 3, 35, ("SQL", "Python"), ("etl", "data pipelines", "elt"))  # NEW
_s("Data Warehousing", "DATA_ENG", "storage", 3, 30, ("SQL",), ("data warehouse", "snowflake", "bigquery"))  # NEW
_s("Apache Airflow", "DATA_ENG", "orchestration", 3, 25, ("Python",), ("airflow",))  # NEW
# "Big Data" is the ATS taxonomy's name for Spark/Hadoop-style processing, so it is used here too.
_s("Big Data", "DATA_ENG", "processing", 3, 45, ("Python", "SQL"))

# --------------------------------------------------------------------- mobile
_s("Android Development", "MOBILE", "native", 3, 70, ("Kotlin",), ("android",))  # NEW
_s("iOS Development", "MOBILE", "native", 3, 70, ("Swift",), ("ios",))  # NEW
_s("React Native", "MOBILE", "cross-platform", 3, 45, ("React",))
_s("Flutter", "MOBILE", "cross-platform", 2, 50, ("Programming Fundamentals",))

# ------------------------------------------------------------------------- QA
_s("Selenium", "QA", "automation", 2, 25, ("Software Testing", "Programming Fundamentals"))
_s("JUnit", "QA", "unit", 2, 12, ("Java",))
_s("Pytest", "QA", "unit", 2, 10, ("Python",))
_s("Performance Testing", "QA", "non-functional", 3, 20, ("Software Testing",), ("load testing", "jmeter"))  # NEW

# ------------------------------------------------------------------- security
_s("Cybersecurity", "SECURITY", "core", 3, 60, ("Computer Networks", "Linux"))
_s("Network Security", "SECURITY", "network", 3, 40, ("Computer Networks",), ("firewalls", "ids/ips"))  # NEW
_s("Web Application Security", "SECURITY", "appsec", 3, 35, ("HTTP & Web Fundamentals",), ("owasp", "appsec"))  # NEW
_s("Penetration Testing", "SECURITY", "offensive", 4, 70, ("Cybersecurity",), ("pentesting", "pen testing"))  # NEW
_s("Incident Response", "SECURITY", "defensive", 3, 40, ("Cybersecurity",), ("siem", "soc operations"))  # NEW

# ------------------------------------------------------- business and soft
_s("Business Analysis", "BUSINESS", "analysis", 2, 40)
_s("Requirements Gathering", "BUSINESS", "analysis", 2, 20, (), ("requirement analysis", "user stories"))  # NEW
_s("Project Management", "BUSINESS", "delivery", 2, 30)
_s("Product Analytics", "BUSINESS", "analytics", 3, 30, ("SQL", "Statistics"), ("product metrics",))  # NEW
_s("Jira", "TOOL", "tracking", 1, 5)
_s("Communication", "SOFT", "interpersonal", 1, 20)
_s("Teamwork", "SOFT", "interpersonal", 1, 10)
_s("Problem Solving", "SOFT", "cognitive", 2, 20)

SKILLS = S


# ------------------------------------------------------------------------ roles
def _role(name, soc, aliases, description, core, secondary, soft, projects, interview, related, track_order):
    return {"canonical_name": name, "onet_soc": soc, "aliases": aliases, "description": description,
            "core_skills": [{"skill": s, "required_level": {"B": "beginner", "I": "intermediate", "A": "advanced"}[lv],
                             "importance": imp} for s, lv, imp in core],
            "secondary_skills": [{"skill": s, "required_level": {"B": "beginner", "I": "intermediate", "A": "advanced"}[lv],
                                  "importance": imp} for s, lv, imp in secondary],
            "soft_skills": soft,
            "typical_projects": [{"title": t, "skills": sk, "difficulty": d, "description": desc} for t, sk, d, desc in projects],
            "interview_topics": interview, "related_roles": related, "track_order": track_order}


_GENERAL = ["FOUNDATION", "LANGUAGE", "TOOL"]

ROLES = [
    _role("Software Engineer", "15-1252.00", ["software developer", "sde", "software development engineer", "programmer"],
          "Designs, builds and maintains software, with strong fundamentals in data structures, algorithms and system design.",
          [("Programming Fundamentals", "I", 5), ("Data Structures", "I", 5), ("Algorithms", "I", 5), ("Object Oriented Programming", "I", 4),
           ("DSA Problem Solving", "I", 4), ("SQL", "I", 4), ("Git", "I", 4), ("DBMS", "I", 3), ("Operating Systems", "B", 3), ("Computer Networks", "B", 3)],
          [("REST API", "I", 3), ("System Design", "B", 3), ("Software Testing", "B", 2), ("Linux", "B", 2), ("Docker", "B", 1)],
          ["Communication", "Problem Solving", "Teamwork"],
          [("Command-line task manager", ["Programming Fundamentals", "Object Oriented Programming", "Git"], "beginner", "A CLI app with persistent storage and unit tests."),
           ("REST API with a relational database", ["REST API", "SQL", "DBMS", "Git"], "intermediate", "A documented CRUD service with validation and tests."),
           ("URL shortener with caching", ["System Design", "REST API", "SQL", "Data Structures"], "advanced", "A service designed for scale, with a written design document.")],
          ["Arrays, strings and hashing", "Linked lists, stacks and queues", "Trees and graphs", "Sorting, searching and recursion",
           "Dynamic programming basics", "OOP principles and design", "SQL queries and joins", "OS and networking fundamentals"],
          ["Backend Developer", "Full Stack Developer"], _GENERAL + ["DATABASE", "BACKEND", "DEVOPS"]),

    _role("Frontend Developer", "15-1254.00", ["front end developer", "front-end developer", "ui developer", "react developer", "web developer"],
          "Builds the user-facing part of web applications: accessible, responsive, fast interfaces.",
          [("HTML", "I", 5), ("CSS", "I", 5), ("JavaScript", "A", 5), ("React", "I", 5), ("Responsive Design", "I", 4), ("Git", "I", 4), ("TypeScript", "B", 3), ("REST API", "B", 3), ("Data Structures", "B", 4)],
          [("Redux", "B", 2), ("Next.js", "B", 2), ("Jest", "B", 2), ("Tailwind CSS", "B", 2), ("Figma", "B", 1)],
          ["Communication", "Teamwork"],
          [("Responsive portfolio site", ["HTML", "CSS", "Responsive Design", "Git"], "beginner", "A multi-page responsive site deployed publicly."),
           ("Task board with React", ["React", "JavaScript", "CSS", "REST API"], "intermediate", "A stateful app with routing and API integration."),
           ("E-commerce storefront", ["React", "TypeScript", "Redux", "Jest", "REST API"], "advanced", "Typed, tested storefront with cart and checkout flows.")],
          ["JavaScript closures, scope and the event loop", "DOM, events and browser rendering", "CSS layout: flexbox and grid",
           "React components, hooks and state", "Asynchronous JavaScript and fetch", "Web performance and accessibility", "Basic DSA in JavaScript"],
          ["Full Stack Developer", "Mobile Developer"], ["FOUNDATION", "LANGUAGE", "FRONTEND", "TOOL", "BACKEND"]),

    _role("Backend Developer", "15-1252.00", ["back end developer", "back-end developer", "server-side developer", "api developer"],
          "Builds server-side logic, APIs and data storage that applications depend on.",
          [("Programming Fundamentals", "I", 5), ("REST API", "I", 5), ("SQL", "I", 5), ("DBMS", "I", 4), ("Authentication & Authorization", "I", 4),
           ("Git", "I", 4), ("Data Structures", "I", 4), ("Database Design", "I", 3), ("Object Oriented Programming", "I", 3)],
          [("Docker", "B", 3), ("Redis", "B", 2), ("System Design", "B", 3), ("Software Testing", "B", 3), ("Linux", "B", 2), ("Algorithms", "B", 3), ("Microservices", "B", 1)],
          ["Communication", "Problem Solving"],
          [("Notes API", ["REST API", "SQL", "Git"], "beginner", "A CRUD API with validation and a relational database."),
           ("Authenticated blogging backend", ["REST API", "Authentication & Authorization", "Database Design", "Software Testing"], "intermediate", "Role-based access, pagination and an automated test suite."),
           ("Order-processing service", ["Microservices", "Docker", "Redis", "System Design"], "advanced", "Containerised services with caching and a design document.")],
          ["REST design and HTTP semantics", "SQL joins, indexes and transactions", "Authentication, sessions and JWT", "Caching and rate limiting",
           "Concurrency and scalability basics", "Data structures and algorithms", "Schema design and normalisation"],
          ["Software Engineer", "Full Stack Developer", "DevOps Engineer"], _GENERAL + ["DATABASE", "BACKEND", "DEVOPS"]),

    _role("Full Stack Developer", "15-1254.00", ["fullstack developer", "full-stack developer", "full stack engineer", "web application developer"],
          "Builds complete web applications across the browser, the server and the database.",
          [("HTML", "I", 4), ("CSS", "I", 4), ("JavaScript", "I", 5), ("React", "I", 5), ("Node.js", "I", 5), ("REST API", "I", 5), ("SQL", "I", 4),
           ("Git", "I", 4), ("Authentication & Authorization", "I", 4), ("Database Design", "B", 3), ("Data Structures", "I", 4)],
          [("Express.js", "I", 4), ("MongoDB", "B", 3), ("TypeScript", "B", 3), ("Docker", "B", 2), ("Algorithms", "B", 3),
           ("Software Testing", "B", 2), ("Responsive Design", "B", 2), ("System Design", "B", 2)],
          ["Communication", "Problem Solving"],
          [("Personal portfolio with a contact API", ["HTML", "CSS", "JavaScript", "Node.js"], "beginner", "A static front end with a small backend endpoint."),
           ("Full-stack task manager", ["React", "Node.js", "REST API", "SQL", "Authentication & Authorization"], "intermediate", "Login, CRUD and a deployed database-backed app."),
           ("Marketplace application", ["React", "Node.js", "Database Design", "Docker", "Software Testing"], "advanced", "Multi-role app with payments mocked, tests and containerised deployment.")],
          ["JavaScript fundamentals and async", "React components, hooks and state", "REST API design", "SQL and schema design",
           "Authentication and security basics", "Data structures and algorithms", "Deployment and environment configuration"],
          ["Frontend Developer", "Backend Developer", "MERN Developer"], ["FOUNDATION", "LANGUAGE", "FRONTEND", "TOOL", "BACKEND", "DATABASE", "DEVOPS"]),

    _role("MERN Developer", "15-1254.00", ["mern stack developer", "mern engineer", "mern full stack developer"],
          "Builds web applications with MongoDB, Express.js, React and Node.js.",
          [("JavaScript", "I", 5), ("React", "I", 5), ("Node.js", "I", 5), ("Express.js", "I", 5), ("MongoDB", "I", 5), ("REST API", "I", 4),
           ("HTML", "I", 3), ("CSS", "I", 3), ("Git", "I", 4), ("Authentication & Authorization", "I", 4), ("Data Structures", "I", 4)],
          [("Redux", "B", 2), ("TypeScript", "B", 2), ("Docker", "B", 2), ("Algorithms", "B", 3), ("Software Testing", "B", 2)],
          ["Communication", "Teamwork"],
          [("Notes app (MERN)", ["React", "Node.js", "Express.js", "MongoDB"], "beginner", "CRUD notes with a REST backend."),
           ("Social feed with authentication", ["React", "Express.js", "MongoDB", "Authentication & Authorization"], "intermediate", "JWT login, posts, likes and pagination."),
           ("Real-time collaboration board", ["React", "Node.js", "MongoDB", "Redux", "Docker"], "advanced", "WebSocket updates, global state and containerised deployment.")],
          ["JavaScript and ES6+", "React hooks and state management", "Express middleware and routing", "MongoDB schema design and aggregation",
           "JWT authentication", "REST API design", "Basic DSA"],
          ["Full Stack Developer", "Frontend Developer"], ["FOUNDATION", "LANGUAGE", "FRONTEND", "TOOL", "BACKEND", "DATABASE", "DEVOPS"]),

    _role("Java Developer", "15-1252.00", ["java engineer", "java backend developer", "java programmer", "spring boot developer"],
          "Builds enterprise applications and services on the Java platform.",
          [("Java", "A", 5), ("Object Oriented Programming", "I", 5), ("Spring Boot", "I", 5), ("SQL", "I", 4), ("REST API", "I", 4),
           ("Data Structures", "I", 4), ("Git", "I", 4), ("JUnit", "B", 3)],
          [("Algorithms", "I", 3), ("Microservices", "B", 3), ("Docker", "B", 2), ("MySQL", "B", 3), ("DBMS", "I", 3), ("System Design", "B", 2)],
          ["Communication", "Problem Solving"],
          [("Library management console app", ["Java", "Object Oriented Programming", "Git"], "beginner", "An OOP-designed console application with collections."),
           ("Spring Boot REST service", ["Spring Boot", "REST API", "SQL", "JUnit"], "intermediate", "Layered service with JPA persistence and unit tests."),
           ("Microservices order system", ["Spring Boot", "Microservices", "Docker", "MySQL"], "advanced", "Multiple services communicating over REST, containerised.")],
          ["Core Java: collections, generics, exceptions", "OOP and SOLID principles", "Multithreading and concurrency", "JVM memory and garbage collection",
           "Spring Boot, dependency injection and JPA", "SQL and transactions", "Data structures and algorithms"],
          ["Backend Developer", "Software Engineer"], _GENERAL + ["DATABASE", "BACKEND", "QA", "DEVOPS"]),

    _role("Python Developer", "15-1252.00", ["python engineer", "python programmer", "django developer", "python backend developer"],
          "Builds applications, services and automation in Python.",
          [("Python", "A", 5), ("Object Oriented Programming", "I", 4), ("REST API", "I", 4), ("SQL", "I", 4), ("Git", "I", 4), ("Data Structures", "I", 4), ("Django", "I", 4)],
          [("FastAPI", "B", 3), ("Flask", "B", 2), ("Pytest", "B", 3), ("Docker", "B", 2), ("PostgreSQL", "B", 3), ("Algorithms", "B", 3), ("Linux", "B", 2)],
          ["Communication", "Problem Solving"],
          [("File-organiser automation script", ["Python", "Git"], "beginner", "A tested script that automates a repetitive task."),
           ("Django blog with authentication", ["Django", "SQL", "REST API", "Pytest"], "intermediate", "Models, views, authentication and tests."),
           ("Async API with background jobs", ["FastAPI", "PostgreSQL", "Docker", "Pytest"], "advanced", "Typed async API with a task queue and containers.")],
          ["Python data types, comprehensions and generators", "OOP in Python and decorators", "Django or FastAPI request lifecycle", "SQL and ORMs",
           "Testing with pytest", "Data structures and algorithms", "Concurrency: threads, processes and async"],
          ["Backend Developer", "Data Engineer"], _GENERAL + ["DATABASE", "BACKEND", "QA", "DEVOPS"]),

    _role("Data Analyst", "15-2051.01", ["business data analyst", "reporting analyst", "analytics analyst", "bi analyst"],
          "Turns data into decisions through querying, analysis and clear reporting.",
          [("SQL", "A", 5), ("Excel", "I", 5), ("Data Analysis", "I", 5), ("Data Visualization", "I", 5), ("Statistics", "I", 4), ("Power BI", "I", 3)],
          [("Python", "B", 3), ("Pandas", "B", 3), ("Tableau", "B", 2), ("A/B Testing", "B", 2), ("Business Analysis", "B", 2)],
          ["Communication", "Problem Solving"],
          [("Sales dashboard in Excel", ["Excel", "Data Visualization"], "beginner", "Pivot tables and charts answering five business questions."),
           ("SQL analysis of a retail dataset", ["SQL", "Data Analysis", "Statistics"], "intermediate", "A written report backed by documented queries."),
           ("Interactive BI dashboard", ["Power BI", "SQL", "Data Visualization", "Statistics"], "advanced", "A published dashboard with drill-downs and a findings summary.")],
          ["SQL joins, aggregation and window functions", "Excel: pivot tables and lookups", "Descriptive statistics and distributions",
           "Hypothesis testing basics", "Choosing the right chart", "Case studies: metrics and business problems"],
          ["Business Analyst", "Data Scientist", "Product Analyst"], ["LANGUAGE", "DATA", "TOOL", "BUSINESS"]),

    _role("Data Scientist", "15-2051.00", ["ml scientist", "applied scientist", "data science engineer"],
          "Builds statistical and machine-learning models to answer questions and predict outcomes.",
          [("Python", "I", 5), ("Statistics", "I", 5), ("Pandas", "I", 5), ("NumPy", "I", 4), ("Machine Learning", "I", 5), ("SQL", "I", 4),
           ("scikit-learn", "I", 4), ("Data Visualization", "I", 3), ("Feature Engineering", "I", 3)],
          [("Linear Algebra", "B", 3), ("Deep Learning", "B", 3), ("A/B Testing", "B", 2), ("Jupyter", "B", 2), ("Git", "B", 3), ("PyTorch", "B", 2)],
          ["Communication", "Problem Solving"],
          [("Exploratory analysis of a public dataset", ["Python", "Pandas", "Data Visualization"], "beginner", "A notebook with cleaned data and five findings."),
           ("Churn prediction model", ["Machine Learning", "scikit-learn", "Feature Engineering", "Statistics"], "intermediate", "A validated classifier with an honest evaluation."),
           ("End-to-end forecasting project", ["Machine Learning", "Feature Engineering", "SQL", "Git"], "advanced", "Data pipeline, model comparison and a written report.")],
          ["Probability and statistics", "Bias-variance, overfitting and regularisation", "Supervised vs unsupervised learning", "Evaluation metrics and validation",
           "Feature engineering", "SQL for analysis", "Explaining a past project end to end"],
          ["Machine Learning Engineer", "Data Analyst"], ["FOUNDATION", "LANGUAGE", "DATA", "TOOL", "ML"]),

    _role("Machine Learning Engineer", "15-2051.00", ["ml engineer", "mle", "machine learning developer"],
          "Builds, deploys and maintains machine-learning systems in production.",
          [("Python", "A", 5), ("Machine Learning", "I", 5), ("Pandas", "I", 4), ("NumPy", "I", 4), ("Statistics", "I", 4), ("Deep Learning", "I", 4),
           ("PyTorch", "I", 4), ("Git", "I", 4), ("Data Structures", "I", 3), ("MLOps", "B", 3)],
          [("Linear Algebra", "I", 3), ("Docker", "B", 3), ("SQL", "I", 3), ("REST API", "B", 3), ("Feature Engineering", "I", 3), ("scikit-learn", "I", 3), ("Algorithms", "B", 2)],
          ["Communication", "Problem Solving"],
          [("Image classifier", ["Python", "Deep Learning", "PyTorch"], "beginner", "A CNN trained and evaluated on a public dataset."),
           ("Model served behind an API", ["Machine Learning", "REST API", "Docker", "Git"], "intermediate", "A trained model exposed as a containerised endpoint."),
           ("Training-to-deployment pipeline", ["MLOps", "Deep Learning", "Docker", "Feature Engineering"], "advanced", "Reproducible training, versioned models and monitoring.")],
          ["ML fundamentals and model selection", "Neural networks and backpropagation", "Optimisation and regularisation", "Model evaluation and data leakage",
           "Serving, latency and monitoring", "Python and data structures", "System design for ML"],
          ["Data Scientist", "AI Engineer", "Data Engineer"], ["FOUNDATION", "LANGUAGE", "DATA", "TOOL", "ML", "BACKEND", "DEVOPS"]),

    _role("AI Engineer", "15-2051.00", ["generative ai engineer", "llm engineer", "genai developer", "ai developer"],
          "Builds applications on top of machine-learning and large language models.",
          [("Python", "A", 5), ("LLM Applications", "I", 5), ("REST API", "I", 4), ("Machine Learning", "I", 4), ("Deep Learning", "B", 3),
           ("Natural Language Processing", "B", 3), ("Git", "I", 4)],
          [("PyTorch", "B", 3), ("FastAPI", "B", 3), ("Docker", "B", 3), ("SQL", "B", 2), ("Pandas", "I", 3), ("Statistics", "B", 3), ("MLOps", "B", 2)],
          ["Communication", "Problem Solving"],
          [("Document question-answering bot", ["Python", "LLM Applications", "REST API"], "beginner", "Retrieval over your own documents with cited answers."),
           ("Evaluated RAG service", ["LLM Applications", "FastAPI", "Docker", "Natural Language Processing"], "intermediate", "A served pipeline with an evaluation set and metrics."),
           ("Fine-tuned domain model", ["Deep Learning", "PyTorch", "MLOps", "LLM Applications"], "advanced", "A fine-tuned small model compared honestly against a baseline.")],
          ["Transformers and attention at a high level", "Embeddings and vector search", "Retrieval-augmented generation", "Prompt design and evaluation",
           "Fine-tuning vs prompting trade-offs", "ML fundamentals", "API design and latency"],
          ["Machine Learning Engineer", "Data Scientist"], ["FOUNDATION", "LANGUAGE", "DATA", "TOOL", "ML", "BACKEND", "DEVOPS"]),

    _role("Data Engineer", "15-1243.00", ["big data engineer", "etl developer", "data pipeline engineer", "analytics engineer"],
          "Builds the pipelines and storage that make data reliable and available.",
          [("SQL", "A", 5), ("Python", "I", 5), ("ETL & Data Pipelines", "I", 5), ("Data Warehousing", "I", 4), ("Database Design", "I", 4),
           ("Big Data", "I", 4), ("Git", "I", 4)],
          [("Apache Airflow", "B", 3), ("Apache Kafka", "B", 2), ("AWS", "B", 3), ("Docker", "B", 2), ("Linux", "B", 3), ("Data Structures", "B", 2)],
          ["Communication", "Problem Solving"],
          [("CSV-to-database loader", ["Python", "SQL", "Git"], "beginner", "A repeatable, validated load of raw files into tables."),
           ("Scheduled ETL pipeline", ["ETL & Data Pipelines", "Apache Airflow", "SQL", "Data Warehousing"], "intermediate", "A daily pipeline with data-quality checks."),
           ("Batch analytics platform", ["Big Data", "Data Warehousing", "AWS", "Docker"], "advanced", "Partitioned storage, Spark jobs and a documented data model.")],
          ["Advanced SQL and query optimisation", "Data modelling: star and snowflake schemas", "ETL vs ELT and idempotency", "Batch vs streaming",
           "Spark fundamentals", "Data quality and testing", "Python for data processing"],
          ["Data Analyst", "Machine Learning Engineer", "Backend Developer"], ["FOUNDATION", "LANGUAGE", "TOOL", "DATABASE", "DATA_ENG", "CLOUD", "DEVOPS"]),

    _role("DevOps Engineer", "15-1244.00", ["devops", "platform engineer", "build and release engineer", "infrastructure engineer"],
          "Automates how software is built, tested, deployed and operated.",
          [("Linux", "A", 5), ("Git", "I", 4), ("Docker", "I", 5), ("CI/CD", "I", 5), ("Shell Scripting", "I", 4), ("AWS", "I", 4),
           ("Kubernetes", "I", 4), ("Computer Networks", "I", 3)],
          [("Terraform", "B", 3), ("Monitoring & Observability", "B", 3), ("Python", "B", 3), ("Jenkins", "B", 2), ("Nginx", "B", 2), ("Ansible", "B", 2)],
          ["Communication", "Problem Solving"],
          [("Containerise a web app", ["Docker", "Linux", "Git"], "beginner", "A Dockerfile and compose setup for an existing app."),
           ("CI/CD pipeline", ["CI/CD", "Docker", "Git", "Shell Scripting"], "intermediate", "Automated build, test and deploy on every commit."),
           ("Kubernetes deployment on a cloud", ["Kubernetes", "AWS", "Terraform", "Monitoring & Observability"], "advanced", "Infrastructure as code with dashboards and alerts.")],
          ["Linux administration and shell", "Networking: DNS, HTTP, load balancing", "Docker images and containers", "CI/CD pipeline design",
           "Kubernetes objects and scheduling", "Infrastructure as code", "Monitoring, logging and incident handling"],
          ["Cloud Engineer", "Site Reliability Engineer", "Backend Developer"], ["FOUNDATION", "TOOL", "LANGUAGE", "DEVOPS", "CLOUD"]),

    _role("Cloud Engineer", "15-1244.00", ["cloud developer", "aws engineer", "azure engineer", "cloud infrastructure engineer"],
          "Designs and runs infrastructure and services on public cloud platforms.",
          [("AWS", "I", 5), ("Linux", "I", 5), ("Computer Networks", "I", 5), ("Docker", "I", 4), ("Terraform", "I", 4), ("Git", "I", 3), ("Shell Scripting", "B", 3)],
          [("Kubernetes", "B", 3), ("CI/CD", "B", 3), ("Python", "B", 3), ("Monitoring & Observability", "B", 3), ("Cybersecurity", "B", 2), ("Azure", "B", 1)],
          ["Communication", "Problem Solving"],
          [("Static site on object storage", ["AWS", "Git"], "beginner", "A hosted site with a custom domain and HTTPS."),
           ("Three-tier app on a cloud", ["AWS", "Computer Networks", "Docker", "Linux"], "intermediate", "Network, compute and database provisioned securely."),
           ("Infrastructure as code platform", ["Terraform", "AWS", "Kubernetes", "Monitoring & Observability"], "advanced", "Reusable modules, environments and observability.")],
          ["Core cloud services: compute, storage, networking", "Identity and access management", "Networking: subnets, routing, DNS", "High availability and scaling",
           "Infrastructure as code", "Cost and security basics", "Linux fundamentals"],
          ["DevOps Engineer", "Site Reliability Engineer"], ["FOUNDATION", "TOOL", "LANGUAGE", "DEVOPS", "CLOUD", "SECURITY"]),

    _role("Site Reliability Engineer", "15-1244.00", ["sre", "reliability engineer", "production engineer"],
          "Keeps services reliable through automation, monitoring and engineering.",
          [("Linux", "A", 5), ("Monitoring & Observability", "I", 5), ("Python", "I", 4), ("Computer Networks", "I", 4), ("Docker", "I", 4),
           ("Kubernetes", "I", 4), ("CI/CD", "I", 3), ("Git", "I", 3)],
          [("System Design", "I", 3), ("AWS", "B", 3), ("Shell Scripting", "I", 3), ("Terraform", "B", 2), ("Operating Systems", "I", 3)],
          ["Communication", "Problem Solving"],
          [("Service health dashboard", ["Monitoring & Observability", "Linux", "Docker"], "beginner", "Metrics and alerts for a sample service."),
           ("Automated incident runbook", ["Python", "Monitoring & Observability", "Shell Scripting"], "intermediate", "Scripts that detect and remediate common failures."),
           ("Highly available deployment", ["Kubernetes", "System Design", "AWS", "CI/CD"], "advanced", "Multi-zone deployment with SLOs and load testing.")],
          ["Linux internals and troubleshooting", "SLIs, SLOs and error budgets", "Networking and load balancing", "Monitoring and alerting design",
           "Incident response and postmortems", "Capacity planning", "System design for reliability"],
          ["DevOps Engineer", "Cloud Engineer"], ["FOUNDATION", "TOOL", "LANGUAGE", "DEVOPS", "CLOUD"]),

    _role("Cybersecurity Analyst", "15-1212.00", ["security analyst", "information security analyst", "soc analyst", "infosec analyst"],
          "Protects systems by monitoring, detecting and responding to security threats.",
          [("Cybersecurity", "I", 5), ("Computer Networks", "I", 5), ("Linux", "I", 4), ("Network Security", "I", 4), ("Incident Response", "I", 4),
           ("Web Application Security", "B", 3)],
          [("Python", "B", 3), ("Shell Scripting", "B", 2), ("Penetration Testing", "B", 2), ("Operating Systems", "B", 3), ("AWS", "B", 1)],
          ["Communication", "Problem Solving"],
          [("Home lab with a firewall", ["Computer Networks", "Linux", "Network Security"], "beginner", "A documented, segmented lab network."),
           ("Log analysis and alerting", ["Incident Response", "Linux", "Python"], "intermediate", "Detection rules over collected logs with a short report."),
           ("Web application security assessment", ["Web Application Security", "Penetration Testing", "Cybersecurity"], "advanced", "An authorised test of your own app with remediation notes.")],
          ["Networking: TCP/IP, DNS, HTTP", "Common attacks and the OWASP Top 10", "Authentication and encryption basics", "Log analysis and SIEM concepts",
           "Incident response lifecycle", "Linux and Windows security basics"],
          ["Cloud Engineer", "DevOps Engineer"], ["FOUNDATION", "TOOL", "LANGUAGE", "SECURITY", "CLOUD"]),

    _role("QA Engineer", "15-1253.00", ["software tester", "test engineer", "sdet", "quality assurance engineer", "automation tester"],
          "Ensures software quality through test design, automation and defect analysis.",
          [("Software Testing", "A", 5), ("Selenium", "I", 5), ("Programming Fundamentals", "I", 4), ("SQL", "I", 3),
           ("Git", "I", 3), ("Postman", "I", 3)],
          [("Java", "B", 3), ("REST API", "B", 3), ("CI/CD", "B", 2), ("Performance Testing", "B", 2), ("Agile", "B", 2), ("Jira", "B", 2)],
          ["Communication", "Problem Solving"],
          [("Manual test plan for a web app", ["Software Testing", "Jira"], "beginner", "Test cases, a traceability matrix and bug reports."),
           ("UI automation suite", ["Selenium", "Software Testing", "Git"], "intermediate", "Page-object automation for core user journeys."),
           ("API and CI test pipeline", ["Selenium", "Postman", "CI/CD", "REST API"], "advanced", "API tests running automatically on every build.")],
          ["Test design techniques", "Test levels and types", "Selenium locators and waits", "API testing", "Defect lifecycle and reporting",
           "SQL for data validation", "Basic programming and OOP"],
          ["Software Engineer", "DevOps Engineer"], ["FOUNDATION", "LANGUAGE", "TOOL", "PRACTICE", "QA", "BACKEND", "DEVOPS"]),

    _role("Mobile Developer", "15-1252.00", ["android developer", "mobile app developer", "app developer", "kotlin developer"],
          "Builds applications for mobile devices.",
          [("Programming Fundamentals", "I", 5), ("Kotlin", "I", 5), ("Android Development", "I", 5), ("REST API", "I", 4), ("Git", "I", 4), ("Object Oriented Programming", "I", 4)],
          [("Firebase", "B", 3), ("SQL", "B", 3), ("Data Structures", "B", 3), ("Software Testing", "B", 2), ("Figma", "B", 1), ("Flutter", "B", 1)],
          ["Communication", "Teamwork"],
          [("Tip calculator app", ["Kotlin", "Android Development"], "beginner", "A single-screen app with state handling."),
           ("News reader with an API", ["Android Development", "REST API", "Git"], "intermediate", "Lists, navigation, networking and offline cache."),
           ("Chat application", ["Android Development", "Firebase", "REST API", "Software Testing"], "advanced", "Real-time messaging with authentication and tests.")],
          ["Kotlin language features", "Activity and fragment lifecycle", "Layouts and navigation", "Networking and background work",
           "Local storage", "App architecture patterns", "Basic DSA"],
          ["Frontend Developer", "Full Stack Developer"], ["FOUNDATION", "LANGUAGE", "TOOL", "MOBILE", "BACKEND", "DATABASE"]),

    _role("Business Analyst", "13-1111.00", ["it business analyst", "systems analyst", "functional analyst"],
          "Bridges business needs and technical delivery through analysis and clear requirements.",
          [("Business Analysis", "I", 5), ("Requirements Gathering", "I", 5), ("SQL", "I", 4), ("Excel", "I", 4), ("Data Visualization", "I", 3), ("Agile", "I", 3)],
          [("Power BI", "B", 3), ("Jira", "B", 3), ("Data Analysis", "B", 3), ("Project Management", "B", 2), ("Statistics", "B", 2)],
          ["Communication", "Problem Solving", "Teamwork"],
          [("Requirements document for an app", ["Requirements Gathering", "Business Analysis"], "beginner", "User stories with acceptance criteria and process flows."),
           ("Process analysis with data", ["SQL", "Excel", "Data Visualization", "Business Analysis"], "intermediate", "A quantified current-state analysis with recommendations."),
           ("Product backlog and KPI dashboard", ["Agile", "Power BI", "Requirements Gathering", "Data Analysis"], "advanced", "A prioritised backlog with measurable outcomes.")],
          ["Requirement elicitation techniques", "Writing user stories and acceptance criteria", "Process modelling", "SQL basics",
           "Stakeholder communication scenarios", "Agile ceremonies and artefacts", "Case studies"],
          ["Data Analyst", "Product Analyst"], ["BUSINESS", "LANGUAGE", "DATA", "TOOL", "PRACTICE"]),

    _role("Product Analyst", "15-2051.01", ["product data analyst", "growth analyst", "product analytics analyst"],
          "Uses data to understand how a product is used and how to improve it.",
          [("SQL", "A", 5), ("Product Analytics", "I", 5), ("Statistics", "I", 4), ("A/B Testing", "I", 4), ("Data Visualization", "I", 4), ("Excel", "I", 3)],
          [("Python", "B", 3), ("Pandas", "B", 3), ("Tableau", "B", 2), ("Data Analysis", "I", 3), ("Business Analysis", "B", 2)],
          ["Communication", "Problem Solving"],
          [("Funnel analysis", ["SQL", "Data Visualization", "Product Analytics"], "beginner", "A conversion funnel with drop-off findings."),
           ("A/B test analysis", ["A/B Testing", "Statistics", "SQL"], "intermediate", "A complete analysis with a clear recommendation."),
           ("Retention and cohort dashboard", ["Product Analytics", "SQL", "Tableau", "Statistics"], "advanced", "Cohort retention with segment insights.")],
          ["Product metrics and funnels", "A/B testing and significance", "SQL window functions", "Cohort and retention analysis",
           "Metric design case studies", "Communicating findings"],
          ["Data Analyst", "Business Analyst", "Data Scientist"], ["LANGUAGE", "DATA", "BUSINESS", "TOOL"]),
]
