"""Initial schema — users, service_connections, email/file metadata, summaries, classifications.

Revision ID: 0001
Revises:
Create Date: 2025-01-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Enum types ---
    service_type_enum = sa.Enum(
        "gmail", "google_drive", "outlook", "onedrive", "canvas",
        name="service_type_enum",
    )
    summary_source_type_enum = sa.Enum(
        "email", "file", "email_batch", "canvas_course",
        name="summary_source_type_enum",
    )
    classification_source_type_enum = sa.Enum(
        "email", "file",
        name="classification_source_type_enum",
    )

    # --- users ---
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("display_name", sa.String(256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # --- service_connections ---
    op.create_table(
        "service_connections",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("service_type", service_type_enum, nullable=False),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("token_expiry", sa.DateTime(timezone=True), nullable=True),
        sa.Column("account_email", sa.String(320), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "service_type", "account_email", name="uq_user_service_account"),
    )
    op.create_index("ix_service_conn_lookup", "service_connections", ["user_id", "service_type", "account_email"])

    # --- email_metadata ---
    op.create_table(
        "email_metadata",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("service_connection_id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.String(512), nullable=False),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("sender", sa.Text(), nullable=True),
        sa.Column("recipients", sa.Text(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("snippet", sa.Text(), nullable=True),
        sa.Column("labels", sa.Text(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["service_connection_id"], ["service_connections.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("service_connection_id", "external_id", name="uq_email_per_connection"),
    )
    op.create_index("ix_email_lookup", "email_metadata", ["service_connection_id", "external_id"])

    # --- file_metadata ---
    op.create_table(
        "file_metadata",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("service_connection_id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.String(512), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("modified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("parent_folder", sa.Text(), nullable=True),
        sa.Column("content_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["service_connection_id"], ["service_connections.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("service_connection_id", "external_id", name="uq_file_per_connection"),
    )
    op.create_index("ix_file_lookup", "file_metadata", ["service_connection_id", "external_id"])

    # --- summaries ---
    op.create_table(
        "summaries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("source_type", summary_source_type_enum, nullable=False),
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column("model_used", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_summary_lookup", "summaries", ["source_type", "source_id"])

    # --- classifications ---
    op.create_table(
        "classifications",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("source_type", classification_source_type_enum, nullable=False),
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column("sentence", sa.Text(), nullable=False),
        sa.Column("label", sa.Integer(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_classification_lookup", "classifications", ["source_type", "source_id"])


def downgrade() -> None:
    op.drop_table("classifications")
    op.drop_table("summaries")
    op.drop_table("file_metadata")
    op.drop_table("email_metadata")
    op.drop_table("service_connections")
    op.drop_table("users")

    # Drop enum types
    sa.Enum(name="classification_source_type_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="summary_source_type_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="service_type_enum").drop(op.get_bind(), checkfirst=True)
