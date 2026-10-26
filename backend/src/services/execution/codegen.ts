import type { DsaLanguageId, DsaParamType, DsaReturnType, DsaSignature } from '@careerpilot/shared';

/**
 * Code generation for the DSA judge.
 *
 * One typed signature produces, for every language:
 *   - the starter code the student sees (they implement only the function);
 *   - the full program the sandbox runs: prelude + student code + a harness
 *     that reads the arguments from stdin, calls the function and writes the
 *     returned value as JSON to RESULT_FILE.
 *
 * Standard output is left entirely to the student's own prints, which is what
 * the Console tab shows. The return value travels through the result file, so
 * debug prints can never be mistaken for an answer.
 *
 * Nothing in this module executes code. It only builds source text.
 *
 * Argument wire format (whitespace-separated tokens, trivial to parse in any
 * language without a JSON library):
 *   int/long/double  the number
 *   bool             1 | 0
 *   string           hex of its UTF-8 bytes, or "-" for the empty string
 *   int[] / ListNode n v1 … vn
 *   string[]         n s1 … sn          (each string hex-encoded)
 *   int[][]          r, then per row: c v1 … vc
 *   TreeNode         n, then n tokens in level order, "N" for a missing child
 */

export const RESULT_FILE = '__result.json';

export interface GeneratedProgram {
  fileName: string;
  source: string;
  /** Number of harness lines placed before the student's first line. */
  userLineOffset: number;
  userLineCount: number;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A linked list or tree: its empty value is null in code and [] in JSON. */
function isNodeType(type: DsaReturnType): boolean {
  return type === 'ListNode' || type === 'TreeNode';
}

export function assertValidSignature(functionName: string, signature: DsaSignature): void {
  if (!IDENTIFIER.test(functionName)) throw new Error(`Invalid function name "${functionName}"`);
  for (const param of signature.params) {
    if (!IDENTIFIER.test(param.name)) throw new Error(`Invalid parameter name "${param.name}"`);
  }
}

/* ------------------------------------------------------------------ */
/* Argument encoding                                                   */
/* ------------------------------------------------------------------ */

function hex(value: string): string {
  return value.length ? Buffer.from(value, 'utf8').toString('hex') : '-';
}

function int(value: unknown, what: string): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${what}: expected an integer`);
  return String(value);
}

function intList(value: unknown, what: string): string {
  if (!Array.isArray(value)) throw new Error(`${what}: expected an array`);
  return [value.length, ...value.map((v) => int(v, what))].join(' ');
}

function encodeValue(type: DsaParamType, value: unknown, what: string): string {
  switch (type) {
    case 'int':
    case 'long':
      return int(value, what);
    case 'double':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${what}: expected a number`);
      return String(value);
    case 'bool':
      if (typeof value !== 'boolean') throw new Error(`${what}: expected a boolean`);
      return value ? '1' : '0';
    case 'string':
      if (typeof value !== 'string') throw new Error(`${what}: expected a string`);
      return hex(value);
    case 'int[]':
    case 'ListNode':
      return intList(value, what);
    case 'string[]':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error(`${what}: expected a string array`);
      return [value.length, ...value.map((v) => hex(v as string))].join(' ');
    case 'int[][]':
      if (!Array.isArray(value)) throw new Error(`${what}: expected a matrix`);
      return [value.length, ...value.map((row) => intList(row, what))].join(' ');
    case 'TreeNode':
      if (!Array.isArray(value)) throw new Error(`${what}: expected a level-order array`);
      return [value.length, ...value.map((v) => (v === null ? 'N' : int(v, what)))].join(' ');
  }
}

/** Serialises one test's arguments into the stdin the harness reads. */
export function encodeArgs(signature: DsaSignature, args: unknown[]): string {
  if (!Array.isArray(args) || args.length !== signature.params.length) {
    throw new Error(`Expected ${signature.params.length} argument(s), got ${Array.isArray(args) ? args.length : 'none'}`);
  }
  return signature.params.map((p, i) => encodeValue(p.type, args[i], p.name)).join('\n') + '\n';
}

