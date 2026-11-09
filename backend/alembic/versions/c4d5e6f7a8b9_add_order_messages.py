"""add order messages

Revision ID: c4d5e6f7a8b9
Revises: 37fc671c0324
Create Date: 2026-11-09 10:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

revision = "c4d5e6f7a8b9"
down_revision = "37fc671c0324"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "order_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("author_user_id", sa.Integer(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_order_messages_author_user_id"), "order_messages", ["author_user_id"])
    op.create_index(op.f("ix_order_messages_id"), "order_messages", ["id"])
    op.create_index(op.f("ix_order_messages_order_id"), "order_messages", ["order_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_order_messages_order_id"), table_name="order_messages")
    op.drop_index(op.f("ix_order_messages_id"), table_name="order_messages")
    op.drop_index(op.f("ix_order_messages_author_user_id"), table_name="order_messages")
    op.drop_table("order_messages")
