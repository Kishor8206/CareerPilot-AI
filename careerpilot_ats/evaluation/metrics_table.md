| Model | Mode | MAE | RMSE | Pearson | Spearman | Spearman vs fit label | JSON Validity | Skill F1 | Hallucination |
|---|---|---|---|---|---|---|---|---|---|
| constant_train_mean | GENERAL_ATS | 7.504 | 10.31 | — | — | — | n/a (deterministic) | — | n/a |
| constant_train_mean | JOB_MATCH_ATS | 10.96 | 13.37 | — | — | — | n/a (deterministic) | — | n/a |
| deterministic_production | GENERAL_ATS | 5.177 | 5.974 | 0.941 | 0.873 | — | n/a (deterministic) | — | n/a |
| deterministic_production | JOB_MATCH_ATS | 24.86 | 27.93 | 0.823 | 0.795 | 0.079 | n/a (deterministic) | — | n/a |
| deterministic_heuristic | GENERAL_ATS | — | — | — | — | — | n/a (deterministic) | — | n/a |
| deterministic_heuristic | JOB_MATCH_ATS | 4.048 | 5.134 | 0.948 | 0.942 | 0.227 | n/a (deterministic) | — | n/a |