/* ------------------------------------------------------------------ */
/* Python                                                              */
/* ------------------------------------------------------------------ */

const PY_TYPES: Record<DsaReturnType, string> = {
  int: 'int', long: 'int', double: 'float', bool: 'bool', string: 'str',
  'int[]': 'List[int]', 'string[]': 'List[str]', 'int[][]': 'List[List[int]]',
  ListNode: 'Optional[ListNode]', TreeNode: 'Optional[TreeNode]',
  'list<int>': 'List[int]', 'list<string>': 'List[str]',
  'list<list<int>>': 'List[List[int]]', 'list<list<string>>': 'List[List[str]]',
};

const PY_READERS: Record<DsaParamType, string> = {
  int: '__cp_int()', long: '__cp_int()', double: '__cp_float()', bool: '__cp_bool()', string: '__cp_str()',
  'int[]': '__cp_ints()', 'string[]': '__cp_strs()', 'int[][]': '__cp_matrix()',
  ListNode: '__cp_list()', TreeNode: '__cp_tree()',
};

const PY_PRELUDE = `import sys, os, json, threading, traceback
from typing import *
import collections, heapq, bisect, math, itertools, functools, string, re
from collections import defaultdict, deque, Counter, OrderedDict
from functools import lru_cache, reduce
from heapq import heappush, heappop, heapify
from bisect import bisect_left, bisect_right
from math import inf, gcd

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
`;

function pythonStarter(fn: string, sig: DsaSignature): string {
  const params = sig.params.map((p) => `${p.name}: ${PY_TYPES[p.type]}`).join(', ');
  return `class Solution:\n    def ${fn}(self, ${params}) -> ${PY_TYPES[sig.returnType]}:\n        pass\n`;
}

function pythonHarness(fn: string, sig: DsaSignature): string {
  const emptyAsList = isNodeType(sig.returnType);
  const reads = sig.params.map((p) => `    __cp_args.append(${PY_READERS[p.type]})`).join('\n');
  return `
def __cp_main():
    __cp_tokens = sys.stdin.read().split()
    __cp_pos = [0]
    def __cp_next():
        __cp_pos[0] += 1
        return __cp_tokens[__cp_pos[0] - 1]
    def __cp_int(): return int(__cp_next())
    def __cp_float(): return float(__cp_next())
    def __cp_bool(): return __cp_next() == '1'
    def __cp_str():
        t = __cp_next()
        return '' if t == '-' else bytes.fromhex(t).decode('utf-8')
    def __cp_ints(): return [__cp_int() for _ in range(__cp_int())]
    def __cp_strs(): return [__cp_str() for _ in range(__cp_int())]
    def __cp_matrix(): return [__cp_ints() for _ in range(__cp_int())]
    def __cp_list():
        dummy = ListNode(); tail = dummy
        for v in __cp_ints():
            tail.next = ListNode(v); tail = tail.next
        return dummy.next
    def __cp_tree():
        n = __cp_int()
        vals = [__cp_next() for _ in range(n)]
        if not vals or vals[0] == 'N': return None
        root = TreeNode(int(vals[0])); queue = deque([root]); i = 1
        while queue and i < n:
            node = queue.popleft()
            if i < n and vals[i] != 'N':
                node.left = TreeNode(int(vals[i])); queue.append(node.left)
            i += 1
            if i < n and vals[i] != 'N':
                node.right = TreeNode(int(vals[i])); queue.append(node.right)
            i += 1
        return root
    def __cp_out(v):
        if isinstance(v, ListNode):
            out = []; steps = 0
            while v is not None and steps < 1000000:
                out.append(v.val); v = v.next; steps += 1
            return out
        if isinstance(v, TreeNode):
            out = []; queue = deque([v])
            while queue and len(out) < 1000000:
                node = queue.popleft()
                if node is None:
                    out.append(None)
                else:
                    out.append(node.val); queue.append(node.left); queue.append(node.right)
            while out and out[-1] is None: out.pop()
            return out
        if isinstance(v, (list, tuple)): return [__cp_out(x) for x in v]
        return v
    __cp_args = []
${reads}
    __cp_result = Solution().${fn}(*__cp_args)
    __cp_value = __cp_out(__cp_result)
    if __cp_value is None and ${emptyAsList ? 'True' : 'False'}: __cp_value = []
    __cp_json = json.dumps(__cp_value, allow_nan=False)
    sys.stdout.flush()
    with open(${JSON.stringify(RESULT_FILE)}, 'w') as __cp_f:
        __cp_f.write(__cp_json)

def __cp_entry():
    try:
        __cp_main()
    except BaseException:
        traceback.print_exc()
        sys.stdout.flush(); sys.stderr.flush()
        os._exit(1)

# Deep recursion is normal in DSA solutions; give it room instead of crashing.
sys.setrecursionlimit(200000)
threading.stack_size(128 * 1024 * 1024)
__cp_thread = threading.Thread(target=__cp_entry)
__cp_thread.start()
__cp_thread.join()
`;
}

