import re


_BR_RE = re.compile(r"(?i)<br\s*/?>")
_HTML_TAG_RE = re.compile(r"</?[^>]+>")


def clean_summary_text(text: str | None) -> str:
    """
    Normalize summary text to plain text for UI display.

    - Converts <br> tags to newlines.
    - Converts Markdown-style bullet lines ("* item") to "• item" without
      breaking Markdown emphasis/bold markers inside lines.
    - Strips other HTML tags (best-effort).
    - Normalizes excessive whitespace/newlines.
    """
    if not text:
        return ""

    cleaned = text.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = _BR_RE.sub("\n", cleaned)

    # Convert bullets only at the start of a line to avoid corrupting Markdown
    # like "**bold**" (which contains "* ").
    cleaned = re.sub(r"(?m)^\*\s+", "• ", cleaned)

    # Best-effort strip remaining HTML tags.
    cleaned = _HTML_TAG_RE.sub("", cleaned)

    # Normalize whitespace.
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

