# Planly_Organizer

Planly Organizer is a unified “inbox” that connects Gmail, Google Drive, Outlook, OneDrive, and Canvas and produces clean, readable summaries.

## Quickstart (Demo Mode — no accounts required)

1) Backend env
- `cp backend/.env.example backend/.env`
- Set `DEMO_MODE=true` in `backend/.env`

2) Backend
- `python3 -m venv venv`
- `source venv/bin/activate`
- `pip install -r backend/requirements.txt`
- `cd backend && python3 app.py`

3) Frontend (separate terminal)
- `cd frontend`
- `npm install`
- `npm run dev`

Open the URL printed by the frontend dev server (typically `http://localhost:3000`).

## Connect Real Accounts (optional)
1) Disable demo mode: set `DEMO_MODE=false` (or remove it) in `backend/.env`.
2) Add credentials:
- Google OAuth client: create `backend/credentials.json` using `backend/credentials.example.json` as a template.
- Env vars: fill in `GEMINI_API_KEY`, `MICROSOFT_APP_ID`, `CANVAS_API_TOKEN` in `backend/.env`.

Notes:
- Do not commit `backend/credentials.json` or token/cache files (they are gitignored).
- If you see auth failures, try “Disconnect” then reconnect to force a clean auth flow.