/* ------------------------------------------------------------------ */
/* JavaScript                                                          */
/* ------------------------------------------------------------------ */

const JS_TYPES: Record<DsaReturnType, string> = {
  int: 'number', long: 'number', double: 'number', bool: 'boolean', string: 'string',
  'int[]': 'number[]', 'string[]': 'string[]', 'int[][]': 'number[][]',
  ListNode: 'ListNode', TreeNode: 'TreeNode',
  'list<int>': 'number[]', 'list<string>': 'string[]',
  'list<list<int>>': 'number[][]', 'list<list<string>>': 'string[][]',
};

const JS_READERS: Record<DsaParamType, string> = {
  int: 'num()', long: 'num()', double: 'num()', bool: 'bool()', string: 'str()',
  'int[]': 'ints()', 'string[]': 'strs()', 'int[][]': 'matrix()',
  ListNode: 'list()', TreeNode: 'tree()',
};

const JS_PRELUDE = `function ListNode(val, next) {
  this.val = (val === undefined ? 0 : val);
  this.next = (next === undefined ? null : next);
}
function TreeNode(val, left, right) {
  this.val = (val === undefined ? 0 : val);
  this.left = (left === undefined ? null : left);
  this.right = (right === undefined ? null : right);
}
`;

function javascriptStarter(fn: string, sig: DsaSignature): string {
  const doc = sig.params.map((p) => ` * @param {${JS_TYPES[p.type]}} ${p.name}`).join('\n');
  const params = sig.params.map((p) => p.name).join(', ');
  return `/**\n${doc}\n * @return {${JS_TYPES[sig.returnType]}}\n */\nvar ${fn} = function(${params}) {\n    \n};\n`;
}

