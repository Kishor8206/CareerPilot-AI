# DSA judge: setup, design and limits

The DSA Practice area runs student code in **Python, C++, Java and JavaScript** and judges it against public
and hidden test cases. This page covers how to switch it on, how it is isolated, and what has and has not been
verified.

## 1. Setup

The judge needs Docker on the machine that runs the **backend**. Nothing else in the platform needs it.

1. Install **Docker Desktop** (Windows/macOS) or Docker Engine (Linux) and start it.
   On Windows 10/11 Home, Docker Desktop uses WSL 2; its installer enables it and asks for a restart.
2. Build the sandbox image (one time, about 1 GB, needs internet):

   ```bash
   npm run judge:build        # docker build -t careerpilot-judge:1 judge
   ```

3. Load the problem bank (idempotent; touches only coding problems):

   ```bash
   npm run seed:dsa
   ```

4. Verify the sandbox **on this machine**:

   ```bash
   npm run judge:verify                               # sample of problems + all isolation checks
   npm run judge:verify --workspace backend -- --all  # every problem in every language
   ```

   It judges the bundled reference solutions through real containers, then runs hostile programs (network
   access, writing to the root filesystem, a fork bomb, memory and CPU exhaustion, reading the environment)
   and checks each one is contained. Exit code 0 means every check passed.

5. Start the app as usual (`npm run dev`). No restart is needed after starting Docker: the backend re-checks
   availability every 20 seconds.

Until steps 1–2 are done, the app still works: problems can be read and code written, and **Run / Submit
report that the code was not executed**. No verdict is invented and no score is recorded.

## 2. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `CODE_EXECUTION_PROVIDER` | `docker` | `docker` runs code in containers. `disabled` never runs code. |
| `CODE_RUNNER_IMAGE` | `careerpilot-judge:1` | Image built from `judge/Dockerfile` |
| `DOCKER_BIN` | `docker` | Path to the Docker CLI if it is not on `PATH` |
| `CODE_RUNNER_CPUS` | `1` | CPU cores per container |
| `CODE_RUNNER_PIDS_LIMIT` | `128` | Maximum processes/threads per container |
| `CODE_RUNNER_MAX_CONCURRENT` | `2` | Containers running at once; further requests queue briefly |

Per-problem limits live on the problem (`timeLimitMs`, default 2000; `memoryLimitMb`, default 128).

## 3. How a submission is judged

```
Browser ── POST /coding/problems/:id/submit { language, code } ──► Node API
                                                                     │  build program = prelude + student code + harness
                                                                     │  encode each test's arguments
                                                                     ▼
                                              docker run (one container per submission)
                                                 compile once ─► for each test:
                                                     host sends input ─► program runs ─► container reports
                                                                     │
                                                                     ▼
                                              judge (on the host): compare with expected ─► verdict
```

- **Run** uses the public tests and stores nothing. **Submit** uses public + hidden tests and stores the result.
- The verdict of a submission is the verdict of its first failing test.
- Verdicts: Accepted, Wrong Answer, Time Limit Exceeded, Memory Limit Exceeded, Runtime Error,
  Compilation Error, Internal Error.
- The AI "Static Code Analysis" is requested after the verdict is final. It cannot change it.

Code lives in `backend/src/services/execution/`:

| File | Role |
|---|---|
| `codegen.ts` | Starter code and harness for each language, argument encoding |
| `languages.ts` | Per-language compile/run commands, time factor, memory strategy |
| `sandbox.ts` | The host ↔ sandbox protocol and the runner script |
| `dockerRunner.ts` | Starts and removes containers; availability check |
| `judge.service.ts` | Comparator and verdict classification |

## 4. Isolation

Every container is started with:

| Setting | Effect |
|---|---|
| `--network none` | No network: no internet, no database, no internal services |
| `--read-only`, tmpfs `/work` and `/tmp` | Nothing persists; the image cannot be modified |
| no volumes or bind mounts | The host filesystem is not visible |
| `--user 65534:65534` | Runs as `nobody`, never root |
| `--cap-drop ALL`, `no-new-privileges` | No Linux capabilities, no privilege escalation |
| `--memory`, `--memory-swap` | Hard memory ceiling, swap disabled |
| `--cpus`, `--pids-limit` | CPU quota; fork bombs are stopped |
| `--ulimit nofile`, `core=0` | Bounded file descriptors, no core dumps |
| no `-e` flags | No host environment variable, so no secret, reaches the container |
| `--rm` plus an explicit `docker rm -f` | The container is removed whatever happens |
| `--pull never` | Only the locally built image is ever run |

