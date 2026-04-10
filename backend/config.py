"""
Centralized configuration management for the Planly Organizer backend.
All secrets and environment-specific settings are loaded from environment variables
(with fallback to a .env file via python-dotenv).
"""

import os
from dotenv import load_dotenv

# Load .env file if present (development convenience)
load_dotenv()


class Config:
    """Application configuration loaded from environment variables."""

    # --- Database ---
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "sqlite:///planly_organizer.db",
    )

    # --- Google APIs ---
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GOOGLE_CLIENT_SECRET_PATH: str = os.getenv(
        "GOOGLE_CLIENT_SECRET_PATH", "credentials.json"
    )

    # --- Microsoft Graph ---
    MICROSOFT_APP_ID: str = os.getenv(
        "MICROSOFT_APP_ID", ""
    )

    # --- Canvas LMS ---
    CANVAS_API_TOKEN: str = os.getenv("CANVAS_API_TOKEN", "")
    CANVAS_BASE_URL: str = os.getenv("CANVAS_BASE_URL", "https://canvas.ucsc.edu")

    # --- Encryption ---
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "")

    # --- Flask ---
    FLASK_SECRET_KEY: str = os.getenv("FLASK_SECRET_KEY", "dev-secret-change-me")
    FLASK_DEBUG: bool = os.getenv("FLASK_DEBUG", "false").lower() in ("true", "1", "yes")
    FLASK_PORT: int = int(os.getenv("FLASK_PORT", "5001"))

    @classmethod
    def validate(cls) -> list[str]:
        """Return a list of warnings for missing critical configuration."""
        warnings = []
        if not cls.GEMINI_API_KEY:
            warnings.append("GEMINI_API_KEY is not set — Gemini summarization will fail.")
        if not cls.MICROSOFT_APP_ID:
            warnings.append("MICROSOFT_APP_ID is not set — Outlook/OneDrive auth will fail.")
        if not cls.CANVAS_API_TOKEN:
            warnings.append("CANVAS_API_TOKEN is not set — Canvas integration will fail.")
        if not cls.ENCRYPTION_KEY:
            warnings.append(
                "ENCRYPTION_KEY is not set — OAuth tokens will be stored WITHOUT encryption. "
                "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            )
        return warnings
