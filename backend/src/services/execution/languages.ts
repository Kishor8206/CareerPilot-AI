import type { DsaLanguageId } from '@careerpilot/shared';

/**
 * Per-language runners: how each language is compiled and started inside the
 * sandbox. To add a language, add an entry here and a generator in codegen.ts.
 *
 * Commands are shell snippets run by the sandbox's runner script. Tool names
 * can be overridden with CP_* variables, which exist so the test suite can
 * point at differently named binaries; production uses the image's defaults.
 */
export interface LanguageRuntime {
  id: DsaLanguageId;
  /** Syntax check or compilation. A non-zero exit is reported as Compilation Error. */
  compileCommand: string;
  runCommand(memoryLimitMb: number): string;
  compileTimeoutMs: number;
  /**
   * Interpreted and JIT-compiled languages get a proportionally longer limit,
   * so one problem limit is fair across languages.
   */
  timeFactor: number;
  /**
   * Memory ceiling of the whole sandbox for this language. Compilers and
   * language runtimes need headroom above the problem's limit; the limit
   * itself is then enforced on the program (see `runCommand`).
   */
  sandboxMemoryMb(memoryLimitMb: number): number;
}

/** Memory a C++ or Java compiler needs, independent of the problem's limit. */
const COMPILER_MEMORY_MB = 512;

export const LANGUAGE_RUNTIMES: Record<DsaLanguageId, LanguageRuntime> = {
  python: {
    id: 'python',
    compileCommand: '"${CP_PYTHON:-python3}" -m py_compile main.py',
    runCommand: () => '"${CP_PYTHON:-python3}" main.py',
    compileTimeoutMs: 10_000,
    timeFactor: 3,
    // CPython has no heap flag, so the sandbox ceiling is the limit itself:
    // exceeding it gets the process killed by the kernel.
    sandboxMemoryMb: (limit) => limit,
  },
  javascript: {
    id: 'javascript',
    compileCommand: '"${CP_NODE:-node}" --check main.js',
    runCommand: (limit) => `"\${CP_NODE:-node}" --max-old-space-size=${limit} main.js`,
    compileTimeoutMs: 10_000,
    timeFactor: 2,
    sandboxMemoryMb: (limit) => limit + 128,
  },
  cpp: {
    id: 'cpp',
    compileCommand: '"${CP_CXX:-g++}" -std=c++17 -O2 -pipe -w -o main main.cpp',
    // The address-space limit makes an over-allocating program fail with
    // std::bad_alloc instead of consuming the compiler's headroom.
    runCommand: (limit) => `ulimit -v ${(limit + 64) * 1024} 2>/dev/null; exec ./main`,
    compileTimeoutMs: 30_000,
    timeFactor: 1,
    sandboxMemoryMb: (limit) => Math.max(limit, COMPILER_MEMORY_MB),
  },
  java: {
    id: 'java',
    compileCommand: '"${CP_JAVAC:-javac}" -encoding UTF-8 -nowarn -J-Xmx256m -J-XX:+UseSerialGC -d . Main.java',
    runCommand: (limit) =>
      `"\${CP_JAVA:-java}" -Xmx${limit}m -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:-UsePerfData -cp . Main`,
    compileTimeoutMs: 30_000,
    timeFactor: 2,
    sandboxMemoryMb: (limit) => Math.max(limit + 256, COMPILER_MEMORY_MB),
  },
};

export function isSupportedLanguage(language: string): language is DsaLanguageId {
  return Object.prototype.hasOwnProperty.call(LANGUAGE_RUNTIMES, language);
}
