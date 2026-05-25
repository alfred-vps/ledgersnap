"""LedgerSnap — Application configuration via environment variables."""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Environment-based configuration. Uses .env file in development."""

    # ── Anthropic ─────────────────────────────
    anthropic_api_key: str = ""

    # ── Server ────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000

    # ── Upload limits ─────────────────────────
    max_upload_size_mb: int = 50
    max_files_per_job: int = 50
    max_pages_per_pdf: int = 20

    # ── Processing ────────────────────────────
    claude_model: str = "claude-sonnet-4-20250514"
    extraction_retries: int = 3

    # ── Paths ─────────────────────────────────
    upload_dir: str = "uploads"
    temp_dir: str = "/tmp/ledgersnap"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
