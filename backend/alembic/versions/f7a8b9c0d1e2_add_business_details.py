"""add business details and pickup

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-11-09 21:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

revision = "f7a8b9c0d1e2"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None

COLUMNS = [
    ("business_name", 80),
    ("phone", 30),
    ("whatsapp", 30),
    ("contact_email", 255),
    ("address", 300),
    ("pickup_location", 200),
    ("pickup_instructions", 500),
]


def upgrade() -> None:
    for name, length in COLUMNS:
        op.add_column("store_settings", sa.Column(name, sa.String(length=length), nullable=True))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column("store_settings", name)
