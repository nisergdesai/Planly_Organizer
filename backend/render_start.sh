#!/usr/bin/env bash
set -euo pipefail

HOST="${FLASK_HOST:-0.0.0.0}"
PORT="${PORT:-${FLASK_PORT:-5001}}"

echo "Starting Planly backend with gunicorn on ${HOST}:${PORT}"

exec gunicorn app:app \
  --bind "${HOST}:${PORT}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --threads "${GUNICORN_THREADS:-2}" \
  --timeout "${GUNICORN_TIMEOUT:-120}"

