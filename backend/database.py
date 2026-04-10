"""
Database engine, session factory, and initialization utilities.
Uses SQLAlchemy 2.0-style with scoped sessions for Flask integration.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session, DeclarativeBase
from config import Config


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""
    pass


def _create_db_engine():
    """Create a SQLAlchemy engine with sensible defaults per DB dialect."""
    database_url = Config.DATABASE_URL

    # SQLite needs different connection options than server DBs.
    if database_url.startswith("sqlite"):
        return create_engine(
            database_url,
            connect_args={"check_same_thread": False},
            echo=False,
        )

    # Server-backed databases (Postgres/MySQL, etc.)
    return create_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        echo=False,
    )


engine = _create_db_engine()

# Session factory
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

# Thread-local scoped session (works well with Flask's per-request lifecycle)
db_session = scoped_session(SessionLocal)


def init_db():
    """Create all tables defined via Base.metadata.
    Useful for quick bootstrapping; prefer Alembic migrations for production.
    """
    import models  # noqa: F401 — ensure models are imported so metadata is populated
    Base.metadata.create_all(bind=engine)


def drop_db():
    """Drop all tables. USE WITH CAUTION — for testing only."""
    import models  # noqa: F401
    Base.metadata.drop_all(bind=engine)


def get_session():
    """Provide a transactional session scope.
    Usage:
        session = get_session()
        try:
            ...
            session.commit()
        except:
            session.rollback()
            raise
        finally:
            session.close()
    """
    return SessionLocal()
