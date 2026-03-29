"""
Reusable database helper functions for the Planly Organizer backend.
Each function manages its own session lifecycle (create, commit/rollback, close).
"""

from datetime import datetime, timezone, timedelta
from sqlalchemy import and_
from sqlalchemy.orm import Session

from database import get_session
from models import (
    User,
    ServiceConnection,
    EmailMetadata,
    FileMetadata,
    Summary,
    Classification,
    encrypt_token,
)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def get_or_create_user(email: str, display_name: str | None = None) -> User:
    """Find an existing user by email or create a new one.
    Returns a detached User object (session is closed after this call).
    """
    session: Session = get_session()
    try:
        user = session.query(User).filter(User.email == email).first()
        if user is None:
            user = User(email=email, display_name=display_name)
            session.add(user)
            session.commit()
        elif display_name and not user.display_name:
            user.display_name = display_name
            session.commit()
        # Eagerly load fields before detaching
        user_id = user.id
        user_email = user.email
        user_display = user.display_name
        session.expunge(user)
        return user
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_user_by_email(email: str) -> User | None:
    """Lookup a user by email. Returns None if not found."""
    session: Session = get_session()
    try:
        user = session.query(User).filter(User.email == email).first()
        if user:
            session.expunge(user)
        return user
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Service Connections
# ---------------------------------------------------------------------------

def save_service_connection(
    user_id: int,
    service_type: str,
    tokens: dict,
    account_email: str | None = None,
) -> ServiceConnection:
    """Create or update a service connection for a user.

    Args:
        user_id: The user's database ID.
        service_type: One of 'gmail', 'google_drive', 'outlook', 'onedrive', 'canvas'.
        tokens: Dict with keys 'access_token', 'refresh_token' (optional), 'token_expiry' (optional).
        account_email: The service-specific email (e.g. the Gmail address connected).

    Returns:
        The ServiceConnection record (detached from session).
    """
    session: Session = get_session()
    try:
        conn = (
            session.query(ServiceConnection)
            .filter(
                and_(
                    ServiceConnection.user_id == user_id,
                    ServiceConnection.service_type == service_type,
                    ServiceConnection.account_email == account_email,
                )
            )
            .first()
        )
        if conn is None:
            conn = ServiceConnection(
                user_id=user_id,
                service_type=service_type,
                account_email=account_email,
            )
            session.add(conn)

        conn.set_access_token(tokens.get("access_token"))
        conn.set_refresh_token(tokens.get("refresh_token"))

        expiry = tokens.get("token_expiry")
        if expiry:
            if isinstance(expiry, str):
                expiry = datetime.fromisoformat(expiry)
            conn.token_expiry = expiry

        conn.is_active = True
        session.commit()

        conn_id = conn.id
        session.expunge(conn)
        return conn
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_service_connection(
    user_id: int,
    service_type: str,
    account_email: str | None = None,
) -> ServiceConnection | None:
    """Retrieve a service connection, optionally filtered by account_email."""
    session: Session = get_session()
    try:
        query = session.query(ServiceConnection).filter(
            and_(
                ServiceConnection.user_id == user_id,
                ServiceConnection.service_type == service_type,
                ServiceConnection.is_active == True,
            )
        )
        if account_email is not None:
            query = query.filter(ServiceConnection.account_email == account_email)
        conn = query.first()
        if conn:
            session.expunge(conn)
        return conn
    finally:
        session.close()


def get_service_connection_by_id(connection_id: int) -> ServiceConnection | None:
    """Retrieve a service connection by its primary key."""
    session: Session = get_session()
    try:
        conn = session.query(ServiceConnection).get(connection_id)
        if conn:
            session.expunge(conn)
        return conn
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Email Metadata
# ---------------------------------------------------------------------------

def save_email_metadata(service_connection_id: int, emails_list: list[dict]) -> int:
    """Bulk upsert email metadata. Returns count of records written.

    Each dict in emails_list should have:
        - external_id (required)
        - subject, sender, recipients, received_at, snippet, labels, body_text (optional)
    """
    session: Session = get_session()
    count = 0
    try:
        for email_data in emails_list:
            ext_id = email_data.get("external_id") or email_data.get("id")
            if not ext_id:
                continue

            existing = (
                session.query(EmailMetadata)
                .filter(
                    and_(
                        EmailMetadata.service_connection_id == service_connection_id,
                        EmailMetadata.external_id == str(ext_id),
                    )
                )
                .first()
            )
            if existing is None:
                em = EmailMetadata(
                    service_connection_id=service_connection_id,
                    external_id=str(ext_id),
                    subject=email_data.get("subject"),
                    sender=email_data.get("sender"),
                    recipients=email_data.get("recipients"),
                    received_at=email_data.get("received_at") or email_data.get("date"),
                    snippet=email_data.get("snippet"),
                    labels=email_data.get("labels"),
                    body_text=email_data.get("body_text"),
                )
                session.add(em)
                count += 1
            else:
                # Update fields that might have new data
                if email_data.get("body_text") and not existing.body_text:
                    existing.body_text = email_data["body_text"]
                if email_data.get("subject") and not existing.subject:
                    existing.subject = email_data["subject"]

        session.commit()
        return count
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_cached_emails(
    service_connection_id: int,
    date_range: tuple[datetime, datetime] | None = None,
) -> list[EmailMetadata]:
    """Retrieve cached email metadata for a service connection."""
    session: Session = get_session()
    try:
        query = session.query(EmailMetadata).filter(
            EmailMetadata.service_connection_id == service_connection_id
        )
        if date_range:
            start, end = date_range
            query = query.filter(
                and_(
                    EmailMetadata.received_at >= start,
                    EmailMetadata.received_at <= end,
                )
            )
        results = query.order_by(EmailMetadata.received_at.desc()).all()
        for r in results:
            session.expunge(r)
        return results
    finally:
        session.close()


