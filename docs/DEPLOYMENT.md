# Deployment Guide

---

## 1. Local development

```bash
npm install
python -m pip install -r ai-service/requirements.txt
python -m spacy download en_core_web_sm        # optional

cp .env.example .env
npm run seed
cd ai-service && python -m app.ml.train && cd ..

npm run dev
```

Defaults run fully offline: in-memory MongoDB, `AI_PROVIDER=mock`, development-only secrets.

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:5000 |
| AI service | http://localhost:8000/docs |

> **Recommended:** use a Python virtual environment (`python -m venv .venv`) so the AI service's
> dependencies do not collide with other projects.

---

## 2. Docker Compose

```bash
cp .env.example .env
```

Generate four secrets and put them in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `AI_SERVICE_INTERNAL_KEY` — Compose refuses to start
without them.

```bash
docker compose up --build
```

| Service | Address |
|---|---|
| Frontend | http://localhost:8080 |
| API | http://localhost:5000/api/v1 |
| MongoDB | localhost:27017 |
| AI service | internal only — deliberately not published |

Seed and train inside the running containers:

```bash
docker compose exec backend node backend/dist/scripts/seed.js
docker compose exec ai-service python -m app.ml.train
```

---

## 3. Manual production build

```bash
npm ci
npm run build                       # shared → database → backend → frontend

NODE_ENV=production node backend/dist/server.js
# serve frontend/dist with nginx — see docker/nginx.conf

cd ai-service
python -m pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

Use a process manager (systemd, PM2, supervisor) so both services restart on failure.

---

## 4. Production checklist

### Secrets
- [ ] `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `AI_SERVICE_INTERNAL_KEY` are strong, unique and
      **not** the development fallbacks. The server exits at startup if they are missing in production.
- [ ] Secrets come from a secret manager, not a committed file.

### Database
- [ ] `MONGODB_URI` points at a replica set with authentication and TLS.
- [ ] `NODE_ENV=production` — the in-memory fallback is refused in production.
- [ ] Automated backups configured and **restore-tested**.
- [ ] `autoIndex` is disabled in production; create indexes as part of the deploy.

### Storage
- [ ] `STORAGE_PROVIDER=s3`, `npm i @aws-sdk/client-s3`.
- [ ] Bucket is **private**, with server-side encryption and versioning.
- [ ] Lifecycle rules match your configured retention.

### AI
- [ ] `AI_PROVIDER` is a real provider. **Mock output must never reach real users.**
- [ ] The provider's data-processing terms cover resume text and interview transcripts, or you run a local
      model (`AI_PROVIDER=ollama`).
- [ ] `EMBEDDING_PROVIDER=sentence-transformers` and `VECTOR_DB_PROVIDER=chroma` for production RAG quality
      and multi-worker scaling.
- [ ] The ML model is retrained on real outcomes, or its synthetic provenance is clearly communicated.

### Code execution
- [ ] Docker installed on the host that runs the backend, and the judge image built (`npm run judge:build`).
- [ ] `npm run judge:verify` passes **on that host** — it is the only proof that isolation holds there.
- [ ] The judge runs on a dedicated host or VM with no route to your database or internal network.
      Containers are started with `--network none`, but defence in depth matters for untrusted code.
- [ ] Never mount `/var/run/docker.sock` into the backend container: it is root on the host.
      `docker-compose.yml` therefore sets `CODE_EXECUTION_PROVIDER=disabled`; run the backend on the host.
- [ ] See [DSA_JUDGE.md](DSA_JUDGE.md) for limits, configuration and known limitations.

### Real-time
- [ ] A **TURN server** is configured. WebRTC will not traverse restrictive NATs on STUN alone, and campus
      networks are frequently restrictive.
- [ ] TURN credentials are short-lived and issued by the server (already the case in this codebase).
- [ ] Sticky sessions at the load balancer, or a Redis Socket.IO adapter for multiple backend instances.