function javascriptHarness(fn: string, sig: DsaSignature): string {
  const reads = sig.params.map((p) => JS_READERS[p.type]).join(', ');
  return `
;(function () {
  const fs = require('fs');
  const tokens = fs.readFileSync(0, 'utf8').split(/\\s+/).filter(Boolean);
  let pos = 0;
  const next = () => tokens[pos++];
  const num = () => Number(next());
  const bool = () => next() === '1';
  const str = () => { const t = next(); return t === '-' ? '' : Buffer.from(t, 'hex').toString('utf8'); };
  const many = (read) => { const n = num(); const out = []; for (let i = 0; i < n; i++) out.push(read()); return out; };
  const ints = () => many(num);
  const strs = () => many(str);
  const matrix = () => many(ints);
  const list = () => {
    const dummy = new ListNode(); let tail = dummy;
    for (const v of ints()) { tail.next = new ListNode(v); tail = tail.next; }
    return dummy.next;
  };
  const tree = () => {
    const n = num(); const vals = []; for (let i = 0; i < n; i++) vals.push(next());
    if (!vals.length || vals[0] === 'N') return null;
    const root = new TreeNode(Number(vals[0])); const queue = [root]; let head = 0; let i = 1;
    while (head < queue.length && i < n) {
      const node = queue[head++];
      if (i < n && vals[i] !== 'N') { node.left = new TreeNode(Number(vals[i])); queue.push(node.left); }
      i++;
      if (i < n && vals[i] !== 'N') { node.right = new TreeNode(Number(vals[i])); queue.push(node.right); }
      i++;
    }
    return root;
  };
  const out = (v) => {
    if (v instanceof ListNode) {
      const a = []; let steps = 0;
      while (v !== null && v !== undefined && steps++ < 1000000) { a.push(v.val); v = v.next; }
      return a;
    }
    if (v instanceof TreeNode) {
      const a = []; const queue = [v]; let head = 0;
      while (head < queue.length && a.length < 1000000) {
        const node = queue[head++];
        if (node === null || node === undefined) a.push(null);
        else { a.push(node.val); queue.push(node.left); queue.push(node.right); }
      }
      while (a.length && a[a.length - 1] === null) a.pop();
      return a;
    }
    if (Array.isArray(v)) return v.map(out);
    return v === undefined ? null : v;
  };
  if (typeof ${fn} !== 'function') throw new Error('Function "${fn}" is not defined.');
  const result = ${fn}(${reads});
  let value = out(result);
  if (value === null && ${isNodeType(sig.returnType)}) value = [];
  fs.writeFileSync(${JSON.stringify(RESULT_FILE)}, JSON.stringify(value));
})();
`;
}

/* ------------------------------------------------------------------ */
/* C++                                                                 */
/* ------------------------------------------------------------------ */

const CPP_TYPES: Record<DsaReturnType, string> = {
  int: 'int', long: 'long long', double: 'double', bool: 'bool', string: 'string',
  'int[]': 'vector<int>', 'string[]': 'vector<string>', 'int[][]': 'vector<vector<int>>',
  ListNode: 'ListNode*', TreeNode: 'TreeNode*',
  'list<int>': 'vector<int>', 'list<string>': 'vector<string>',
  'list<list<int>>': 'vector<vector<int>>', 'list<list<string>>': 'vector<vector<string>>',
};

const CPP_READERS: Record<DsaParamType, string> = {
  int: 'rInt()', long: 'rLong()', double: 'rDouble()', bool: 'rBool()', string: 'rStr()',
  'int[]': 'rInts()', 'string[]': 'rStrs()', 'int[][]': 'rMatrix()',
  ListNode: 'rList()', TreeNode: 'rTree()',
};

const CPP_PRELUDE = `#include <bits/stdc++.h>
using namespace std;

struct ListNode {
    int val;
    ListNode *next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode *next) : val(x), next(next) {}
};

struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
};
`;

function cppParam(type: DsaParamType, name: string): string {
  const base = CPP_TYPES[type];
  return base.startsWith('vector') ? `${base}& ${name}` : `${base} ${name}`;
}

function cppStarter(fn: string, sig: DsaSignature): string {
  const params = sig.params.map((p) => cppParam(p.type, p.name)).join(', ');
  return `class Solution {\npublic:\n    ${CPP_TYPES[sig.returnType]} ${fn}(${params}) {\n        \n    }\n};\n`;
}

