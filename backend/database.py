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


# Create engine (pool pre-ping ensures stale connections are recycled)
engine = create_engine(
    Config.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    echo=False,
)

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