### Security
- [ ] HTTPS everywhere; HSTS is enabled automatically in production.
- [ ] `CORS_ORIGIN` lists only your real frontend origins.
- [ ] The AI service is reachable **only** from the backend — never from the internet.
- [ ] Rate limits reviewed for your cohort size.

### Privacy and compliance
- [ ] Privacy policy reviewed by your data-protection officer.
- [ ] Retention windows configured under `privacy.retention`.
- [ ] A named person is responsible for reviewing integrity flags, trained on the "not proof of misconduct"
      standard.
- [ ] Account-deletion requests have an owner and an SLA.

### Demo data
- [ ] `DEMO_MODE=false`.
- [ ] Demo accounts removed: `db.users.deleteMany({ isDemoAccount: true })`.
- [ ] Demo catalogue removed or replaced with real, sourced data.

---

## 5. Scaling

### Backend

Stateless apart from Socket.IO room membership, so it scales horizontally.

```bash
npm i @socket.io/redis-adapter redis
```

Then wire the adapter in `src/sockets/index.ts` so rooms work across instances. Without it, two participants
on different instances will not see each other in an interview room.

### AI service

The `numpy` and `faiss` vector stores are in-process, which is why the Dockerfile runs one worker. To scale:

1. `VECTOR_DB_PROVIDER=chroma` with a shared Chroma server
2. Then increase `--workers` or add replicas

CPU-bound work (embeddings, ML inference) benefits from more cores per replica.

### Database

Index coverage is already defined on every model. At scale, watch:

- `PlacementReadiness` — append-only, grows fastest. Consider archiving snapshots older than a year.
- `AIInteraction` and `MonitoringEvent` — high volume; add a TTL index matching your retention policy.
- `AuditLog` — never auto-expire without a compliance decision.

### Frontend

Static assets: put a CDN in front. Hashed filenames are immutable and cached for a year; `index.html` is
explicitly never cached, so a deploy cannot strand users on a stale bundle.

---

## 6. Monitoring

| Endpoint | Use |
|---|---|
| `/health/live` | Liveness probe — touches no dependency |
| `/health` | Readiness probe — 503 when the database is down |
| `/health/db` | Database latency |
| `/health/ai` | AI service reachability |
| `/health/metrics` | Request counts, latency, error rate |

Logs are newline-delimited JSON in production, with `requestId` correlating a request across both services.
Sensitive fields (passwords, tokens, cookies, API keys) are redacted by the logger.

Worth alerting on: `/health` returning 503; AI failure rate above ~10% (visible on the admin dashboard);
p95 latency above 2s (slow requests are logged); unreviewed HIGH-risk attempts accumulating.

---

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Backend exits at startup in production | A required secret is missing. The log names it. |
| "Started an in-memory MongoDB" in production | `NODE_ENV` is not `production`, or `MONGODB_URI` is unset. |
| AI features fail, everything else works | AI service unreachable. Check `/health/ai` and the internal key on both sides. |
| All AI output tagged "mock" | `AI_PROVIDER=mock`, or the configured provider failed to initialise. In development it falls back to mock with a warning; in production it fails loudly instead. |
| Run / Submit say "not executed" | The sandbox is unavailable: Docker is not installed or not running, the judge image is not built (`npm run judge:build`), or `CODE_EXECUTION_PROVIDER=disabled`. `GET /api/v1/coding/sandbox` reports the reason. No score is awarded in this state. |
| Readiness never updates | Check `/health/ai`. Recomputation is best-effort and skipped when the AI service is down. |
| Video connects but no media | No TURN server. STUN alone cannot traverse restrictive NATs. |
| Two participants never see each other | Multiple backend instances without the Redis Socket.IO adapter. |
| Resume upload rejected | The magic-byte check found contents that do not match the declared type. |
| "Cannot overwrite model" in tests | Should not occur — `registerModel` guards this. Check for a direct `mongoose.model()` call. |
| Frontend build: "not exported by shared/dist" | Rebuild shared: `npm run build --workspace shared`. |
