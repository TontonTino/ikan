"""
Modèle StripeEventTraite — idempotence des événements webhook Stripe déjà traités.
"""
from datetime import datetime

from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class StripeEventTraite(Base):
    __tablename__ = "stripe_events_traites"

    event_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    traite_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def __repr__(self) -> str:
        return f"<StripeEventTraite {self.event_id}>"
