"""SQLAlchemy models for MySQL database."""
import datetime as dt
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    DECIMAL,
)
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    """User model."""
    __tablename__ = "users"

    id = Column(String(255), primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255))
    avatar_url = Column(Text)
    provider = Column(Enum("google", "github", "email"), nullable=False, index=True)
    provider_id = Column(String(255), index=True)
    password_hash = Column(String(255))
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)
    last_login = Column(DateTime)
    is_active = Column(Boolean, default=True)

    # Relationships
    oauth_tokens = relationship("OAuthToken", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    chat_history = relationship("ChatHistory", back_populates="user", cascade="all, delete-orphan")
    api_usage = relationship("APIUsage", back_populates="user", cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        """Convert user to dictionary."""
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "avatar_url": self.avatar_url,
            "provider": self.provider,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_login": self.last_login.isoformat() if self.last_login else None,
            "is_active": self.is_active,
        }


class OAuthToken(Base):
    """OAuth token model."""
    __tablename__ = "oauth_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(255), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(Enum("google", "github"), nullable=False, index=True)
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text)
    token_type = Column(String(50), default="bearer")
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=dt.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="oauth_tokens")


class Session(Base):
    """Session model."""
    __tablename__ = "sessions"

    id = Column(String(255), primary_key=True)
    user_id = Column(String(255), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, index=True)
    ip_address = Column(String(45))
    user_agent = Column(Text)
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    expires_at = Column(DateTime, nullable=False, index=True)
    is_active = Column(Boolean, default=True)

    # Relationships
    user = relationship("User", back_populates="sessions")


class ChatHistory(Base):
    """Chat history model."""
    __tablename__ = "chat_history"

    id = Column(String(255), primary_key=True)
    user_id = Column(String(255), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(Enum("user", "assistant", "system"), nullable=False)
    content = Column(Text, nullable=False)
    model = Column(String(100))
    tokens_used = Column(Integer)
    cost = Column(DECIMAL(10, 6))
    source = Column(Enum("online", "offline", "cache"), default="online", index=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow, index=True)

    # Relationships
    user = relationship("User", back_populates="chat_history")
    embeddings = relationship("ChatEmbedding", back_populates="chat", cascade="all, delete-orphan")


class ChatEmbedding(Base):
    """Chat embedding model for semantic search."""
    __tablename__ = "chat_embeddings"

    id = Column(String(255), primary_key=True)
    chat_id = Column(String(255), ForeignKey("chat_history.id", ondelete="CASCADE"), nullable=False, index=True)
    query_text = Column(Text, nullable=False)
    # Note: VECTOR type requires MySQL 9.0+ or MariaDB 10.9+
    # For older versions, use BLOB or JSON
    embedding = Column(Text, nullable=False)  # Store as JSON string
    similarity_score = Column(Float)
    created_at = Column(DateTime, default=dt.datetime.utcnow)

    # Relationships
    chat = relationship("ChatHistory", back_populates="embeddings")


class APIUsage(Base):
    """API usage tracking model."""
    __tablename__ = "api_usage"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(255), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(String(255), nullable=False, index=True)
    method = Column(String(10), nullable=False)
    status_code = Column(Integer)
    response_time_ms = Column(Integer)
    tokens_used = Column(Integer)
    cost = Column(DECIMAL(10, 6))
    created_at = Column(DateTime, default=dt.datetime.utcnow, index=True)

    # Relationships
    user = relationship("User", back_populates="api_usage")


class RateLimit(Base):
    """Rate limiting model."""
    __tablename__ = "rate_limits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(255), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(String(255), nullable=False, index=True)
    request_count = Column(Integer, default=1)
    window_start = Column(DateTime, default=dt.datetime.utcnow, index=True)