function cppHarness(fn: string, sig: DsaSignature): string {
  const decls = sig.params
    .map((p, i) => `    ${CPP_TYPES[p.type]} a${i} = __cp::${CPP_READERS[p.type]};`)
    .join('\n');
  const call = sig.params.map((_, i) => `a${i}`).join(', ');
  return `
namespace __cp {
    static vector<string> T;
    static size_t P = 0;
    static const string& nx() {
        if (P >= T.size()) { cerr << "judge: malformed test input" << endl; exit(70); }
        return T[P++];
    }
    static int rInt() { return stoi(nx()); }
    static long long rLong() { return stoll(nx()); }
    static double rDouble() { return stod(nx()); }
    static bool rBool() { return nx() == "1"; }
    static string rStr() {
        const string& h = nx();
        string s;
        if (h == "-") return s;
        for (size_t i = 0; i + 1 < h.size(); i += 2) s.push_back((char)stoi(h.substr(i, 2), nullptr, 16));
        return s;
    }
    static vector<int> rInts() { int n = rInt(); vector<int> v(n); for (int i = 0; i < n; i++) v[i] = rInt(); return v; }
    static vector<string> rStrs() { int n = rInt(); vector<string> v(n); for (int i = 0; i < n; i++) v[i] = rStr(); return v; }
    static vector<vector<int>> rMatrix() { int n = rInt(); vector<vector<int>> v(n); for (int i = 0; i < n; i++) v[i] = rInts(); return v; }
    static ListNode* rList() {
        ListNode dummy; ListNode* tail = &dummy;
        for (int v : rInts()) { tail->next = new ListNode(v); tail = tail->next; }
        return dummy.next;
    }
    static TreeNode* rTree() {
        int n = rInt(); vector<string> vals(n);
        for (int i = 0; i < n; i++) vals[i] = nx();
        if (n == 0 || vals[0] == "N") return nullptr;
        TreeNode* root = new TreeNode(stoi(vals[0]));
        queue<TreeNode*> q; q.push(root); int i = 1;
        while (!q.empty() && i < n) {
            TreeNode* node = q.front(); q.pop();
            if (i < n && vals[i] != "N") { node->left = new TreeNode(stoi(vals[i])); q.push(node->left); }
            i++;
            if (i < n && vals[i] != "N") { node->right = new TreeNode(stoi(vals[i])); q.push(node->right); }
            i++;
        }
        return root;
    }
    static void w(ostream& o, int v) { o << v; }
    static void w(ostream& o, long long v) { o << v; }
    static void w(ostream& o, bool v) { o << (v ? "true" : "false"); }
    static void w(ostream& o, double v) {
        if (!isfinite(v)) { o << "null"; return; }
        ostringstream s; s << setprecision(12) << v; o << s.str();
    }
    static void w(ostream& o, const string& s) {
        o << '"';
        for (unsigned char c : s) {
            if (c == '"') o << "\\\\\\"";
            else if (c == '\\\\') o << "\\\\\\\\";
            else if (c == '\\n') o << "\\\\n";
            else if (c == '\\r') o << "\\\\r";
            else if (c == '\\t') o << "\\\\t";
            else if (c < 0x20) { char buf[8]; snprintf(buf, sizeof buf, "\\\\u%04x", c); o << buf; }
            else o << c;
        }
        o << '"';
    }
    static void w(ostream& o, ListNode* h) {
        o << '['; long steps = 0;
        for (; h != nullptr && steps < 1000000; h = h->next, steps++) { if (steps) o << ','; o << h->val; }
        o << ']';
    }
    static void w(ostream& o, TreeNode* r) {
        vector<TreeNode*> order; order.push_back(r);
        for (size_t i = 0; i < order.size() && order.size() < 2000000; i++) {
            if (order[i]) { order.push_back(order[i]->left); order.push_back(order[i]->right); }
        }
        while (!order.empty() && order.back() == nullptr) order.pop_back();
        o << '[';
        for (size_t i = 0; i < order.size(); i++) {
            if (i) o << ',';
            if (order[i]) o << order[i]->val; else o << "null";
        }
        o << ']';
    }
    template <class U> static void w(ostream& o, const vector<U>& v) {
        o << '[';
        for (size_t i = 0; i < v.size(); i++) { if (i) o << ','; w(o, v[i]); }
        o << ']';
    }
}

int main() {
    { string tok; while (cin >> tok) __cp::T.push_back(tok); }
${decls}
    Solution __cp_solution;
    ${CPP_TYPES[sig.returnType]} __cp_result = __cp_solution.${fn}(${call});
    ostringstream __cp_json;
    __cp::w(__cp_json, __cp_result);
    cout.flush(); fflush(stdout);
    ofstream __cp_file(${JSON.stringify(RESULT_FILE)});
    __cp_file << __cp_json.str();
    __cp_file.close();
    return 0;
}
`;
}

