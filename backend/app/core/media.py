from app.config import get_settings


def media_url(storage_key: str) -> str:
    """Public URL of a stored file, computed from the key so a new bucket domain is painless."""
    s = get_settings()
    if s.storage_backend == "r2":
        return f"{s.r2_public_url.rstrip('/')}/{storage_key}"
    return f"{s.public_api_url.rstrip('/')}/media/{storage_key}"
