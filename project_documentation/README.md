# CareerPilot AI - project documentation

Generated on 8 October 2026 from an audit of the repository. Nothing in the application source was changed to produce it.

| File | What it is |
|---|---|
| `CareerPilot_AI_Technical_Documentation.pdf` | The complete study document (30 chapters) |
| `CareerPilot_AI_Technical_Documentation.md` | The same content as one Markdown file |
| `diagrams/` | 17 figures as PNG and SVG, each with a Mermaid source (`.mmd`) |
| `evaluation/metrics_report.md` | Every measured number, with its source file, and what is not yet measured |
| `evaluation/factual_validation_report.md` | Verified / partially verified / not verified / planned |
| `viva/100_viva_questions.md` | 104 questions with short, technical and deep answers and the common mistake |
| `viva/difficult_questions.md` | 30 challenge questions with answers to say aloud |
| `viva/quick_answers.md` | Defence guide, cheat sheet, 30-second to 5-minute answers, top 20 reminders |
| `presentation/5_minute_script.md` | Timed five-minute script |
| `presentation/10_minute_script.md` | Ten-minute technical outline |
| `presentation/demo_script.md` | Screen-by-screen demo script |
| `source/` | Chapter sources for the main document |
| `_build/` | `build_diagrams.py` and `build_pdf.py` |

## Rebuild

```bash
python project_documentation/_build/build_diagrams.py
python project_documentation/_build/build_pdf.py
```

Needs Python with `reportlab` and `matplotlib`. Edit the Markdown files, then rebuild.