/* ------------------------------------------------------------------ */
/* Java                                                                */
/* ------------------------------------------------------------------ */

const JAVA_TYPES: Record<DsaReturnType, string> = {
  int: 'int', long: 'long', double: 'double', bool: 'boolean', string: 'String',
  'int[]': 'int[]', 'string[]': 'String[]', 'int[][]': 'int[][]',
  ListNode: 'ListNode', TreeNode: 'TreeNode',
  'list<int>': 'List<Integer>', 'list<string>': 'List<String>',
  'list<list<int>>': 'List<List<Integer>>', 'list<list<string>>': 'List<List<String>>',
};

const JAVA_READERS: Record<DsaParamType, string> = {
  int: 'rInt()', long: 'rLong()', double: 'rDouble()', bool: 'rBool()', string: 'rStr()',
  'int[]': 'rInts()', 'string[]': 'rStrs()', 'int[][]': 'rMatrix()',
  ListNode: 'rList()', TreeNode: 'rTree()',
};

const JAVA_IMPORTS = `import java.util.*;
import java.util.function.*;
import java.util.stream.*;
import java.io.*;
import java.math.*;
import java.nio.charset.StandardCharsets;
`;

const JAVA_PRELUDE = `
class ListNode {
    int val;
    ListNode next;
    ListNode() {}
    ListNode(int val) { this.val = val; }
    ListNode(int val, ListNode next) { this.val = val; this.next = next; }
}

class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode() {}
    TreeNode(int val) { this.val = val; }
    TreeNode(int val, TreeNode left, TreeNode right) { this.val = val; this.left = left; this.right = right; }
}
`;

function javaStarter(fn: string, sig: DsaSignature): string {
  const params = sig.params.map((p) => `${JAVA_TYPES[p.type]} ${p.name}`).join(', ');
  return `class Solution {\n    public ${JAVA_TYPES[sig.returnType]} ${fn}(${params}) {\n        \n    }\n}\n`;
}

