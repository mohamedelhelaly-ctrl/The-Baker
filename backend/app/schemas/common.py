import math

from pydantic import BaseModel


class Page[T](BaseModel):
    """Standard list envelope (ARCHITECTURE_OVERVIEW §4)."""

    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int

    @classmethod
    def build(cls, items: list, total: int, page: int, page_size: int) -> "Page":
        return cls(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=max(1, math.ceil(total / page_size)),
        )
