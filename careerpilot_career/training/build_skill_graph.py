"""Validate and compile the prerequisite graph.  ->  skill_graph.json

    python training/build_skill_graph.py        (after build_skill_taxonomy.py)

The graph is what stops a roadmap recommending Deep Learning before Python.
It must therefore be a DAG with no dangling references; this script FAILS
otherwise, naming the cycle or the missing skill.

Outputs a deterministic topological order (a valid global learning order) and
each skill's depth (length of its longest prerequisite chain).
"""
from __future__ import annotations

import sys

from common import KNOWLEDGE, publish, read_json


def main() -> None:
    taxonomy = read_json(KNOWLEDGE / "skill_taxonomy.json")
    prereqs = {s["canonical_skill"]: list(s["prerequisites"]) for s in taxonomy["skills"]}

    missing = sorted({f"{name} -> {p}" for name, ps in prereqs.items() for p in ps if p not in prereqs})
    if missing:
        print("UNKNOWN PREREQUISITES — refusing to build:\n  " + "\n  ".join(missing))
        sys.exit(1)

    # Depth by memoised DFS, detecting cycles with an explicit path.
    depth: dict[str, int] = {}

    def visit(name: str, path: tuple[str, ...]) -> int:
        if name in path:
            cycle = " -> ".join([*path[path.index(name):], name])
            print(f"CYCLE in prerequisite graph — refusing to build:\n  {cycle}")
            sys.exit(1)
        if name not in depth:
            depth[name] = 1 + max((visit(p, (*path, name)) for p in prereqs[name]), default=-1)
        return depth[name]

    for name in prereqs:
        visit(name, ())

    # Depth then name: every prerequisite has a strictly smaller depth, so this is a valid topological order.
    order = sorted(prereqs, key=lambda n: (depth[n], n))
    position = {n: i for i, n in enumerate(order)}
    assert all(position[p] < position[n] for n, ps in prereqs.items() for p in ps)

    edges = [{"from": p, "to": n} for n, ps in sorted(prereqs.items()) for p in ps]
    publish("skill_graph.json", {
        "knowledge_version": taxonomy["knowledge_version"], "edges": edges, "topological_order": order, "depth": depth,
        "stats": {"skills": len(prereqs), "edges": len(edges), "max_depth": max(depth.values()),
                  "roots": sum(1 for ps in prereqs.values() if not ps)},
    })
    deepest = max(depth, key=depth.get)
    chain, cur = [deepest], deepest
    while prereqs[cur]:
        cur = max(prereqs[cur], key=depth.get)
        chain.append(cur)
    print(f"graph: {len(prereqs)} skills, {len(edges)} prerequisite edges, acyclic, max depth {max(depth.values())}")
    print("longest chain: " + " -> ".join(reversed(chain)))


if __name__ == "__main__":
    main()
