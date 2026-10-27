"""Strip web_search_per_day from the seeded plans: web search is deleted

The browsing feature was removed from the product, but 0001_base (history,
never edited) still seeds it into the free plan's features JSON, so every
database created before this item carries a dead quota knob. Fresh installs
run 0001 then this revision, so both paths end up clean.

Revision ID: 0008_drop_web_search_feature
Revises: 0007_drop_response_text
Create Date: 2026-10-23
"""
from alembic import op


revision = "0008_drop_web_search_feature"
down_revision = "0007_drop_response_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Remove the dead key from every plan row that still carries it."""
    op.execute("UPDATE plans SET features = features - 'web_search_per_day' WHERE features ? 'web_search_per_day'")


def downgrade() -> None:
    """Restore the key for plans that ever had it (per-row values are not recoverable).

    to_jsonb() instead of a `::` cast: this statement goes through SQLAlchemy
    text(), where colons are bind-parameter markers.
    """
    op.execute(
        "UPDATE plans SET features = jsonb_set(features, '{web_search_per_day}', to_jsonb(100)) "
        "WHERE NOT features ? 'web_search_per_day'"
    )
