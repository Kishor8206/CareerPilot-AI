"""Skill taxonomy used by the resume parser and the job matcher.

Each canonical skill carries its aliases so that "JS", "Javascript" and
"ECMAScript" collapse onto one entry. Matching is alias-aware and
word-boundary anchored, which is what stops "R" matching every capital R and
"Go" matching the word "going".
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class SkillDef:
    name: str
    category: str
    aliases: tuple[str, ...] = ()


# Categories mirror shared/src/enums.ts SkillCategory.
PROGRAMMING_LANGUAGE = "PROGRAMMING_LANGUAGE"
FRAMEWORK = "FRAMEWORK"
TOOL = "TOOL"
DATABASE = "DATABASE"
CLOUD = "CLOUD"
CS_FUNDAMENTAL = "CS_FUNDAMENTAL"
SOFT_SKILL = "SOFT_SKILL"
DOMAIN = "DOMAIN"

SKILLS: tuple[SkillDef, ...] = (
    # ---- Programming languages ----
    SkillDef("Python", PROGRAMMING_LANGUAGE, ("python3", "py")),
    SkillDef("Java", PROGRAMMING_LANGUAGE, ("core java", "java8", "java 8", "j2ee")),
    SkillDef("JavaScript", PROGRAMMING_LANGUAGE, ("js", "ecmascript", "es6", "vanilla js")),
    SkillDef("TypeScript", PROGRAMMING_LANGUAGE, ("ts",)),
    SkillDef("C++", PROGRAMMING_LANGUAGE, ("cpp", "c plus plus")),
    SkillDef("C", PROGRAMMING_LANGUAGE, ("c language", "ansi c")),
    SkillDef("C#", PROGRAMMING_LANGUAGE, ("csharp", "c sharp", "dotnet c#")),
    SkillDef("Go", PROGRAMMING_LANGUAGE, ("golang",)),
    SkillDef("Rust", PROGRAMMING_LANGUAGE),
    SkillDef("Kotlin", PROGRAMMING_LANGUAGE),
    SkillDef("Swift", PROGRAMMING_LANGUAGE),
    SkillDef("PHP", PROGRAMMING_LANGUAGE),
    SkillDef("Ruby", PROGRAMMING_LANGUAGE),
    SkillDef("Scala", PROGRAMMING_LANGUAGE),
    SkillDef("R", PROGRAMMING_LANGUAGE, ("r language", "r programming")),
    SkillDef("MATLAB", PROGRAMMING_LANGUAGE),
    SkillDef("Shell Scripting", PROGRAMMING_LANGUAGE, ("bash", "shell", "powershell", "zsh")),

    # ---- Frontend ----
    SkillDef("React", FRAMEWORK, ("react.js", "reactjs", "react js")),
    SkillDef("Angular", FRAMEWORK, ("angularjs", "angular.js")),
    SkillDef("Vue.js", FRAMEWORK, ("vue", "vuejs")),
    SkillDef("Next.js", FRAMEWORK, ("nextjs", "next js")),
    SkillDef("Redux", FRAMEWORK, ("redux toolkit", "rtk")),
    SkillDef("HTML", FRAMEWORK, ("html5",)),
    SkillDef("CSS", FRAMEWORK, ("css3",)),
    SkillDef("Tailwind CSS", FRAMEWORK, ("tailwind", "tailwindcss")),
    SkillDef("Bootstrap", FRAMEWORK),
    SkillDef("jQuery", FRAMEWORK),
    SkillDef("React Native", FRAMEWORK, ("react-native",)),
    SkillDef("Flutter", FRAMEWORK),

    # ---- Backend ----
    SkillDef("Node.js", FRAMEWORK, ("nodejs", "node", "node js")),
    SkillDef("Express.js", FRAMEWORK, ("express", "expressjs")),
    SkillDef("Django", FRAMEWORK),
    SkillDef("Flask", FRAMEWORK),
    SkillDef("FastAPI", FRAMEWORK, ("fast api",)),
    SkillDef("Spring Boot", FRAMEWORK, ("spring", "springboot")),
    SkillDef("ASP.NET", FRAMEWORK, ("asp net", ".net", "dotnet")),
    SkillDef("Laravel", FRAMEWORK),
    SkillDef("GraphQL", FRAMEWORK),
    SkillDef("REST API", FRAMEWORK, ("rest", "restful", "rest apis", "restful api")),
    SkillDef("Microservices", FRAMEWORK, ("microservice architecture",)),

    # ---- Databases ----
    SkillDef("MySQL", DATABASE),
    SkillDef("PostgreSQL", DATABASE, ("postgres", "psql")),
    SkillDef("MongoDB", DATABASE, ("mongo", "mongoose")),
    SkillDef("SQL", DATABASE, ("structured query language",)),
    SkillDef("Oracle", DATABASE, ("oracle db", "plsql", "pl/sql")),
    SkillDef("Redis", DATABASE),
    SkillDef("SQLite", DATABASE),
    SkillDef("Cassandra", DATABASE),
    SkillDef("Elasticsearch", DATABASE, ("elastic search",)),
    SkillDef("Firebase", DATABASE),

    # ---- Cloud & DevOps ----
    SkillDef("AWS", CLOUD, ("amazon web services", "ec2", "s3 bucket")),
    SkillDef("Azure", CLOUD, ("microsoft azure",)),
    SkillDef("Google Cloud", CLOUD, ("gcp", "google cloud platform")),
    SkillDef("Docker", CLOUD, ("containerization", "containerisation")),
    SkillDef("Kubernetes", CLOUD, ("k8s",)),
    SkillDef("CI/CD", CLOUD, ("ci cd", "continuous integration", "continuous deployment")),
    SkillDef("Jenkins", CLOUD),
    SkillDef("Terraform", CLOUD),
    SkillDef("Linux", CLOUD, ("unix", "ubuntu")),
    SkillDef("Nginx", CLOUD),

    # ---- Tools ----
    SkillDef("Git", TOOL, ("github", "gitlab", "version control", "bitbucket")),
    SkillDef("Jira", TOOL),
    SkillDef("Postman", TOOL),
    SkillDef("Figma", TOOL),
    SkillDef("Jupyter", TOOL, ("jupyter notebook", "google colab", "colab")),
    SkillDef("VS Code", TOOL, ("visual studio code",)),
    SkillDef("Selenium", TOOL),
    SkillDef("Jest", TOOL),
    SkillDef("JUnit", TOOL),
    SkillDef("Pytest", TOOL),

    # ---- Data / AI ----
    SkillDef("Machine Learning", DOMAIN, ("ml", "supervised learning", "unsupervised learning")),
    SkillDef("Deep Learning", DOMAIN, ("neural networks", "dl")),
    SkillDef("Natural Language Processing", DOMAIN, ("nlp", "text mining")),
    SkillDef("Computer Vision", DOMAIN, ("cv", "image processing", "opencv")),
    SkillDef("TensorFlow", FRAMEWORK, ("tf", "keras")),
    SkillDef("PyTorch", FRAMEWORK, ("torch",)),
    SkillDef("scikit-learn", FRAMEWORK, ("sklearn", "scikit learn")),
    SkillDef("Pandas", FRAMEWORK),
    SkillDef("NumPy", FRAMEWORK, ("numpy",)),
    SkillDef("Data Analysis", DOMAIN, ("data analytics", "exploratory data analysis", "eda")),
    SkillDef("Data Visualization", DOMAIN, ("data visualisation", "matplotlib", "seaborn", "plotly")),
    SkillDef("Power BI", TOOL, ("powerbi",)),
    SkillDef("Tableau", TOOL),
    SkillDef("Excel", TOOL, ("ms excel", "advanced excel", "pivot tables")),
    SkillDef("Statistics", CS_FUNDAMENTAL, ("statistical analysis", "probability")),
    SkillDef("Big Data", DOMAIN, ("hadoop", "spark", "pyspark", "apache spark")),

    # ---- CS fundamentals ----
    SkillDef("Data Structures", CS_FUNDAMENTAL, ("dsa", "data structure", "ds & algo", "dsa concepts")),
    SkillDef("Algorithms", CS_FUNDAMENTAL, ("algorithm design", "algo")),
    SkillDef("Object Oriented Programming", CS_FUNDAMENTAL, ("oops", "oop", "object-oriented")),
    SkillDef("Operating Systems", CS_FUNDAMENTAL, ("os concepts", "operating system")),
    SkillDef("Computer Networks", CS_FUNDAMENTAL, ("networking", "cn", "tcp/ip")),
    SkillDef("DBMS", CS_FUNDAMENTAL, ("database management system", "rdbms")),
    SkillDef("System Design", CS_FUNDAMENTAL, ("hld", "lld", "low level design", "high level design", "scalability")),
    SkillDef("Software Testing", CS_FUNDAMENTAL, ("unit testing", "qa", "test automation")),
    SkillDef("Agile", CS_FUNDAMENTAL, ("scrum", "kanban", "agile methodology")),
    SkillDef("Cybersecurity", DOMAIN, ("information security", "infosec", "ethical hacking")),

    # ---- Business / domain ----
    SkillDef("Business Analysis", DOMAIN, ("business analyst", "requirement gathering", "brd")),
    SkillDef("Financial Analysis", DOMAIN, ("financial modelling", "financial modeling")),
    SkillDef("Digital Marketing", DOMAIN, ("seo", "sem", "social media marketing")),
    SkillDef("Human Resources", DOMAIN, ("hr operations", "talent acquisition", "recruitment")),
    SkillDef("Project Management", DOMAIN, ("pmp", "project planning")),

    # ---- Soft skills ----
    SkillDef("Communication", SOFT_SKILL, ("verbal communication", "written communication", "presentation skills")),
    SkillDef("Teamwork", SOFT_SKILL, ("collaboration", "team player", "cross-functional")),
    SkillDef("Leadership", SOFT_SKILL, ("team lead", "mentoring", "led a team")),
    SkillDef("Problem Solving", SOFT_SKILL, ("analytical thinking", "critical thinking", "problem-solving")),
    SkillDef("Time Management", SOFT_SKILL, ("prioritization", "prioritisation")),
    SkillDef("Adaptability", SOFT_SKILL, ("flexibility", "quick learner", "fast learner")),
)


def normalise(text: str) -> str:
    """Collapses a skill name to its comparison key: 'Node.js' -> 'nodejs'."""
    return re.sub(r"[^a-z0-9+#]", "", text.lower())


# name -> SkillDef, plus every alias mapped to its canonical definition.
_LOOKUP: dict[str, SkillDef] = {}
for _skill in SKILLS:
    _LOOKUP[normalise(_skill.name)] = _skill
    for _alias in _skill.aliases:
        _LOOKUP.setdefault(normalise(_alias), _skill)


def canonicalise(term: str) -> SkillDef | None:
    """Maps any alias or spelling onto its canonical skill, or None."""
    return _LOOKUP.get(normalise(term))


def _pattern_for(term: str) -> re.Pattern[str]:
    """Word-boundary pattern tolerant of separators inside the term.

    'node.js' matches "node.js", "node js" and "nodejs"; a bare 'r' only
    matches the standalone token, never a letter inside another word.
    """
    escaped = re.escape(term)
    # Allow an optional separator wherever the source term had one.
    flexible = re.sub(r"\\([.\- /])", r"[\\s._/-]*", escaped)
    return re.compile(rf"(?<![a-zA-Z0-9+#]){flexible}(?![a-zA-Z0-9+#])", re.IGNORECASE)


# Pre-compiled so extraction over a large corpus stays fast.
_PATTERNS: list[tuple[SkillDef, re.Pattern[str]]] = []
for _skill in SKILLS:
    for _term in (_skill.name, *_skill.aliases):
        _PATTERNS.append((_skill, _pattern_for(_term)))


def extract_skills(text: str) -> list[SkillDef]:
    """Returns the canonical skills present in `text`, de-duplicated."""
    if not text:
        return []
    found: dict[str, SkillDef] = {}
    for skill, pattern in _PATTERNS:
        key = normalise(skill.name)
        if key in found:
            continue
        if pattern.search(text):
            found[key] = skill
    # Stable ordering keeps output deterministic across runs.
    return [found[k] for k in sorted(found)]


def by_category(skills: list[SkillDef], category: str) -> list[str]:
    return [s.name for s in skills if s.category == category]


ALL_SKILL_NAMES: tuple[str, ...] = tuple(s.name for s in SKILLS)
