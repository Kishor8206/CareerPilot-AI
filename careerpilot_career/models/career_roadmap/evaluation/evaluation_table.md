| Metric | finetuned (all) | finetuned (in_distribution) | finetuned (held_out_roles) | base (all) | base (in_distribution) |
|---|---|---|---|---|---|
| n | 60 | 30 | 30 | 8 | 8 |
| 1_json_validity | 0.5167 | 0.5333 | 0.5 | 0.875 | 0.875 |
| 2_schema_compliance | 0.0667 | 0.0667 | 0.0667 | 0.0 | 0.0 |
| 3_skill_gap_f1 | 0.4 | 0.0 | 0.5882 | — | — |
| 4_priority_agreement | 1.0 | — | 1.0 | — | — |
| 5_prerequisite_correctness | 0.75 | 1.0 | 0.5 | — | — |
| 6_roadmap_ordering | 0.0 | 0.0 | 0.0 | — | — |
| 7_role_alignment | 1.0 | 1.0 | 1.0 | — | — |
| 8_personalisation | 0.5 | 0.5 | 0.5 | — | — |
| 9_study_plan_feasibility | 0.0 | 0.0 | 0.0 | — | — |
| 10_resource_id_validity | 1.0 | — | 1.0 | — | — |
| 11_resource_hallucination | 0.0 | — | 0.0 | — | — |
| 12_contradiction_rate | 0.5 | 0.5 | 0.5 | — | — |
| 13_duplicate_rate | 0.0 | 0.0 | 0.0 | — | — |
| fully_valid_without_repair | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |