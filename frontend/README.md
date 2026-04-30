# Planly Organizer — Frontend

Next.js UI for Planly Organizer: a unified inbox that connects Gmail, Google Drive, Outlook, OneDrive, and Canvas, and produces clean, readable summaries.

## Run Locally (Demo Mode)

1) Start the backend (demo mode — no accounts required)
- From repo root:
  - `cp backend/.env.example backend/.env`
  - Set `DEMO_MODE=true` in `backend/.env`
  - `python3 -m venv venv && source venv/bin/activate`
  - `pip install -r backend/requirements.txt`
  - `cd backend && python app.py`

2) Start the frontend (new terminal)
- `npm install`
- `npm run dev`

Open `http://localhost:3000`.

## How the Frontend Talks to the Backend

This app uses a Next.js rewrite so the UI can call the backend via relative paths:
- Frontend requests: `/backend/<route>`
- Rewritten to: `BACKEND_ORIGIN/<route>` (defaults to `http://localhost:5001`)

That means components should `fetch("/backend/...")` (not hardcode `http://localhost:5001`).

## For Showcase Demos

Recommended flow:
- Start in demo mode for a predictable, offline-friendly walkthrough.
- Optionally connect a real account after the core value is clear (expect OAuth prompts).
