# CareerPilot AI - DSA judge sandbox image.
#
# Every submission runs in a fresh, throw-away container started from this
# image with no network, a read-only root filesystem, no capabilities and hard
# memory/CPU/process limits (see backend/src/services/execution/dockerRunner.ts).
# The image holds only the toolchains; no application code, no credentials.
#
# Build:  npm run judge:build      (docker build -t careerpilot-judge:1 judge)
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      g++ \
      default-jdk-headless \
      nodejs \
      python3 \
      time \
      coreutils \
 && rm -rf /var/lib/apt/lists/*

# The container never needs to become another user: strip setuid/setgid bits.
RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null; exit 0

# "nobody". The runner also passes --user explicitly; this is the fallback.
USER 65534:65534
WORKDIR /work
ENV HOME=/tmp LANG=C.UTF-8

CMD ["sh"]