# ---------------------------------------------------------------------------
# File Metadata
# ---------------------------------------------------------------------------

def save_file_metadata(service_connection_id: int, files_list: list[dict]) -> int:
    """Bulk upsert file metadata. Returns count of records written.

    Each dict in files_list should have:
        - external_id or id (required)
        - name (required)
        - mime_type, file_size, modified_at, parent_folder, content_text (optional)
    """
    session: Session = get_session()
    count = 0
    try:
        for file_data in files_list:
            ext_id = file_data.get("external_id") or file_data.get("id")
            if not ext_id:
                continue

            existing = (
                session.query(FileMetadata)
                .filter(
                    and_(
                        FileMetadata.service_connection_id == service_connection_id,
                        FileMetadata.external_id == str(ext_id),
                    )
                )
                .first()
            )
            if existing is None:
                fm = FileMetadata(
                    service_connection_id=service_connection_id,
                    external_id=str(ext_id),
                    name=file_data.get("name", "Unknown"),
                    mime_type=file_data.get("mime_type") or file_data.get("mimeType"),
                    file_size=file_data.get("file_size"),
                    modified_at=file_data.get("modified_at") or file_data.get("modifiedTime"),
                    parent_folder=file_data.get("parent_folder"),
                    content_text=file_data.get("content_text"),
                )
                session.add(fm)
                count += 1
            else:
                if file_data.get("content_text") and not existing.content_text:
                    existing.content_text = file_data["content_text"]

        session.commit()
        return count
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_cached_files(
    service_connection_id: int,
    date_range: tuple[datetime, datetime] | None = None,
) -> list[FileMetadata]:
    """Retrieve cached file metadata for a service connection."""
    session: Session = get_session()
    try:
        query = session.query(FileMetadata).filter(
            FileMetadata.service_connection_id == service_connection_id
        )
        if date_range:
            start, end = date_range
            query = query.filter(
                and_(
                    FileMetadata.modified_at >= start,
                    FileMetadata.modified_at <= end,
                )
            )
        results = query.order_by(FileMetadata.modified_at.desc()).all()
        for r in results:
            session.expunge(r)
        return results
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------

def save_summary(
    user_id: int,
    source_type: str,
    source_id: str,
    summary_text: str,
    model_used: str | None = None,
) -> Summary:
    """Save a generated summary. Overwrites any existing summary for the same source."""
    session: Session = get_session()
    try:
        existing = (
            session.query(Summary)
            .filter(
                and_(
                    Summary.user_id == user_id,
                    Summary.source_type == source_type,
                    Summary.source_id == str(source_id),
                )
            )
            .first()
        )
        if existing:
            existing.summary_text = summary_text
            existing.model_used = model_used
            existing.created_at = datetime.now(timezone.utc)
            summary = existing
        else:
            summary = Summary(
                user_id=user_id,
                source_type=source_type,
                source_id=str(source_id),
                summary_text=summary_text,
                model_used=model_used,
            )
            session.add(summary)

        session.commit()
        session.expunge(summary)
        return summary
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_cached_summary(source_type: str, source_id: str) -> Summary | None:
    """Retrieve a cached summary by source type and ID. Returns most recent."""
    session: Session = get_session()
    try:
        summary = (
            session.query(Summary)
            .filter(
                and_(
                    Summary.source_type == source_type,
                    Summary.source_id == str(source_id),
                )
            )
            .order_by(Summary.created_at.desc())
            .first()
        )
        if summary:
            session.expunge(summary)
        return summary
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Classifications
# ---------------------------------------------------------------------------

def save_classifications(
    user_id: int,
    source_type: str,
    source_id: str,
    classifications_list: list[dict],
) -> int:
    """Save classification results for sentences.

    Each dict in classifications_list should have:
        - sentence (str)
        - label (int: 0, 1, or 2)
        - confidence (float, optional)
    """
    session: Session = get_session()
    count = 0
    try:
        for cls_data in classifications_list:
            classification = Classification(
                user_id=user_id,
                source_type=source_type,
                source_id=str(source_id),
                sentence=cls_data["sentence"],
                label=cls_data["label"],
                confidence=cls_data.get("confidence"),
            )
            session.add(classification)
            count += 1

        session.commit()
        return count
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_cached_classifications(
    source_type: str,
    source_id: str,
) -> list[Classification]:
    """Retrieve cached classifications for a given source."""
    session: Session = get_session()
    try:
        results = (
            session.query(Classification)
            .filter(
                and_(
                    Classification.source_type == source_type,
                    Classification.source_id == str(source_id),
                )
            )
            .all()
        )
        for r in results:
            session.expunge(r)
        return results
    finally:
        session.close()

def disconnect_service(service_type, account_email=None):
    """Disconnect a service by marking it inactive."""
    session = get_session()
    try:
        query = session.query(ServiceConnection).filter(
            ServiceConnection.service_type == service_type,
            ServiceConnection.is_active == True,
        )
        if account_email:
            query = query.filter(ServiceConnection.account_email == account_email)

        connections = query.all()
        for conn in connections:
            conn.is_active = False
        session.commit()
        return len(connections) > 0
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_connected_services():
    """Get all active service connections."""
    session = get_session()
    try:
        connections = (
            session.query(ServiceConnection)
            .filter(ServiceConnection.is_active == True)
            .all()
        )
        result = []
        for conn in connections:
            result.append({
                'service_type': conn.service_type,
                'account_email': conn.account_email,
                'connected_at': conn.created_at.isoformat() if conn.created_at else None,
            })
        return result
    finally:
        session.close()