"""add saved addresses and cancellation policy

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-11-09 18:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None

refund_policy = sa.Enum("full", "percentage", "none", name="refund_policy")


def upgrade() -> None:
    refund_policy.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "store_settings",
        sa.Column("cancellation_window_hours", sa.Integer(), server_default="24", nullable=False),
    )
    op.add_column(
        "store_settings",
        sa.Column(
            "refund_policy",
            sa.Enum("full", "percentage", "none", name="refund_policy", create_type=False),
            server_default="full",
            nullable=False,
        ),
    )
    op.add_column(
        "store_settings",
        sa.Column("refund_percentage", sa.Integer(), server_default="100", nullable=False),
    )
    op.add_column("store_settings", sa.Column("policy_note", sa.String(length=500), nullable=True))
    op.create_table(
        "addresses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("zone_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=40), nullable=False),
        sa.Column("street", sa.String(length=120), nullable=False),
        sa.Column("building", sa.String(length=40), nullable=False),
        sa.Column("floor", sa.String(length=20), nullable=True),
        sa.Column("apartment", sa.String(length=20), nullable=True),
        sa.Column("landmark", sa.String(length=200), nullable=True),
        sa.Column("is_default", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["zone_id"], ["delivery_zones.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_addresses_id"), "addresses", ["id"])
    op.create_index(op.f("ix_addresses_user_id"), "addresses", ["user_id"])
    op.create_index(op.f("ix_addresses_zone_id"), "addresses", ["zone_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_addresses_zone_id"), table_name="addresses")
    op.drop_index(op.f("ix_addresses_user_id"), table_name="addresses")
    op.drop_index(op.f("ix_addresses_id"), table_name="addresses")
    op.drop_table("addresses")
    op.drop_column("store_settings", "policy_note")
    op.drop_column("store_settings", "refund_percentage")
    op.drop_column("store_settings", "refund_policy")
    op.drop_column("store_settings", "cancellation_window_hours")
    op.execute("DROP TYPE IF EXISTS refund_policy")