function javaHarness(fn: string, sig: DsaSignature): string {
  const decls = sig.params
    .map((p, i) => `        ${JAVA_TYPES[p.type]} a${i} = ${JAVA_READERS[p.type]};`)
    .join('\n');
  const call = sig.params.map((_, i) => `a${i}`).join(', ');
  return `
public class Main {
    static String[] T = new String[0];
    static int P = 0;
    static String nx() { return T[P++]; }
    static int rInt() { return Integer.parseInt(nx()); }
    static long rLong() { return Long.parseLong(nx()); }
    static double rDouble() { return Double.parseDouble(nx()); }
    static boolean rBool() { return nx().equals("1"); }
    static String rStr() {
        String h = nx();
        if (h.equals("-")) return "";
        byte[] b = new byte[h.length() / 2];
        for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16);
        return new String(b, StandardCharsets.UTF_8);
    }
    static int[] rInts() { int n = rInt(); int[] v = new int[n]; for (int i = 0; i < n; i++) v[i] = rInt(); return v; }
    static String[] rStrs() { int n = rInt(); String[] v = new String[n]; for (int i = 0; i < n; i++) v[i] = rStr(); return v; }
    static int[][] rMatrix() { int n = rInt(); int[][] v = new int[n][]; for (int i = 0; i < n; i++) v[i] = rInts(); return v; }
    static ListNode rList() {
        ListNode dummy = new ListNode(); ListNode tail = dummy;
        for (int v : rInts()) { tail.next = new ListNode(v); tail = tail.next; }
        return dummy.next;
    }
    static TreeNode rTree() {
        int n = rInt(); String[] vals = new String[n];
        for (int i = 0; i < n; i++) vals[i] = nx();
        if (n == 0 || vals[0].equals("N")) return null;
        TreeNode root = new TreeNode(Integer.parseInt(vals[0]));
        ArrayDeque<TreeNode> q = new ArrayDeque<>(); q.add(root); int i = 1;
        while (!q.isEmpty() && i < n) {
            TreeNode node = q.poll();
            if (i < n && !vals[i].equals("N")) { node.left = new TreeNode(Integer.parseInt(vals[i])); q.add(node.left); }
            i++;
            if (i < n && !vals[i].equals("N")) { node.right = new TreeNode(Integer.parseInt(vals[i])); q.add(node.right); }
            i++;
        }
        return root;
    }
    static void quote(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"') sb.append("\\\\\\"");
            else if (c == '\\\\') sb.append("\\\\\\\\");
            else if (c == '\\n') sb.append("\\\\n");
            else if (c == '\\r') sb.append("\\\\r");
            else if (c == '\\t') sb.append("\\\\t");
            else if (c < 0x20) sb.append(String.format("\\\\u%04x", (int) c));
            else sb.append(c);
        }
        sb.append('"');
    }
    static void w(StringBuilder sb, Object v) {
        if (v == null) { sb.append("null"); }
        else if (v instanceof Double || v instanceof Float) {
            double d = ((Number) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) sb.append("null"); else sb.append(d);
        }
        else if (v instanceof Number || v instanceof Boolean) { sb.append(v); }
        else if (v instanceof CharSequence || v instanceof Character) { quote(sb, v.toString()); }
        else if (v instanceof int[]) { int[] a = (int[]) v; sb.append('['); for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(','); sb.append(a[i]); } sb.append(']'); }
        else if (v instanceof long[]) { long[] a = (long[]) v; sb.append('['); for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(','); sb.append(a[i]); } sb.append(']'); }
        else if (v instanceof double[]) { double[] a = (double[]) v; sb.append('['); for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(','); w(sb, a[i]); } sb.append(']'); }
        else if (v instanceof boolean[]) { boolean[] a = (boolean[]) v; sb.append('['); for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(','); sb.append(a[i]); } sb.append(']'); }
        else if (v instanceof Object[]) { Object[] a = (Object[]) v; sb.append('['); for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(','); w(sb, a[i]); } sb.append(']'); }
        else if (v instanceof Collection) { sb.append('['); boolean first = true; for (Object x : (Collection<?>) v) { if (!first) sb.append(','); first = false; w(sb, x); } sb.append(']'); }
        else if (v instanceof ListNode) {
            sb.append('['); int steps = 0;
            for (ListNode h = (ListNode) v; h != null && steps < 1000000; h = h.next, steps++) { if (steps > 0) sb.append(','); sb.append(h.val); }
            sb.append(']');
        }
        else if (v instanceof TreeNode) {
            ArrayList<TreeNode> order = new ArrayList<>(); order.add((TreeNode) v);
            for (int i = 0; i < order.size() && order.size() < 2000000; i++) {
                TreeNode node = order.get(i);
                if (node != null) { order.add(node.left); order.add(node.right); }
            }
            while (!order.isEmpty() && order.get(order.size() - 1) == null) order.remove(order.size() - 1);
            sb.append('[');
            for (int i = 0; i < order.size(); i++) { if (i > 0) sb.append(','); if (order.get(i) == null) sb.append("null"); else sb.append(order.get(i).val); }
            sb.append(']');
        }
        else { quote(sb, v.toString()); }
    }
    static void run() throws Exception {
        String all = new String(System.in.readAllBytes(), StandardCharsets.UTF_8).trim();
        T = all.isEmpty() ? new String[0] : all.split("\\\\s+");
${decls}
        Object result = new Solution().${fn}(${call});
        StringBuilder sb = new StringBuilder();
        if (result == null && ${isNodeType(sig.returnType)}) sb.append("[]"); else w(sb, result);
        System.out.flush();
        try (Writer out = new OutputStreamWriter(new FileOutputStream(${JSON.stringify(RESULT_FILE)}), StandardCharsets.UTF_8)) {
            out.write(sb.toString());
        }
    }
    public static void main(String[] args) throws Exception {
        // A large stack so deep recursion fails on the algorithm, not the default limit.
        Thread t = new Thread(null, () -> {
            try { run(); }
            catch (Throwable e) { System.out.flush(); e.printStackTrace(); System.err.flush(); Runtime.getRuntime().halt(1); }
        }, "judge", 256L * 1024 * 1024);
        t.start();
        t.join();
    }
}
`;
}

