"""Validate and normalise uploaded photos: real image, sane size, EXIF stripped, WebP output."""

import asyncio
import io
import uuid

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.errors import ApiError

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_SIDE = 1600
Image.MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard: larger images raise


def _process(data: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(data)) as probe:  # checks magic bytes, not the file extension
            if probe.format not in ALLOWED_FORMATS:
                raise ApiError(422, "invalid_image", "Please upload a JPEG, PNG or WebP image.")
            probe.verify()
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)  # honour rotation before the EXIF is dropped
            if img.mode in ("RGBA", "LA", "P"):
                rgba = img.convert("RGBA")
                flat = Image.new("RGB", rgba.size, (255, 255, 255))
                flat.paste(rgba, mask=rgba.split()[-1])
                img = flat
            else:
                img = img.convert("RGB")
            img.thumbnail((MAX_SIDE, MAX_SIDE))
            out = io.BytesIO()
            img.save(out, format="WEBP", quality=85)  # re-encoding drops metadata
            return out.getvalue()
    except ApiError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError):
        raise ApiError(422, "invalid_image", "That file is not a valid image.") from None


async def process_image(data: bytes) -> bytes:
    return await asyncio.to_thread(_process, data)


def new_image_key(product_id: int) -> str:
    return f"products/{product_id}/{uuid.uuid4().hex}.webp"
