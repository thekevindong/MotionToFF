"""Extract plain text from uploaded resume / job-description files."""

from __future__ import annotations

import io

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
ALLOWED_MIMES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}


def _ext(filename: str) -> str:
    dot = filename.rfind(".")
    if dot < 0:
        return ""
    return filename[dot:].lower()


def validate_upload(filename: str, mime: str | None, size: int, max_bytes: int) -> None:
    ext = _ext(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"unsupported_file_type:{ext or 'unknown'}")
    if mime and mime not in ALLOWED_MIMES and not mime.startswith("text/"):
        raise ValueError(f"unsupported_mime:{mime}")
    if size <= 0:
        raise ValueError("empty_file")
    if size > max_bytes:
        raise ValueError("file_too_large")


def extract_text(filename: str, content: bytes, mime: str | None = None) -> str:
    ext = _ext(filename)
    if ext == ".txt" or (mime and mime.startswith("text/")):
        return content.decode("utf-8", errors="replace").strip()

    if ext == ".pdf" or mime == "application/pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        parts: list[str] = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text.strip():
                parts.append(text)
        return "\n\n".join(parts).strip()

    if ext == ".docx" or mime == (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        from docx import Document

        doc = Document(io.BytesIO(content))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip()).strip()

    raise ValueError(f"unsupported_file_type:{ext or 'unknown'}")
