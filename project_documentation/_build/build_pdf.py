"""Builds the CareerPilot AI documentation PDF from the Markdown sources.

    python project_documentation/_build/build_pdf.py

Reads the files listed in PARTS, writes the combined Markdown and renders it to
PDF with ReportLab. Nothing outside project_documentation/ is touched.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import matplotlib
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, KeepTogether, PageBreak, PageTemplate, Paragraph, Preformatted, Spacer, Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parents[1]
TITLE = "CareerPilot AI"
SUBTITLE = "Complete Technical Project Documentation, Architecture, AI/ML Methodology & Jury Preparation Guide"

# Order of the master document. Paths are relative to project_documentation/.
PARTS = [
    "source/01_overview.md",
    "source/02_architecture.md",
    "source/03_modules.md",
    "source/04_ai_and_training.md",
    "evaluation/metrics_report.md",
    "source/05_quality.md",
    "presentation/demo_script.md",
    "presentation/5_minute_script.md",
    "presentation/10_minute_script.md",
    "viva/100_viva_questions.md",
    "viva/difficult_questions.md",
    "source/06_concepts_and_glossary.md",
    "viva/quick_answers.md",
    "evaluation/factual_validation_report.md",
]

# ---------------------------------------------------------------- fonts
FONT_DIR = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
pdfmetrics.registerFont(TTFont("Body", str(FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Body-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Body-Italic", str(FONT_DIR / "DejaVuSans-Oblique.ttf")))
pdfmetrics.registerFont(TTFont("Body-BoldItalic", str(FONT_DIR / "DejaVuSans-BoldOblique.ttf")))
pdfmetrics.registerFont(TTFont("Mono", str(FONT_DIR / "DejaVuSansMono.ttf")))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body-Italic", boldItalic="Body-BoldItalic")

NAVY = colors.HexColor("#14284B")
BLUE = colors.HexColor("#1D4ED8")
GREY = colors.HexColor("#475569")
LIGHT = colors.HexColor("#F1F5F9")
RULE = colors.HexColor("#CBD5E1")

STATUS = {
    "IMPLEMENTED": "#15803D",
    "PARTIALLY IMPLEMENTED": "#B45309",
    "PARTIAL": "#B45309",
    "PLANNED": "#6D28D9",
    "PLANNED / FUTURE IMPLEMENTATION": "#6D28D9",
    "NOT VERIFIED FROM SOURCE": "#B91C1C",
    "NOT VERIFIED": "#B91C1C",
    "NOT YET MEASURED": "#B91C1C",
    "NOT IMPLEMENTED": "#B91C1C",
    "VERIFIED": "#15803D",
    "MEASURED": "#15803D",
}

S = {
    "body": ParagraphStyle("body", fontName="Body", fontSize=9.4, leading=13.6, textColor=colors.HexColor("#0F172A"), spaceAfter=5),
    "h1": ParagraphStyle("h1", fontName="Body-Bold", fontSize=19, leading=24, textColor=NAVY, spaceBefore=4, spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName="Body-Bold", fontSize=13.5, leading=18, textColor=NAVY, spaceBefore=12, spaceAfter=6),
    "h3": ParagraphStyle("h3", fontName="Body-Bold", fontSize=11, leading=15, textColor=BLUE, spaceBefore=9, spaceAfter=4),
    "h4": ParagraphStyle("h4", fontName="Body-Bold", fontSize=9.8, leading=13.6, textColor=colors.HexColor("#0F172A"), spaceBefore=6, spaceAfter=3),
    "bullet": ParagraphStyle("bullet", fontName="Body", fontSize=9.4, leading=13.2, leftIndent=14, bulletIndent=3, spaceAfter=2.5),
    "bullet2": ParagraphStyle("bullet2", fontName="Body", fontSize=9.2, leading=12.8, leftIndent=28, bulletIndent=17, spaceAfter=2),
    "cell": ParagraphStyle("cell", fontName="Body", fontSize=8, leading=10.6),
    "cellh": ParagraphStyle("cellh", fontName="Body-Bold", fontSize=8, leading=10.6, textColor=colors.white),
    "code": ParagraphStyle("code", fontName="Mono", fontSize=7.4, leading=9.6, textColor=colors.HexColor("#0F172A")),
    "callout": ParagraphStyle("callout", fontName="Body", fontSize=9.2, leading=13.2, textColor=colors.HexColor("#0F172A")),
    "caption": ParagraphStyle("caption", fontName="Body-Italic", fontSize=8.2, leading=11, textColor=GREY, alignment=TA_CENTER, spaceAfter=8),
    "toc0": ParagraphStyle("toc0", fontName="Body-Bold", fontSize=9.6, leading=15, textColor=NAVY),
    "toc1": ParagraphStyle("toc1", fontName="Body", fontSize=8.6, leading=12.2, leftIndent=14, textColor=colors.HexColor("#334155")),
}

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
CONTENT_W = PAGE_W - 2 * MARGIN


# ---------------------------------------------------------------- inline markup
def inline(text: str) -> str:
    """Markdown inline -> ReportLab mini-HTML."""
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    codes: list[str] = []

    def stash(m: re.Match) -> str:
        codes.append(m.group(1))
        return f"\x00{len(codes) - 1}\x00"

    text = re.sub(r"`([^`]+)`", stash, text)
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<font color="#1D4ED8">\1</font>', text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)

    def status(m: re.Match) -> str:
        label = m.group(1)
        return f'<font name="Body-Bold" color="{STATUS[label]}">{label}</font>' if label in STATUS else m.group(0)

    text = re.sub(r"\[([A-Z][A-Z /]+)\]", status, text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![\*\w])\*(?=\S)(.+?)(?<=\S)\*(?!\w)", r"<i>\1</i>", text)
    text = re.sub(
        r"\x00(\d+)\x00",
        lambda m: f'<font name="Mono" size="8" color="#9A3412">{codes[int(m.group(1))]}</font>',
        text,
    )
    return text


def wrap_code(line: str, width: int = 100) -> list[str]:
    out = []
    while len(line) > width:
        out.append(line[:width])
        line = "  " + line[width:]
    out.append(line)
    return out


# ---------------------------------------------------------------- block parsing
class Heading(Paragraph):
    """A paragraph the document registers in the table of contents."""

    def __init__(self, text: str, style: ParagraphStyle, level: int | None, plain: str):
        super().__init__(text, style)
        self.toc_level = level
        self.toc_text = plain


def make_table(rows: list[list[str]]) -> Table:
    ncols = max(len(r) for r in rows)
    rows = [r + [""] * (ncols - len(r)) for r in rows]
    # Column widths follow content length, bounded so no column starves.
    weights = []
    for c in range(ncols):
        longest = max(len(r[c]) for r in rows)
        average = sum(len(r[c]) for r in rows) / len(rows)
        # A column is never narrower than its longest word, so words do not break mid-way.
        word = max((len(w) for r in rows for w in re.split(r"[\s/]+", re.sub(r"[`*\[\]]", "", r[c]))), default=1)
        weights.append(min(60, max(7, min(word, 22) * 1.15, 0.5 * longest ** 0.75 + 0.5 * average)))
    total = sum(weights)
    widths = [CONTENT_W * w / total for w in weights]
    data = [[Paragraph(inline(cell), S["cellh"] if i == 0 else S["cell"]) for cell in row] for i, row in enumerate(rows)]
    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]))
    return table


def boxed(flowables: list, background, bar) -> Table:
    table = Table([[flowables]], colWidths=[CONTENT_W])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("LINEBEFORE", (0, 0), (0, -1), 3, bar),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def parse(markdown: str, base: Path, counters: dict) -> list:
    story: list = []
    lines = markdown.replace("\r\n", "\n").split("\n")
    i = 0
    paragraph: list[str] = []

    def flush() -> None:
        if paragraph:
            text = " ".join(s.strip() for s in paragraph)
            # A question line gets air above it so each Q&A reads as a unit.
            if re.match(r"^\*\*(Q?\d+\.)", text):
                story.append(Spacer(1, 5))
            story.append(Paragraph(inline(text), S["body"]))
            paragraph.clear()

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            flush()
            block: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.extend(wrap_code(lines[i].rstrip()))
                i += 1
            i += 1
            pre = Preformatted("\n".join(block), S["code"])
            story.append(boxed([pre], LIGHT, colors.HexColor("#94A3B8")))
            story.append(Spacer(1, 6))
            continue

        if stripped == "<!-- pagebreak -->":
            flush()
            story.append(PageBreak())
            i += 1
            continue

        heading = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if heading:
            flush()
            level, text = len(heading.group(1)), heading.group(2).strip()
            if level == 1:
                counters["h1"] += 1
                counters["h2"] = 0
                label = f"{counters['h1']}. {text}"
                if story or counters["h1"] > 1:
                    story.append(PageBreak())
                story.append(Heading(inline(label), S["h1"], 0, label))
                story.append(Table([[""]], colWidths=[CONTENT_W], rowHeights=[2], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), BLUE)])))
                story.append(Spacer(1, 8))
            elif level == 2:
                counters["h2"] += 1
                label = f"{counters['h1']}.{counters['h2']} {text}"
                story.append(Heading(inline(label), S["h2"], 1, label))
            elif level == 3:
                story.append(Heading(inline(text), S["h3"], None, text))
            else:
                story.append(Heading(inline(text), S["h4"], None, text))
            i += 1
            continue

        image = re.match(r"^!\[(.*?)\]\((.+?)\)$", stripped)
        if image:
            flush()
            path = (base / image.group(2)).resolve()
            if path.exists():
                img = Image(str(path))
                scale = min(CONTENT_W / img.imageWidth, (PAGE_H - 2 * MARGIN - 70) / img.imageHeight)
                img.drawWidth, img.drawHeight = img.imageWidth * scale, img.imageHeight * scale
                img.hAlign = "CENTER"
                story.append(KeepTogether([img, Paragraph(inline(image.group(1)), S["caption"])]))
            else:
                story.append(Paragraph(inline(f"[missing figure: {image.group(2)}]"), S["body"]))
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\|?\s*:?-{2,}", lines[i + 1].strip()):
            flush()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                row = lines[i].strip()
                if not re.match(r"^\|?[\s:\-|]+\|?$", row):
                    rows.append([c.strip() for c in re.split(r"(?<!\\)\|", row.strip("|"))])
                i += 1
            story.append(make_table(rows))
            story.append(Spacer(1, 7))
            continue

        if stripped.startswith(">"):
            flush()
            quote: list[str] = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip().lstrip(">").strip())
                i += 1
            paras = [Paragraph(inline(p), S["callout"]) for p in " ".join(quote).split("  ") if p.strip()]
            story.append(boxed(paras, colors.HexColor("#EFF6FF"), BLUE))
            story.append(Spacer(1, 7))
            continue

        bullet = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if bullet:
            flush()
            indent, marker, text = len(bullet.group(1)), bullet.group(2), bullet.group(3)
            i += 1
            # Continuation lines belong to the same item.
            while i < len(lines) and lines[i].strip() and not re.match(r"^\s*([-*]|\d+\.)\s+", lines[i]) \
                    and not lines[i].strip().startswith(("#", "|", ">", "```", "![")):
                text += " " + lines[i].strip()
                i += 1
            mark = "•" if marker in "-*" else marker
            story.append(Paragraph(inline(text), S["bullet2" if indent >= 2 else "bullet"], bulletText=mark))
            continue

        if not stripped:
            flush()
            i += 1
            continue

        paragraph.append(line)
        i += 1

    flush()
    return story


# ---------------------------------------------------------------- document
class Doc(BaseDocTemplate):
    def __init__(self, path: str):
        super().__init__(path, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN + 6, bottomMargin=MARGIN + 4,
                         title=f"{TITLE} - Technical Documentation", author="CareerPilot AI project team")
        frame = Frame(MARGIN, MARGIN + 4, CONTENT_W, PAGE_H - 2 * MARGIN - 10, id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[frame], onPage=self.cover),
            PageTemplate(id="main", frames=[frame], onPageEnd=self.decorate),
        ])
        self.chapter = ""

    def cover(self, canvas, _doc) -> None:
        canvas.saveState()
        canvas.setFillColor(NAVY)
        canvas.rect(0, PAGE_H - 118 * mm, PAGE_W, 118 * mm, fill=1, stroke=0)
        canvas.setFillColor(BLUE)
        canvas.rect(0, PAGE_H - 121 * mm, PAGE_W, 3 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Body-Bold", 38)
        canvas.drawString(MARGIN, PAGE_H - 62 * mm, TITLE)
        canvas.setFont("Body", 13)
        y = PAGE_H - 76 * mm
        for part in ("Complete Technical Project Documentation,", "Architecture, AI/ML Methodology", "& Jury Preparation Guide"):
            canvas.drawString(MARGIN, y, part)
            y -= 7 * mm
        canvas.setFillColor(colors.HexColor("#0F172A"))
        canvas.setFont("Body-Bold", 11)
        canvas.drawString(MARGIN, PAGE_H - 140 * mm, "Agentic AI-Based Placement Preparation and Career Intelligence Platform")
        canvas.setFont("Body", 9.5)
        canvas.setFillColor(GREY)
        notes = [
            "Every statement in this document was checked against the project repository.",
            "Each feature carries a status: IMPLEMENTED, PARTIALLY IMPLEMENTED, PLANNED or NOT VERIFIED.",
            "No metric is reported unless it exists in the project's own evaluation files.",
            "",
            "Stack: React + TypeScript  |  Node.js + Express  |  MongoDB  |  Python FastAPI  |  Docker judge",
            "Repository state documented: 8 October 2026",
        ]
        y = PAGE_H - 152 * mm
        for note in notes:
            canvas.drawString(MARGIN, y, note)
            y -= 6 * mm
        canvas.restoreState()

    def decorate(self, canvas, _doc) -> None:
        canvas.saveState()
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN, PAGE_H - MARGIN + 2, PAGE_W - MARGIN, PAGE_H - MARGIN + 2)
        canvas.line(MARGIN, MARGIN - 2, PAGE_W - MARGIN, MARGIN - 2)
        canvas.setFont("Body", 7.6)
        canvas.setFillColor(GREY)
        canvas.drawString(MARGIN, PAGE_H - MARGIN + 6, f"{TITLE} - Technical Documentation")
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - MARGIN + 6, self.chapter[:70])
        canvas.drawString(MARGIN, MARGIN - 11, "Statuses and metrics verified against the repository. Secrets are redacted.")
        canvas.drawRightString(PAGE_W - MARGIN, MARGIN - 11, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    def handle_documentBegin(self) -> None:
        self.chapter = "Contents"
        super().handle_documentBegin()

    def afterFlowable(self, flowable) -> None:
        if isinstance(flowable, Heading) and flowable.toc_level is not None:
            if flowable.toc_level == 0:
                self.chapter = flowable.toc_text
            key = f"h-{abs(hash(flowable.toc_text)) % 10 ** 9}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(flowable.toc_text, key, level=flowable.toc_level, closed=flowable.toc_level == 0)
            self.notify("TOCEntry", (flowable.toc_level, flowable.toc_text, self.page, key))


def main() -> int:
    missing = [p for p in PARTS if not (ROOT / p).exists()]
    if missing:
        print("Missing source files:", missing)
        return 1

    texts = [(ROOT / p).read_text(encoding="utf-8").strip() for p in PARTS]
    master = (
        f"<!-- Generated by _build/build_pdf.py from the files in source/, evaluation/, viva/ and presentation/. -->\n\n"
        f"**{TITLE}** - {SUBTITLE}\n\n" + "\n\n".join(texts) + "\n"
    )
    (ROOT / "CareerPilot_AI_Technical_Documentation.md").write_text(master, encoding="utf-8")

    from reportlab.platypus import NextPageTemplate

    counters = {"h1": 0, "h2": 0}
    toc = TableOfContents()
    toc.levelStyles = [S["toc0"], S["toc1"]]
    story: list = [Spacer(1, 1), NextPageTemplate("main"), PageBreak(), Paragraph("Table of contents", S["h1"]), toc]
    for part, text in zip(PARTS, texts):
        story.extend(parse(text, (ROOT / part).parent, counters))

    out = ROOT / "CareerPilot_AI_Technical_Documentation.pdf"
    doc = Doc(str(out))
    doc.multiBuild(story)
    print(f"Wrote {out}  ({doc.page} pages, {out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
