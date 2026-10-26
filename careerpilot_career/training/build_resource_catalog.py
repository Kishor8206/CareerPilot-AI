"""Build and verify the learning-resource catalogue.  ->  resources.json

    python training/build_resource_catalog.py            # build + verify every URL
    python training/build_resource_catalog.py --offline  # build only; everything stays "unverified"

The seed below is a hand-picked list of official documentation, long-standing
free courses and practice platforms. Every entry starts as `unverified`. The
verification service then makes a real request to each one and records what it
found, with a timestamp. Nothing is marked verified by hand.

No ratings are stored: this project has no rating data, and inventing some
would be fabrication. `quality_score` is an editorial weight by resource type
(official documentation 0.9, established free course 0.8, practice platform
0.75) and is labelled as such.
"""
from __future__ import annotations

import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from common import KNOWLEDGE, publish, read_json

from app.career.verification import verify

ALL = ["beginner", "intermediate", "advanced"]
B, BI, IA = ["beginner"], ["beginner", "intermediate"], ["intermediate", "advanced"]
QUALITY = {"documentation": 0.9, "free_course": 0.8, "practice_platform": 0.75, "book": 0.8, "tutorial": 0.7}

# (kind, slug, title, provider, url, skills, difficulty)
D, C, P, K = "documentation", "free_course", "practice_platform", "book"
SEED = [
    (D, "python", "The Python Tutorial", "Python Software Foundation", "https://docs.python.org/3/tutorial/", ["Python"], BI),
    (D, "java", "Learn Java", "Oracle (dev.java)", "https://dev.java/learn/", ["Java", "Object Oriented Programming"], BI),
    (D, "javascript", "JavaScript Guide", "MDN Web Docs", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide", ["JavaScript"], ALL),
    (D, "typescript", "TypeScript Documentation", "Microsoft", "https://www.typescriptlang.org/docs/", ["TypeScript"], ALL),
    (D, "html", "HTML: HyperText Markup Language", "MDN Web Docs", "https://developer.mozilla.org/en-US/docs/Web/HTML", ["HTML"], BI),
    (D, "css", "CSS: Cascading Style Sheets", "MDN Web Docs", "https://developer.mozilla.org/en-US/docs/Web/CSS", ["CSS", "Responsive Design"], ALL),
    (D, "http", "HTTP", "MDN Web Docs", "https://developer.mozilla.org/en-US/docs/Web/HTTP", ["HTTP & Web Fundamentals", "REST API"], BI),
    (D, "react", "Learn React", "React", "https://react.dev/learn", ["React"], ALL),
    (D, "redux", "Redux Documentation", "Redux", "https://redux.js.org/", ["Redux"], IA),
    (D, "nextjs", "Next.js Documentation", "Vercel", "https://nextjs.org/docs", ["Next.js"], IA),
    (D, "angular", "Angular Documentation", "Google", "https://angular.dev/", ["Angular"], ALL),
    (D, "vue", "Vue.js Guide", "Vue.js", "https://vuejs.org/guide/introduction.html", ["Vue.js"], ALL),
    (D, "tailwind", "Tailwind CSS Documentation", "Tailwind Labs", "https://tailwindcss.com/docs", ["Tailwind CSS"], BI),
    (D, "bootstrap", "Bootstrap Documentation", "Bootstrap", "https://getbootstrap.com/docs/", ["Bootstrap"], BI),
    (D, "jest", "Jest: Getting Started", "Jest", "https://jestjs.io/docs/getting-started", ["Jest"], BI),
    (D, "node", "Learn Node.js", "OpenJS Foundation", "https://nodejs.org/en/learn", ["Node.js"], ALL),
    (D, "express", "Express", "OpenJS Foundation", "https://expressjs.com/", ["Express.js", "REST API"], BI),
    (D, "graphql", "Learn GraphQL", "GraphQL Foundation", "https://graphql.org/learn/", ["GraphQL"], BI),
    (D, "django", "Django Documentation", "Django Software Foundation", "https://docs.djangoproject.com/en/stable/", ["Django"], ALL),
    (D, "flask", "Flask Documentation", "Pallets", "https://flask.palletsprojects.com/", ["Flask"], BI),
    (D, "fastapi", "FastAPI Documentation", "FastAPI", "https://fastapi.tiangolo.com/", ["FastAPI", "REST API"], ALL),
    (D, "spring", "Spring Guides", "Spring", "https://spring.io/guides", ["Spring Boot"], ALL),
    (D, "aspnet", "ASP.NET Core Documentation", "Microsoft Learn", "https://learn.microsoft.com/en-us/aspnet/core/", ["ASP.NET"], ALL),
    (D, "laravel", "Laravel Documentation", "Laravel", "https://laravel.com/docs", ["Laravel"], ALL),
    (D, "postgresql", "PostgreSQL Tutorial", "PostgreSQL Global Development Group", "https://www.postgresql.org/docs/current/tutorial.html", ["PostgreSQL", "SQL"], BI),
    (D, "mysql", "MySQL Documentation", "Oracle", "https://dev.mysql.com/doc/", ["MySQL", "SQL"], ALL),
    (D, "mongodb", "MongoDB Documentation", "MongoDB", "https://www.mongodb.com/docs/", ["MongoDB"], ALL),
    (D, "redis", "Redis Documentation", "Redis", "https://redis.io/docs/latest/", ["Redis"], ALL),
    (D, "elasticsearch", "Elastic Documentation", "Elastic", "https://www.elastic.co/docs", ["Elasticsearch"], IA),
    (D, "firebase", "Firebase Documentation", "Google", "https://firebase.google.com/docs", ["Firebase"], BI),
    (K, "git", "Pro Git (book)", "git-scm.com", "https://git-scm.com/book/en/v2", ["Git"], ALL),
    (D, "docker", "Docker: Get Started", "Docker", "https://docs.docker.com/get-started/", ["Docker"], BI),
    (D, "kubernetes", "Kubernetes Tutorials", "Kubernetes", "https://kubernetes.io/docs/tutorials/", ["Kubernetes"], ALL),
    (D, "terraform", "Terraform Tutorials", "HashiCorp", "https://developer.hashicorp.com/terraform/tutorials", ["Terraform"], ALL),
    (D, "ansible", "Ansible Documentation", "Red Hat", "https://docs.ansible.com/", ["Ansible"], ALL),
    (D, "jenkins", "Jenkins User Documentation", "Jenkins", "https://www.jenkins.io/doc/", ["Jenkins", "CI/CD"], ALL),
    (D, "nginx", "nginx Documentation", "nginx", "https://nginx.org/en/docs/", ["Nginx"], ALL),
    (D, "aws", "AWS Documentation", "Amazon Web Services", "https://docs.aws.amazon.com/", ["AWS"], ALL),
    (D, "azure", "Azure Documentation", "Microsoft Learn", "https://learn.microsoft.com/en-us/azure/", ["Azure"], ALL),
    (D, "gcp", "Google Cloud Documentation", "Google Cloud", "https://cloud.google.com/docs", ["Google Cloud"], ALL),
    (D, "numpy", "NumPy: the absolute basics for beginners", "NumPy", "https://numpy.org/doc/stable/user/absolute_beginners.html", ["NumPy"], B),
    (D, "pandas", "pandas: Getting Started", "pandas", "https://pandas.pydata.org/docs/getting_started/index.html", ["Pandas", "Data Analysis"], BI),
    (D, "sklearn", "scikit-learn User Guide", "scikit-learn", "https://scikit-learn.org/stable/user_guide.html", ["scikit-learn", "Machine Learning", "Feature Engineering"], IA),
    (D, "pytorch", "PyTorch Tutorials", "PyTorch", "https://pytorch.org/tutorials/", ["PyTorch", "Deep Learning"], ALL),
    (D, "tensorflow", "TensorFlow Tutorials", "TensorFlow", "https://www.tensorflow.org/tutorials", ["TensorFlow", "Deep Learning"], ALL),
    (D, "jupyter", "Jupyter Documentation", "Project Jupyter", "https://docs.jupyter.org/en/latest/", ["Jupyter"], B),
    (D, "spark", "Apache Spark Documentation", "Apache Software Foundation", "https://spark.apache.org/docs/latest/", ["Big Data"], IA),
    (D, "airflow", "Apache Airflow Documentation", "Apache Software Foundation", "https://airflow.apache.org/docs/", ["Apache Airflow", "ETL & Data Pipelines"], IA),
    (D, "kafka", "Apache Kafka Documentation", "Apache Software Foundation", "https://kafka.apache.org/documentation/", ["Apache Kafka"], IA),
    (D, "kotlin", "Kotlin Documentation", "JetBrains", "https://kotlinlang.org/docs/home.html", ["Kotlin"], ALL),
    (C, "android", "Android Developer Courses", "Google", "https://developer.android.com/courses", ["Android Development", "Kotlin"], BI),
    (D, "swift", "Swift Documentation", "Swift.org", "https://www.swift.org/documentation/", ["Swift", "iOS Development"], ALL),
    (D, "flutter", "Flutter Documentation", "Google", "https://docs.flutter.dev/", ["Flutter"], ALL),
    (D, "reactnative", "React Native: Getting Started", "Meta", "https://reactnative.dev/docs/getting-started", ["React Native"], BI),
    (D, "selenium", "Selenium Documentation", "Selenium", "https://www.selenium.dev/documentation/", ["Selenium", "Software Testing"], ALL),
    (D, "pytest", "pytest Documentation", "pytest", "https://docs.pytest.org/en/stable/", ["Pytest", "Software Testing"], BI),
    (D, "junit", "JUnit User Guide", "JUnit", "https://docs.junit.org/current/user-guide/", ["JUnit"], BI),
    (D, "postman", "Postman Learning Center", "Postman", "https://learning.postman.com/docs/", ["Postman", "REST API"], BI),
    (D, "go", "A Tour of Go", "The Go Authors", "https://go.dev/tour/", ["Go"], B),
    (K, "rust", "The Rust Programming Language (book)", "Rust Project", "https://doc.rust-lang.org/book/", ["Rust"], ALL),
    (D, "csharp", "C# Documentation", "Microsoft Learn", "https://learn.microsoft.com/en-us/dotnet/csharp/", ["C#"], ALL),
    (D, "php", "PHP Manual", "The PHP Group", "https://www.php.net/manual/en/", ["PHP"], ALL),
    (D, "ruby", "Ruby Documentation", "Ruby", "https://www.ruby-lang.org/en/documentation/", ["Ruby"], ALL),
    (D, "scala", "Scala Documentation", "Scala Center", "https://docs.scala-lang.org/", ["Scala"], ALL),
    (D, "owasp", "OWASP Top Ten", "OWASP Foundation", "https://owasp.org/www-project-top-ten/", ["Web Application Security", "Cybersecurity"], BI),
    (D, "powerbi", "Power BI Documentation", "Microsoft Learn", "https://learn.microsoft.com/en-us/power-bi/", ["Power BI", "Data Visualization"], ALL),
    (D, "tableau", "Tableau Help", "Tableau", "https://help.tableau.com/current/pro/desktop/en-us/default.htm", ["Tableau", "Data Visualization"], ALL),
    (D, "figma", "Figma Help Center", "Figma", "https://help.figma.com/", ["Figma"], B),
    (K, "ostep", "Operating Systems: Three Easy Pieces (book)", "Arpaci-Dusseau, University of Wisconsin", "https://pages.cs.wisc.edu/~remzi/OSTEP/", ["Operating Systems"], BI),
    (K, "sysdesign", "The System Design Primer", "GitHub (donnemartin)", "https://github.com/donnemartin/system-design-primer", ["System Design"], IA),
    (C, "cs50", "CS50x: Introduction to Computer Science", "Harvard University", "https://cs50.harvard.edu/x/", ["Programming Fundamentals", "C", "Data Structures", "Algorithms"], B),
    (C, "fcc", "freeCodeCamp Curriculum", "freeCodeCamp", "https://www.freecodecamp.org/learn", ["HTML", "CSS", "JavaScript", "Responsive Design", "Programming Fundamentals"], B),
    (C, "odin", "The Odin Project", "The Odin Project", "https://www.theodinproject.com/", ["HTML", "CSS", "JavaScript", "Git", "Node.js", "React"], BI),
    (C, "fso", "Full Stack Open", "University of Helsinki", "https://fullstackopen.com/en/", ["React", "Node.js", "Express.js", "MongoDB", "REST API", "Authentication & Authorization", "TypeScript"], IA),
    (C, "kaggle", "Kaggle Learn", "Kaggle", "https://www.kaggle.com/learn", ["Python", "Pandas", "Machine Learning", "Data Visualization", "SQL", "Feature Engineering"], BI),
    (C, "mit6006", "MIT 6.006 Introduction to Algorithms", "MIT OpenCourseWare", "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/", ["Algorithms", "Data Structures"], IA),
    (C, "khanstats", "Statistics and Probability", "Khan Academy", "https://www.khanacademy.org/math/statistics-probability", ["Statistics", "A/B Testing"], BI),
    (C, "khanlinalg", "Linear Algebra", "Khan Academy", "https://www.khanacademy.org/math/linear-algebra", ["Linear Algebra"], BI),
    (C, "mlcc", "Machine Learning Crash Course", "Google for Developers", "https://developers.google.com/machine-learning/crash-course", ["Machine Learning"], BI),
    (C, "fastai", "Practical Deep Learning for Coders", "fast.ai", "https://course.fast.ai/", ["Deep Learning", "Computer Vision", "Natural Language Processing"], IA),
    (C, "hfnlp", "Hugging Face LLM Course", "Hugging Face", "https://huggingface.co/learn/llm-course/chapter1/1", ["Natural Language Processing", "LLM Applications"], IA),
    (C, "mslearn", "Microsoft Learn Training", "Microsoft Learn", "https://learn.microsoft.com/en-us/training/", ["Azure", "C#", "Power BI"], BI),
    (P, "leetcode", "LeetCode Problem Set", "LeetCode", "https://leetcode.com/problemset/", ["DSA Problem Solving", "Algorithms", "Data Structures"], ALL),
    (P, "hackerrank", "HackerRank Practice", "HackerRank", "https://www.hackerrank.com/domains", ["DSA Problem Solving", "SQL", "Programming Fundamentals"], BI),
    (P, "sqlbolt", "SQLBolt: Interactive SQL Lessons", "SQLBolt", "https://sqlbolt.com/", ["SQL", "DBMS"], B),
    (P, "exercism", "Exercism Language Tracks", "Exercism", "https://exercism.org/tracks", ["Programming Fundamentals", "Python", "Java", "JavaScript", "Go", "Rust", "C++"], BI),
    (P, "frontendmentor", "Frontend Mentor Challenges", "Frontend Mentor", "https://www.frontendmentor.io/challenges", ["HTML", "CSS", "Responsive Design", "React"], BI),
    (P, "gitbranching", "Learn Git Branching", "learngitbranching.js.org", "https://learngitbranching.js.org/", ["Git"], B),
    (P, "overthewire", "OverTheWire Wargames", "OverTheWire", "https://overthewire.org/wargames/", ["Linux", "Shell Scripting", "Cybersecurity"], BI),
    (P, "tryhackme", "TryHackMe", "TryHackMe", "https://tryhackme.com/", ["Cybersecurity", "Network Security", "Penetration Testing", "Incident Response"], BI),
]

PREFIX = {D: "docs", C: "course", P: "practice", K: "book"}


def main() -> None:
    offline = "--offline" in sys.argv
    taxonomy = read_json(KNOWLEDGE / "skill_taxonomy.json")
    skills = {s["canonical_skill"]: s for s in taxonomy["skills"]}

    resources, errors, seen = [], [], Counter()
    for kind, slug, title, provider, url, skill_ids, difficulty in SEED:
        for s in skill_ids:
            if s not in skills:
                errors.append(f"{slug}: unknown skill '{s}'")
        seen[slug] += 1
        host = urlparse(url).hostname or ""
        domain = ".".join(host.split(".")[-2:]) if not host.endswith((".ac.uk", ".co.uk")) else ".".join(host.split(".")[-3:])
        resources.append({
            "resource_id": f"{PREFIX[kind]}_{slug}_{seen[slug]:03d}", "title": title, "provider": provider,
            "resource_type": kind, "url": url, "allowed_domains": [domain], "skill_ids": skill_ids,
            "difficulty": difficulty, "language": "en", "duration": None, "rating": None,
            "quality_score": QUALITY[kind], "quality_score_basis": "editorial weight by resource type",
            "verification_status": "unverified", "last_verified": None, "verification_detail": None,
        })
    if errors or len({r["resource_id"] for r in resources}) != len(resources):
        print("CATALOGUE ERRORS:\n  " + "\n  ".join(errors or ["duplicate resource_id"]))
        sys.exit(1)

    if not offline:
        def check(r: dict) -> dict:
            terms = []
            for s in r["skill_ids"]:
                terms += [s, *skills[s]["aliases"]]
            terms += [w for w in re.split(r"\W+", r["title"]) if len(w) > 3]
            return verify(r, terms)

        with ThreadPoolExecutor(max_workers=8) as pool:
            for r, result in zip(resources, pool.map(check, resources)):
                r.update({k: result[k] for k in ("verification_status", "last_verified", "verification_detail")})
                r["page_title"] = result.get("page_title")

    # Keep YouTube entries added by fetch_youtube_resources.py: rebuilding the seed must not discard them.
    existing = KNOWLEDGE / "resources.json"
    if existing.exists():
        resources += [r for r in read_json(existing)["resources"] if r["resource_type"] == "youtube_video"]

    status = Counter(r["verification_status"] for r in resources)
    covered = {s for r in resources if r["verification_status"] in ("verified", "reachable") for s in r["skill_ids"]}
    publish("resources.json", {"knowledge_version": taxonomy["knowledge_version"], "resources": resources,
                               "summary": {"total": len(resources), "by_status": dict(status),
                                           "skills_with_a_usable_resource": len(covered), "skills_total": len(skills)}})
    print(f"resources: {len(resources)} | status: {dict(status)}")
    print(f"skills with at least one usable resource: {len(covered)}/{len(skills)}")
    for r in resources:
        if r["verification_status"] not in ("verified", "reachable"):
            print(f"  NOT USABLE {r['resource_id']}: {r['verification_status']} — {r['verification_detail']}")
    missing = sorted(set(skills) - covered - {s for s, v in skills.items() if v["category"] == "SOFT"})
    print(f"skills without a resource ({len(missing)}): {', '.join(missing)}")


if __name__ == "__main__":
    main()
