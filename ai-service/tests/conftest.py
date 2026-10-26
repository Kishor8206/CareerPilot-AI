import os
import sys
from pathlib import Path

# Make `app` importable when pytest is run from the repository root.
SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

# Tests must never reach a real provider or touch the developer's vector index.
os.environ.setdefault("AI_PROVIDER", "mock")
os.environ.setdefault("EMBEDDING_PROVIDER", "hash")
os.environ.setdefault("VECTOR_DB_PROVIDER", "numpy")
os.environ.setdefault("AI_SERVICE_INTERNAL_KEY", "test_internal_key")
os.environ.setdefault("LOG_LEVEL", "ERROR")

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def tmp_vector_path(tmp_path_factory):
    path = tmp_path_factory.mktemp("vectorstore")
    os.environ["VECTOR_DB_PATH"] = str(path)
    return path


@pytest.fixture(scope="session")
def client(tmp_vector_path):
    from app.core.config import get_settings

    get_settings.cache_clear()
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def internal_headers():
    return {"X-Internal-Key": os.environ["AI_SERVICE_INTERNAL_KEY"]}


SAMPLE_RESUME = """
PRIYA SHARMA
priya.sharma@example.com | +91 98765 43210 | linkedin.com/in/priyasharma | github.com/priyasharma

CAREER OBJECTIVE
Final-year Computer Science student seeking a software engineering role where I can apply my
full-stack development and machine learning skills.

EDUCATION
B.Tech in Computer Science and Engineering
Anna University, Chennai
2021 - 2025 | CGPA: 8.6/10

Higher Secondary, Kendriya Vidyalaya, 2021 | 92%

TECHNICAL SKILLS
Languages: Python, Java, JavaScript, C++, SQL
Frameworks: React, Node.js, Express.js, Django, TensorFlow
Databases: MongoDB, MySQL, PostgreSQL
Tools: Git, Docker, Postman, Jupyter
Fundamentals: Data Structures, Algorithms, DBMS, Operating Systems, Computer Networks, OOPS

PROJECTS
Placement Portal - Full Stack Web Application
Technologies: React, Node.js, MongoDB, Express.js
Built a placement management portal used by 400 students, reducing manual coordination time by 60%.
Implemented JWT authentication and role-based access control.

Sentiment Analysis Engine
Technologies: Python, TensorFlow, NLP
Developed an LSTM model achieving 89% accuracy on a dataset of 50000 product reviews.

INTERNSHIPS
Software Development Intern
Infosys, Chennai
Jun 2024 - Aug 2024
Developed REST APIs in Spring Boot and optimized database queries, reducing response time from 800ms to 250ms.

CERTIFICATIONS
AWS Certified Cloud Practitioner - Amazon Web Services, 2024
Machine Learning Specialization - Coursera, 2023

ACHIEVEMENTS
Winner, Smart India Hackathon 2024
Solved 400+ problems on LeetCode
"""