/** Moves `import` lines to the top of the file and makes `Solution` package-private, keeping line numbers. */
function prepareJavaUserCode(code: string): { imports: string[]; body: string } {
  const imports: string[] = [];
  const body = code
    .split('\n')
    .map((line) => {
      if (/^\s*import\s+(static\s+)?[\w.]+(\.\*)?\s*;\s*$/.test(line)) {
        imports.push(line.trim());
        return '';
      }
      return line.replace(/\bpublic\s+((?:final\s+)?class\s+Solution\b)/, '$1');
    })
    .join('\n');
  return { imports, body };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function generateStarterCode(functionName: string, signature: DsaSignature, language: DsaLanguageId): string {
  assertValidSignature(functionName, signature);
  switch (language) {
    case 'python': return pythonStarter(functionName, signature);
    case 'javascript': return javascriptStarter(functionName, signature);
    case 'cpp': return cppStarter(functionName, signature);
    case 'java': return javaStarter(functionName, signature);
  }
}

export function generateAllStarterCode(
  functionName: string,
  signature: DsaSignature,
  languages: DsaLanguageId[],
): Record<string, string> {
  return Object.fromEntries(languages.map((l) => [l, generateStarterCode(functionName, signature, l)]));
}

function lineCount(text: string): number {
  return text.split('\n').length;
}

/** Wraps the student's code in the prelude and harness for one language. */
export function buildProgram(
  functionName: string,
  signature: DsaSignature,
  language: DsaLanguageId,
  userCode: string,
): GeneratedProgram {
  assertValidSignature(functionName, signature);
  const code = userCode.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';

  let fileName: string;
  let prelude: string;
  let body = code;
  let harness: string;

  switch (language) {
    case 'python':
      fileName = 'main.py';
      prelude = PY_PRELUDE;
      harness = pythonHarness(functionName, signature);
      break;
    case 'javascript':
      fileName = 'main.js';
      prelude = JS_PRELUDE;
      harness = javascriptHarness(functionName, signature);
      break;
    case 'cpp':
      fileName = 'main.cpp';
      prelude = CPP_PRELUDE;
      harness = cppHarness(functionName, signature);
      break;
    case 'java': {
      const prepared = prepareJavaUserCode(code);
      fileName = 'Main.java';
      prelude = JAVA_IMPORTS + prepared.imports.map((i) => `${i}\n`).join('') + JAVA_PRELUDE;
      body = prepared.body;
      harness = javaHarness(functionName, signature);
      break;
    }
  }

  const head = `${prelude}\n`;
  return {
    fileName,
    source: head + body + harness,
    userLineOffset: lineCount(head) - 1,
    userLineCount: lineCount(body) - 1,
  };
}

const LINE_PATTERNS: Record<DsaLanguageId, RegExp> = {
  python: /(File ".*?main\.py", line )(\d+)/g,
  javascript: /(main\.js:)(\d+)/g,
  cpp: /(main\.cpp:)(\d+)/g,
  java: /(Main\.java:)(\d+)/g,
};

/**
 * Rewrites line numbers in compiler/runtime messages so they point at the
 * student's own code instead of the generated file.
 */
export function remapLineNumbers(text: string, language: DsaLanguageId, program: GeneratedProgram): string {
  return text.replace(LINE_PATTERNS[language], (match, prefix: string, line: string) => {
    const user = Number(line) - program.userLineOffset;
    return user >= 1 && user <= program.userLineCount ? `${prefix}${user}` : match;
  });
}