The host starts only the `docker` CLI, with a fixed argument list and no shell. Student code is sent over the
container's standard input.

**Hidden tests.** Expected outputs never enter the container; comparison happens on the host. Inputs are
streamed one test at a time, public tests first, so hidden inputs are not present while public tests run.
No API returns hidden inputs or expected outputs; a hidden test appears in a result only as passed/failed,
its status and its timing.

**Time and memory.** The time limit is enforced inside the container and again by the host. Interpreted and
JIT languages get a longer limit: C++ ×1, Java ×2, JavaScript ×2, Python ×3. Memory is enforced per language:
Python by the container ceiling; Java by `-Xmx`; JavaScript by `--max-old-space-size`; C++ by an
address-space limit. C++ and Java containers get a larger ceiling (512 MB) because their compilers need it,
so for those two the problem's limit is enforced on the program rather than by the container.

## 5. What was verified, and where

| Claim | Evidence |
|---|---|
| Harness, runner script, comparator and verdicts are correct for all four languages | `backend/tests/dsa.judge.test.ts`: all 28 reference solutions judged Accepted in Python, C++, Java and JavaScript (112 programs, every public and hidden test), plus Wrong Answer, Runtime Error, Compilation Error and Time Limit Exceeded cases. Run with real compilers through a **test-only local transport**. |
| API behaviour and hidden-test secrecy | `backend/tests/dsa.api.test.ts`: list, filters, problem DTO, Run, Submit, history, progress, sandbox-unavailable path |
| Docker arguments carry every isolation flag and expose nothing | `backend/tests/dsa.judge.test.ts` (argument list only) |
| **Containers actually enforce the isolation** | **Not verified on the development machine: Docker was not installed there.** Run `npm run judge:verify` after installing Docker; it is the proof for your machine. |

The test-only local transport (`backend/tests/support/localTransport.ts`) runs programs as ordinary local
processes with no isolation. It is only ever given code from this repository, lives under `tests/`, is not
imported by the application and cannot be selected by configuration.

Memory Limit Exceeded is covered by classification unit tests and by `judge:verify`, not by a local run:
it depends on the container's memory enforcement.

## 6. Known limitations

- **Docker's default seccomp profile is used**, not a custom one. For hostile public traffic, run the judge on
  a dedicated VM and consider gVisor or a stricter profile. Container isolation is not a VM boundary.
- **One container per submission, tests run one after another.** A program can leave a background process
  behind for later tests of the same submission. It cannot see expected outputs or reach the network, and
  the container is destroyed at the end, but treat hidden-input secrecy as strong rather than absolute.
- **Covert channels** (for example making a hidden test fail on purpose depending on its input) can leak a few
  bits per submission, as on any online judge. Rate limits apply to Run and Submit.
- **Timing is wall-clock** and measured with millisecond resolution; results vary slightly between runs.
- **No custom test input** from the editor yet; Run uses the problem's public tests.
- **`long` values are limited to ±2^53** so that JavaScript and the JSON comparator stay exact.
- **`docker-compose.yml` runs the backend with the judge disabled**, because a containerised backend would
  need the host's Docker socket, which is equivalent to root on the host. Run the backend on the host instead.
- The problem bank is 28 demo problems with hand-written tests; it is not a stress-test suite.

## 7. Adding a problem

Add an entry to `database/seeds/dsaProblems.ts` (signature, public `tests`, `hidden` tests) and a reference
solution per language to `database/seeds/dsaSolutions.ts`, then:

```bash
npm run build --workspace database
npm test --workspace backend -- dsa.judge      # the reference solutions must be Accepted
npm run seed:dsa
```

## 8. Adding a language

Add a generator (starter + harness) in `codegen.ts`, a runtime entry in `languages.ts`, the id in
`shared/src/dsa.ts` (`DSA_LANGUAGES`), and the toolchain in `judge/Dockerfile`. No problem needs to change.
