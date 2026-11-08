import re
import unicodedata


def slugify(text: str) -> str:
    """ASCII, lowercase, hyphen separated; 'item' if nothing usable is left."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug[:80].strip("-") or "item"
