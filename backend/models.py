"""
SQLAlchemy ORM models for the Planly Organizer database.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    Text,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    Enum,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship
from cryptography.fernet import Fernet, InvalidToken
from config import Config
from database import Base


# ---------------------------------------------------------------------------
# Encryption helpers for token storage
# ---------------------------------------------------------------------------

def _get_fernet():
    """Return a Fernet instance if ENCRYPTION_KEY is configured, else None."""
    key = Config.ENCRYPTION_KEY
    if not key:
        return None
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_token(plain_text: str | None) -> str | None:
    """Encrypt a token string. Returns ciphertext or plaintext if no key set."""
    if plain_text is None:
        return None
    fernet = _get_fernet()
    if fernet is None:
        return plain_text
    return fernet.encrypt(plain_text.encode()).decode()


def decrypt_token(cipher_text: str | None) -> str | None:
    """Decrypt a token string. Falls back to returning as-is if decryption fails."""
    if cipher_text is None:
        return None
    fernet = _get_fernet()
    if fernet is None:
        return cipher_text
    try:
        return fernet.decrypt(cipher_text.encode()).decode()
    except (InvalidToken, Exception):
        # Likely stored before encryption was enabled — return as-is
        return cipher_text


# ---------------------------------------------------------------------------
# Enum values (stored as strings for readability)
# ---------------------------------------------------------------------------

SERVICE_TYPE_ENUM = Enum(
    "gmail", "google_drive", "outlook", "onedrive", "canvas",
    name="service_type_enum",
)

SUMMARY_SOURCE_TYPE_ENUM = Enum(
    "email", "file", "email_batch", "canvas_course",
    name="summary_source_type_enum",
)

CLASSIFICATION_SOURCE_TYPE_ENUM = Enum(
    "email", "file",
    name="classification_source_type_enum",
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(320), unique=True, nullable=False, index=True)
    display_name = Column(String(256), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    service_connections = relationship("ServiceConnection", back_populates="user", cascade="all, delete-orphan")
    summaries = relationship("Summary", back_populates="user", cascade="all, delete-orphan")
    classifications = relationship("Classification", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(id={self.id}, email='{self.email}')>"


class ServiceConnection(Base):
    __tablename__ = "service_connections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    service_type = Column(SERVICE_TYPE_ENUM, nullable=False)
    access_token = Column(Text, nullable=True)  # encrypted
    refresh_token = Column(Text, nullable=True)  # encrypted
    token_expiry = Column(DateTime(timezone=True), nullable=True)
    account_email = Column(String(320), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    user = relationship("User", back_populates="service_connections")
    email_metadata = relationship("EmailMetadata", back_populates="service_connection", cascade="all, delete-orphan")
    file_metadata = relationship("FileMetadata", back_populates="service_connection", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("user_id", "service_type", "account_email", name="uq_user_service_account"),
        Index("ix_service_conn_lookup", "user_id", "service_type", "account_email"),
    )

    # --- Token helpers ---
    def set_access_token(self, token: str | None):
        self.access_token = encrypt_token(token)

    def get_access_token(self) -> str | None:
        return decrypt_token(self.access_token)

    def set_refresh_token(self, token: str | None):
        self.refresh_token = encrypt_token(token)

    def get_refresh_token(self) -> str | None:
        return decrypt_token(self.refresh_token)

    def __repr__(self):
        return (
            f"<ServiceConnection(id={self.id}, user_id={self.user_id}, "
            f"service='{self.service_type}', account='{self.account_email}')>"
        )


class EmailMetadata(Base):
    __tablename__ = "email_metadata"

    id = Column(Integer, primary_key=True, autoincrement=True)
    service_connection_id = Column(
        Integer, ForeignKey("service_connections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    external_id = Column(String(512), nullable=False)
    subject = Column(Text, nullable=True)
    sender = Column(Text, nullable=True)
    recipients = Column(Text, nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)
    snippet = Column(Text, nullable=True)
    labels = Column(Text, nullable=True)  # JSON string
    body_text = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    service_connection = relationship("ServiceConnection", back_populates="email_metadata")

    __table_args__ = (
        UniqueConstraint("service_connection_id", "external_id", name="uq_email_per_connection"),
        Index("ix_email_lookup", "service_connection_id", "external_id"),
    )

    def __repr__(self):
        return f"<EmailMetadata(id={self.id}, external_id='{self.external_id}', subject='{self.subject[:40] if self.subject else ''}')>"


class FileMetadata(Base):
    __tablename__ = "file_metadata"

    id = Column(Integer, primary_key=True, autoincrement=True)
    service_connection_id = Column(
        Integer, ForeignKey("service_connections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    external_id = Column(String(512), nullable=False)
    name = Column(Text, nullable=False)
    mime_type = Column(Text, nullable=True)
    file_size = Column(BigInteger, nullable=True)
    modified_at = Column(DateTime(timezone=True), nullable=True)
    parent_folder = Column(Text, nullable=True)
    content_text = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    service_connection = relationship("ServiceConnection", back_populates="file_metadata")

    __table_args__ = (
        UniqueConstraint("service_connection_id", "external_id", name="uq_file_per_connection"),
        Index("ix_file_lookup", "service_connection_id", "external_id"),
    )

    def __repr__(self):
        return f"<FileMetadata(id={self.id}, name='{self.name}')>"


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(SUMMARY_SOURCE_TYPE_ENUM, nullable=False)
    source_id = Column(Text, nullable=False)
    summary_text = Column(Text, nullable=False)
    model_used = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    user = relationship("User", back_populates="summaries")

    __table_args__ = (
        Index("ix_summary_lookup", "source_type", "source_id"),
    )

    def __repr__(self):
        return f"<Summary(id={self.id}, source_type='{self.source_type}', source_id='{self.source_id}')>"


class Classification(Base):
    __tablename__ = "classifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(CLASSIFICATION_SOURCE_TYPE_ENUM, nullable=False)
    source_id = Column(Text, nullable=False)
    sentence = Column(Text, nullable=False)
    label = Column(Integer, nullable=False)  # 0=action_task, 1=important_note, 2=non_task
    confidence = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    user = relationship("User", back_populates="classifications")

    __table_args__ = (
        Index("ix_classification_lookup", "source_type", "source_id"),
    )

    def __repr__(self):
        return f"<Classification(id={self.id}, label={self.label}, source_id='{self.source_id}')>"
