"""add per-document summary columns

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-11-27

Additive only: three nullable columns on documents. Existing rows keep their
chunks and embeddings; summaries are filled by the ingest step or the
backfill (python -m ingestion.summaries --missing).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str]] = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("documents", sa.Column("summary_model", sa.String(), nullable=True))
    op.add_column("documents", sa.Column("summary_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "summary_updated_at")
    op.drop_column("documents", "summary_model")
    op.drop_column("documents", "summary")
