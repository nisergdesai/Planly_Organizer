# Planly Organizer — Credential Setup Guide

This guide explains how to obtain each credential required by the backend.

---

## 1. Google Gemini API Key

Used for AI-powered summarization of emails, drive files, and OneDrive content.

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **Create API Key**
4. Copy the key and set it in your `.env` file:
   ```
   GEMINI_API_KEY=AIza...
   ```

---

## 2. Google OAuth Client Credentials (`credentials.json`)

Used for Gmail and Google Drive authentication.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth client ID**
5. Choose **Desktop app** as the application type
6. Download the JSON file and save it as `backend/credentials.json`
7. Enable the following APIs in **APIs & Services → Library**:
   - Gmail API
   - Google Drive API
   - Google Docs API
   - Google Sheets API
   - Google Slides API

---

## 3. Google Cloud Vision Service Account (`ServiceAccountToken.json`)

Used for OCR / text detection from images in Google Drive.

1. In [Google Cloud Console](https://console.cloud.google.com/), go to **APIs & Services → Credentials**
2. Click **Create Credentials → Service account**
3. Name the service account and grant it the **Cloud Vision API User** role
4. Go to the service account's **Keys** tab and click **Add Key → Create new key → JSON**
5. Download the JSON file and save it as `backend/ServiceAccountToken.json`
6. Enable the **Cloud Vision API** in **APIs & Services → Library**

---

## 4. Canvas LMS API Token

Used for fetching courses, syllabi, assignments, and announcements.

1. Log in to your Canvas LMS instance (e.g., `https://canvas.ucsc.edu`)
2. Go to **Account → Settings**
3. Scroll to **Approved Integrations** and click **+ New Access Token**
4. Enter a purpose (e.g., "Planly Organizer") and optionally set an expiry
5. Copy the token and set it in your `.env` file:
   ```
   CANVAS_API_TOKEN=9270~...
   ```
6. If your Canvas instance is not `canvas.ucsc.edu`, also set:
   ```
   CANVAS_BASE_URL=https://your-canvas-instance.edu
   ```

---

## 5. Microsoft Azure AD App ID

Used for Outlook email and OneDrive file access via Microsoft Graph API.

For demos/reviewers: you can use the default `MICROSOFT_APP_ID` already present
in `backend/.env.example` (it’s a public client id, not a secret).

1. Go to [Azure App Registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Set the name (e.g., "Planly Organizer")
4. Under **Supported account types**, choose **Accounts in any organizational directory and personal Microsoft accounts**
5. Set **Redirect URI** to `http://localhost` (type: Mobile and desktop applications)
6. Click **Register**
7. Copy the **Application (client) ID** and set it in your `.env` file:
   ```
   MICROSOFT_APP_ID=edf0be76-...
   ```
8. Under **API permissions**, add:
   - `Mail.Read`
   - `Files.Read`
   - `Notes.Read`
9. Click **Grant admin consent** if you have admin access, or ask your admin

---

## Quick Start

```bash
cd backend
cp .env.example .env
# Fill in the values following the instructions above
pip install -r requirements.txt
python app.py
```

The server will start at `http://localhost:5001`.
