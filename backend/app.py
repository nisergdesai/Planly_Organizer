from flask import Flask, request, jsonify, render_template, has_request_context
from flask_cors import CORS
from config import Config
from functools import lru_cache
import os
import time
import json
import re
import shutil
import urllib.request
from text_cleaning import clean_summary_text

# Import Gmail processing functions
from gmail_service import Create_Service

# Import Google Drive processing functions
from drive_service import Create_Service_Drive

# Import Microsoft (Outlook, OneDrive) processing functions
from graph_api import generate_access_token, generate_user_code

# Import Canvas processing functions
from canvas import get_active_courses, get_syllabus, get_recent_announcements, get_upcoming_assignments

# Import database helpers
import db_helpers
from database import init_db, get_session as get_db_session
from db_helpers import get_or_create_user

# Set up Flask app
app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])

# Load API key from config
api_key = Config.GEMINI_API_KEY

# Global variables to store Google Drive service and credentials after authentication
cutoff_days_outlook = None
file_content = None
gmail_services = {}
drive_services = {}  # key = account_id, value = (service, credentials)
ms_flows = {}  # key = "<service_type>:<account_id>", value = device flow payload
DEMO_MODE_COOKIE = "planly_demo_mode"


@lru_cache(maxsize=1)
def _gmail_module():
    import gmail
    return gmail


@lru_cache(maxsize=1)
def _drive_module():
    import drive
    return drive


@lru_cache(maxsize=1)
def _onedrive_module():
    import one_drive
    return one_drive


@lru_cache(maxsize=1)
def _outlooks_module():
    import outlooks
    return outlooks


@lru_cache(maxsize=1)
def _predict_module():
    import predict
    return predict


def derive_account_id(service_type: str, account_email: str | None) -> str | None:
    """Derive a stable local account ID from service + email for token reuse."""
    if not account_email:
        return None
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", account_email.strip().lower()).strip("_")
    if not normalized:
        return None
    prefix = {
        "gmail": "gmail",
        "google_drive": "drive",
        "outlook": "outlook",
        "onedrive": "onedrive",
        "canvas": "canvas",
    }.get(service_type, service_type)
    return f"{prefix}_{normalized}"


def _parse_bool(value: str | None) -> bool | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized in {"true", "1", "yes", "on"}:
        return True
    if normalized in {"false", "0", "no", "off"}:
        return False
    return None


def _demo_mode_enabled() -> bool:
    if has_request_context():
        cookie_override = _parse_bool(request.cookies.get(DEMO_MODE_COOKIE))
        if cookie_override is not None:
            return cookie_override
    return bool(getattr(Config, "DEMO_MODE", False))


@app.route('/demo_mode', methods=['GET', 'POST'])
def demo_mode():
    if request.method == 'GET':
        return jsonify({
            "status": "success",
            "demo_mode": _demo_mode_enabled(),
            "default_demo_mode": bool(getattr(Config, "DEMO_MODE", False)),
        })

    payload = request.get_json(silent=True) or {}
    enabled = bool(payload.get("enabled"))
    response = jsonify({
        "status": "success",
        "demo_mode": enabled,
        "default_demo_mode": bool(getattr(Config, "DEMO_MODE", False)),
    })
    response.set_cookie(
        DEMO_MODE_COOKIE,
        "true" if enabled else "false",
        max_age=60 * 60 * 24 * 30,
        httponly=False,
        samesite="Lax",
        secure=False,
    )
    return response


def _maybe_migrate_google_token(api_name: str, api_version: str, old_account_id: str, new_account_id: str):
    """Copy token pickle from transient account ID to stable account ID if needed."""
    if not old_account_id or not new_account_id or old_account_id == new_account_id:
        return
    old_file = f"token_{api_name}_{api_version}_{old_account_id}.pickle"
    new_file = f"token_{api_name}_{api_version}_{new_account_id}.pickle"
    if os.path.exists(old_file) and not os.path.exists(new_file):
        try:
            shutil.copyfile(old_file, new_file)
        except Exception as e:
            print(f"Warning: Could not migrate token file from {old_file} to {new_file}: {e}")


def _ms_token_file(service_type: str, account_id: str) -> str:
    return f"ms_graph_api_token_{service_type}_{account_id}.json"


def _ms_flow_key(service_type: str, account_id: str) -> str:
    return f"{service_type}:{account_id}"


def _maybe_migrate_ms_token(service_type: str, old_account_id: str, new_account_id: str):
    if not old_account_id or not new_account_id or old_account_id == new_account_id:
        return
    old_file = _ms_token_file(service_type, old_account_id)
    new_file = _ms_token_file(service_type, new_account_id)
    if os.path.exists(old_file) and not os.path.exists(new_file):
        try:
            shutil.copyfile(old_file, new_file)
        except Exception as e:
            print(f"Warning: Could not migrate Microsoft token file from {old_file} to {new_file}: {e}")


def _extract_access_token_from_file(token_file: str) -> str | None:
    if not os.path.exists(token_file):
        return None
    with open(token_file, "r") as file:
        token_data = json.load(file)
    access_tokens = token_data.get("AccessToken", {})
    for _, token_info in access_tokens.items():
        return token_info.get("secret")
    return None


def _extract_account_email_from_token_file(token_file: str) -> str | None:
    if not os.path.exists(token_file):
        return None
    try:
        with open(token_file, "r") as file:
            token_data = json.load(file)

        # Prefer Account.username (UPN/email) from MSAL cache.
        accounts = token_data.get("Account", {})
        if isinstance(accounts, dict):
            for _, account_info in accounts.items():
                username = (account_info or {}).get("username")
                if username:
                    return username

        # Fallback: parse id token claims when available.
        id_tokens = token_data.get("IdToken", {})
        if isinstance(id_tokens, dict):
            for _, id_info in id_tokens.items():
                claims = (id_info or {}).get("claims", {})
                email = claims.get("preferred_username") or claims.get("email") or claims.get("upn")
                if email:
                    return email
    except Exception as e:
        print(f"Warning: Could not extract account email from token cache: {e}")
    return None


def is_token_valid(token_file: str) -> bool:
    if os.path.exists(token_file):
        with open(token_file, "r") as file:
            token_data = json.load(file)

            access_tokens = token_data.get("AccessToken", {})
            if not access_tokens:
                return False

            for _, token_info in access_tokens.items():
                expiration_time = int(token_info.get("expires_on", 0))
                current_time = int(time.time())
                if expiration_time > current_time:
                    return True

    return False


def _get_ms_account_email(access_token: str) -> str | None:
    try:
        req = urllib.request.Request(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            return payload.get("mail") or payload.get("userPrincipalName")
    except Exception as e:
        print(f"Warning: Could not fetch Microsoft account email: {e}")
        return None

# Initialize database on startup and ensure a default user exists
try:
    init_db()
    _default_user = get_or_create_user('default@planly.local', display_name='Default User')
    DEFAULT_USER_ID = _default_user.id
    print(f"Database initialized. Default user ID: {DEFAULT_USER_ID}")
except Exception as e:
    print(f"Warning: Could not initialize database: {e}")
    DEFAULT_USER_ID = 1

# Add health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "message": "Flask backend is running on port 5001"})

# Process Gmail emails
def fetch_email_metadata(g_service, days, label_ids=['INBOX']):
    gmail_module = _gmail_module()
    emails = gmail_module.fetch_emails_in_date_ranges(g_service, days=days, label_ids=label_ids, chunk_size=10)
    email_list = []

    for email in emails:
        msg_id = email['id']
        try:
            sender, formatted_date, subject = gmail_module.get_message_metadata(g_service, msg_id=msg_id)
            email_link = f"https://mail.google.com/mail/u/0/#all/{msg_id}"
            email_list.append({"id": msg_id, "sender": sender, "subject": subject, "date": formatted_date, "link": email_link})
        except Exception as e:
            print(f"Error processing email {msg_id}: {e}")

    return email_list


# Gmail API setup
@app.route('/connect_gmail', methods=['POST'])
def connect_gmail():
    print("Gmail connect endpoint hit!")
    print("Request form data:", request.form)

    requested_account_id = request.form.get("account_id", "default")
    requested_account_email = request.form.get("account_email")
    reconnect_only = request.form.get("reconnect_only", "false").lower() == "true"
    account_id = requested_account_id
    if requested_account_email:
        stable_from_email = derive_account_id("gmail", requested_account_email)
        if stable_from_email:
            account_id = stable_from_email
    global gmail_services
    CLIENT_FILE = 'credentials.json'
    API_NAME = 'gmail'
    API_VERSION = 'v1'
    SCOPES = ['https://mail.google.com/']
    token_file = f"token_{API_NAME}_{API_VERSION}_{account_id}.pickle"

    if _demo_mode_enabled():
        email_address = requested_account_email or "demo.user@gmail.com"
        stable_account_id = derive_account_id("gmail", email_address) or account_id
        try:
            db_helpers.save_service_connection(DEFAULT_USER_ID, 'gmail', {}, account_email=email_address)
        except Exception as db_err:
            print(f"Warning: Could not save service connection: {db_err}")
        return jsonify({
            "status": "success",
            "account_id": stable_account_id,
            "email_address": email_address,
            "emails": [
                {
                    "id": "demo_gmail_1",
                    "sender": "Handshake AI Showcase",
                    "subject": "Welcome! Your demo is ready",
                    "date": "04/19/26",
                    "link": "https://mail.google.com",
                },
                {
                    "id": "demo_gmail_2",
                    "sender": "Team Updates",
                    "subject": "Weekly status + next steps",
                    "date": "04/18/26",
                    "link": "https://mail.google.com",
                },
            ],
        }), 200

    if reconnect_only and not os.path.exists(token_file):
        return jsonify({
            "status": "reauth_required",
            "message": "Saved credentials not found. Please authenticate this account again.",
            "account_id": account_id,
            "email_address": requested_account_email,
            "emails": [],
        }), 200

    try:
        gmail_service = Create_Service(
            CLIENT_FILE,
            API_NAME,
            API_VERSION,
            SCOPES,
            account_id=account_id,
            reconnect_only=reconnect_only,
        )
        gmail_services[account_id] = gmail_service

        num_days = int(request.form.get("num_days", -1))
        label_id = request.form.get("label_id", "INBOX")
        print(f"Received num_days: {num_days}, label_id: {label_id}")

        if gmail_service:
            profile = gmail_service.users().getProfile(userId='me').execute()
            email_address = profile.get('emailAddress', account_id)
            stable_account_id = derive_account_id("gmail", email_address) or account_id
            _maybe_migrate_google_token(API_NAME, API_VERSION, account_id, stable_account_id)
            gmail_services[stable_account_id] = gmail_service
            emails = fetch_email_metadata(gmail_service, days=num_days, label_ids=[label_id])

            # Save service connection to database
            try:
                db_helpers.save_service_connection(DEFAULT_USER_ID, 'gmail', {}, account_email=email_address)
            except Exception as db_err:
                print(f"Warning: Could not save service connection: {db_err}")

            return jsonify({"status": "success", "emails": emails, "account_id": stable_account_id, "email_address": email_address})
        else:
            if reconnect_only:
                return jsonify({
                    "status": "reauth_required",
                    "message": "Could not reconnect with saved credentials. Please authenticate again.",
                    "account_id": account_id,
                    "email_address": requested_account_email,
                    "emails": [],
                }), 200
            return jsonify({"status": "error", "message": "Failed to Connect to Gmail"}), 500
    except Exception as e:
        print(f"Error in connect_gmail: {str(e)}")
        # Return mock data for testing if credentials are missing
        return jsonify({
            "status": "success",
            "account_id": account_id,
            "email_address": "test@gmail.com",
            "emails": [
                {
                    "id": "1",
                    "sender": "Test Sender",
                    "subject": "Test Email Subject",
                    "date": "2024-01-01",
                    "link": "https://mail.google.com"
                },
                {
                    "id": "2",
                    "sender": "Another Sender",
                    "subject": "Another Test Email",
                    "date": "2024-01-02",
                    "link": "https://mail.google.com"
                }
            ]
        })

@app.route('/get_gmail_labels', methods=['POST'])
def get_gmail_labels():
    print("Gmail labels endpoint hit!")
    data = request.get_json()
    account_id = data.get("account_id", "default")
    service = gmail_services.get(account_id)

    if not service:
        # Return mock data if service not available
        return jsonify({
            "status": "success",
            "labels": [
                {"id": "INBOX", "name": "INBOX"},
                {"id": "SENT", "name": "SENT"},
                {"id": "DRAFT", "name": "DRAFT"}
            ]
        })

    try:
        response = service.users().labels().list(userId='me').execute()
        labels = [{"id": label['id'], "name": label['name']} for label in response.get('labels', [])]
        return jsonify({"status": "success", "labels": labels})
    except Exception as e:
        print(f"Failed to fetch labels: {e}")
        return jsonify({"status": "error", "message": "Failed to retrieve labels"}), 500


def list_drive_files(d_service):
    if d_service:
        return _drive_module().list_recent_drive_files(d_service, 112)
    return ""

# Google Drive API setup triggered by button click
@app.route('/connect_google_drive', methods=['POST'])
def connect_google_drive():
    print("Google Drive connect endpoint hit!")
    print("Request form data:", request.form)

    requested_account_id = request.form.get("account_id", "default")
    requested_account_email = request.form.get("account_email")
    reconnect_only = request.form.get("reconnect_only", "false").lower() == "true"
    account_id = requested_account_id
    if requested_account_email:
        stable_from_email = derive_account_id("google_drive", requested_account_email)
        if stable_from_email:
            account_id = stable_from_email
    global drive_services
    CLIENT_SECRET_FILE = 'credentials.json'
    API_NAME = 'drive'
    API_VERSION = 'v3'
    SCOPES = ['https://www.googleapis.com/auth/drive']
    token_file = f"token_{API_NAME}_{API_VERSION}_{account_id}.pickle"

    if _demo_mode_enabled():
        email_address = requested_account_email or "demo.user@gmail.com"
        stable_account_id = derive_account_id("google_drive", email_address) or account_id
        try:
            db_helpers.save_service_connection(DEFAULT_USER_ID, 'google_drive', {}, account_email=email_address)
        except Exception as db_err:
            print(f"Warning: Could not save service connection: {db_err}")
        return jsonify({
            "status": "success",
            "account_id": stable_account_id,
            "email_address": email_address,
            "files": [
                {"id": "demo_drive_1", "name": "Demo Notes.pdf", "mimeType": "application/pdf"},
                {"id": "demo_drive_2", "name": "Roadmap.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
            ],
        }), 200

    if reconnect_only and not os.path.exists(token_file):
        return jsonify({
            "status": "reauth_required",
            "message": "Saved credentials not found. Please authenticate this account again.",
            "account_id": account_id,
            "email_address": requested_account_email,
            "files": [],
        }), 200

    # Get the num_days from the frontend
    num_days = int(request.form.get("num_days", -1))  # Default to 15 if not provided
    print(f"Received num_days: {num_days}")  # Debugging

    try:
        service, credentials = Create_Service_Drive(
            CLIENT_SECRET_FILE,
            API_NAME,
            API_VERSION,
            SCOPES,
            account_id=account_id,
            reconnect_only=reconnect_only,
        )

        if service and credentials:
            # Store service & creds for this account
            drive_services[account_id] = (service, credentials)

            about = service.about().get(fields="user").execute()
            email_address = about.get("user", {}).get("emailAddress", account_id)
            stable_account_id = derive_account_id("google_drive", email_address) or account_id
            _maybe_migrate_google_token(API_NAME, API_VERSION, account_id, stable_account_id)
            drive_services[stable_account_id] = (service, credentials)

            files = _drive_module().list_recent_drive_files(service, num_days=num_days)

            # Save service connection to database
            try:
                db_helpers.save_service_connection(DEFAULT_USER_ID, 'google_drive', {}, account_email=email_address)
            except Exception as db_err:
                print(f"Warning: Could not save service connection: {db_err}")

            return jsonify({
                "status": "success",
                "files": files,
                "account_id": stable_account_id,
                "email_address": email_address
            })
        else:
            if reconnect_only:
                return jsonify({
                    "status": "reauth_required",
                    "message": "Could not reconnect with saved credentials. Please authenticate again.",
                    "account_id": account_id,
                    "email_address": requested_account_email,
                    "files": [],
                }), 200
            return jsonify({"status": "error", "message": "Failed to Connect to Google Drive"}), 500
    except Exception as e:
        print(f"Error in connect_google_drive: {str(e)}")
        # Return mock data for testing if credentials are missing
        return jsonify({
            "status": "success",
            "account_id": account_id,
            "email_address": "test@gmail.com",
            "files": [
                {
                    "id": "1",
                    "name": "Test Document.pdf",
                    "mimeType": "application/pdf"
                },
                {
                    "id": "2",
                    "name": "Sample Spreadsheet.xlsx",
                    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }
            ]
        })


# List recent Google Drive files (only if already connected)

# Process Google Drive files (only if already connected)
def process_drive_files(account_id):
    service_creds = drive_services.get(account_id)
    if service_creds:
        service, credentials = service_creds
        drive_module = _drive_module()
        whisper_model = drive_module.setup_whisper()
        return drive_module.process_files(service, credentials, whisper_model)
    return ""


@app.route('/fetch_code_outlook', methods=['POST'])
def fetch_code_outlook():
    print("Fetch code outlook endpoint hit!")

    data = request.get_json(silent=True) or {}
    requested_account_id = data.get("account_id", f"outlook_{int(time.time() * 1000)}")
    requested_account_email = data.get("account_email")
    reconnect_only = bool(data.get("reconnect_only"))
    force_new_auth = bool(data.get("force_new_auth"))

    account_id = requested_account_id
    if requested_account_email:
        stable_from_email = derive_account_id("outlook", requested_account_email)
        if stable_from_email:
            account_id = stable_from_email

    if _demo_mode_enabled():
        email_address = requested_account_email or "demo.user@outlook.com"
        stable_account_id = derive_account_id("outlook", email_address) or account_id
        try:
            db_helpers.save_service_connection(DEFAULT_USER_ID, 'outlook', {}, account_email=email_address)
        except Exception as db_err:
            print(f"Warning: Could not save Outlook service connection in demo mode: {db_err}")
        return jsonify({
            "status": "success",
            "account_id": stable_account_id,
            "email_address": email_address,
        })

    token_file = _ms_token_file("outlook", account_id)
    if force_new_auth and os.path.exists(token_file):
        try:
            os.remove(token_file)
        except Exception as e:
            print(f"Warning: Could not clear existing Microsoft token: {e}")

    if reconnect_only and not os.path.exists(token_file):
        return jsonify({
            "status": "reauth_required",
            "message": "Saved credentials not found. Please authenticate this account again.",
            "account_id": account_id,
            "email_address": requested_account_email,
        })

    if is_token_valid(token_file):
        remembered_email = (
            _extract_account_email_from_token_file(token_file)
            or requested_account_email
        )
        if remembered_email:
            try:
                db_helpers.save_service_connection(DEFAULT_USER_ID, 'outlook', {}, account_email=remembered_email)
            except Exception as db_err:
                print(f"Warning: Could not save Outlook service connection on reconnect: {db_err}")
        return jsonify({
            "status": "success",
            "account_id": account_id,
            "email_address": remembered_email,
        })

    APP_ID = Config.MICROSOFT_APP_ID
    SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']

    try:
        flow = generate_user_code(app_id=APP_ID, scopes=SCOPES, token_file=token_file)
        # No device flow means silent auth is already available.
        if reconnect_only and not flow:
            remembered_email = (
                _extract_account_email_from_token_file(token_file)
                or requested_account_email
            )
            if remembered_email:
                try:
                    db_helpers.save_service_connection(DEFAULT_USER_ID, 'outlook', {}, account_email=remembered_email)
                except Exception as db_err:
                    print(f"Warning: Could not save Outlook service connection on silent reconnect: {db_err}")
            return jsonify({
                "status": "success",
                "account_id": account_id,
                "email_address": remembered_email,
            })

        if flow:
            ms_flows[_ms_flow_key("outlook", account_id)] = flow
            print(f"Generated user code: {flow.get('user_code')}")
            return jsonify({
                "status": "pending",
                "user_code": flow.get('user_code'),
                "verification_url": 'https://microsoft.com/devicelogin',
                "account_id": account_id,
                "email_address": requested_account_email,
            })

        return jsonify({
            "status": "success",
            "account_id": account_id,
            "email_address": requested_account_email,
        })
    except Exception as e:
        print(f"Error in fetch_code_outlook: {str(e)}")
        return jsonify({
            "status": "pending",
            "user_code": "ABC123",
            "verification_url": 'https://microsoft.com/devicelogin',
            "account_id": account_id,
            "email_address": requested_account_email,
        })

@app.route('/fetch_code_onedrive', methods=['POST'])
def fetch_code_onedrive():
    print("Fetch code onedrive endpoint hit!")

    data = request.get_json(silent=True) or {}
    requested_account_id = data.get("account_id", f"onedrive_{int(time.time() * 1000)}")
    requested_account_email = data.get("account_email")
    reconnect_only = bool(data.get("reconnect_only"))
    force_new_auth = bool(data.get("force_new_auth"))

    account_id = requested_account_id
    if requested_account_email:
        stable_from_email = derive_account_id("onedrive", requested_account_email)
        if stable_from_email:
            account_id = stable_from_email

    if _demo_mode_enabled():
        email_address = requested_account_email or "demo.user@outlook.com"
        stable_account_id = derive_account_id("onedrive", email_address) or account_id
        try:
            db_helpers.save_service_connection(DEFAULT_USER_ID, 'onedrive', {}, account_email=email_address)
        except Exception as db_err:
            print(f"Warning: Could not save OneDrive service connection in demo mode: {db_err}")
        return jsonify({
            "status": "success",
            "account_id": stable_account_id,
            "email_address": email_address,
        })

    token_file = _ms_token_file("onedrive", account_id)
    if force_new_auth and os.path.exists(token_file):
        try:
            os.remove(token_file)
        except Exception as e:
            print(f"Warning: Could not clear existing Microsoft token: {e}")

    if reconnect_only and not os.path.exists(token_file):
        return jsonify({
            "status": "reauth_required",
            "message": "Saved credentials not found. Please authenticate this account again.",
            "account_id": account_id,
            "email_address": requested_account_email,
        })

    if is_token_valid(token_file):
        remembered_email = (
            _extract_account_email_from_token_file(token_file)
            or requested_account_email
        )
        if remembered_email:
            try:
                db_helpers.save_service_connection(DEFAULT_USER_ID, 'onedrive', {}, account_email=remembered_email)
            except Exception as db_err:
                print(f"Warning: Could not save OneDrive service connection on reconnect: {db_err}")
        return jsonify({
            "status": "success",
            "account_id": account_id,
            "email_address": remembered_email,
        })

    APP_ID = Config.MICROSOFT_APP_ID
    SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']

    try:
        flow = generate_user_code(app_id=APP_ID, scopes=SCOPES, token_file=token_file)
        # No device flow means silent auth is already available.
        if reconnect_only and not flow:
            remembered_email = (
                _extract_account_email_from_token_file(token_file)
                or requested_account_email
            )
            if remembered_email:
                try:
                    db_helpers.save_service_connection(DEFAULT_USER_ID, 'onedrive', {}, account_email=remembered_email)
                except Exception as db_err:
                    print(f"Warning: Could not save OneDrive service connection on silent reconnect: {db_err}")
            return jsonify({
                "status": "success",
                "account_id": account_id,
                "email_address": remembered_email,
            })

        if flow:
            ms_flows[_ms_flow_key("onedrive", account_id)] = flow
            print(f"Generated user code: {flow.get('user_code')}")
            return jsonify({
                "status": "pending",
                "user_code": flow.get('user_code'),
                "verification_url": 'https://microsoft.com/devicelogin',
                "account_id": account_id,
                "email_address": requested_account_email,
            })

        return jsonify({
            "status": "success",
            "account_id": account_id,
            "email_address": requested_account_email,
        })
    except Exception as e:
        print(f"Error in fetch_code_onedrive: {str(e)}")
        return jsonify({
            "status": "pending",
            "user_code": "XYZ789",
            "verification_url": 'https://microsoft.com/devicelogin',
            "account_id": account_id,
            "email_address": requested_account_email,
        })

@app.route('/fetch_outlook', methods=['POST'])
def fetch_outlook():
    print("Fetch outlook endpoint hit!")

    APP_ID = Config.MICROSOFT_APP_ID
    SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']
    global cutoff_days_outlook
    request_data = request.get_json() or {}
    cutoff_days_outlook = request_data.get('cutoff_days_outlook', -1)
    requested_account_id = request_data.get('account_id', f"outlook_{int(time.time() * 1000)}")
    requested_account_email = request_data.get('account_email')
    reconnect_only = bool(request_data.get("reconnect_only"))

    account_id = requested_account_id
    if requested_account_email:
        stable_from_email = derive_account_id("outlook", requested_account_email)
        if stable_from_email:
            account_id = stable_from_email

    token_file = _ms_token_file("outlook", account_id)

    print(f"Outlook={cutoff_days_outlook}")  # Debugging

    if _demo_mode_enabled():
        demo_emails = [
            {
                "id": "demo_outlook_1",
                "sender": "Demo Recruiter",
                "subject": "Handshake AI Showcase logistics",
                "date": "04/19/26",
                "link": "https://outlook.office.com",
                "summary": "Arrive 10 minutes early, bring a laptop, and be ready to demo end-to-end.",
            },
            {
                "id": "demo_outlook_2",
                "sender": "Calendar",
                "subject": "Reminder: practice run",
                "date": "04/18/26",
                "link": "https://outlook.office.com",
                "summary": "Do a full run-through and confirm demo mode works without accounts.",
            },
        ]
        account_email = requested_account_email or "demo.user@outlook.com"
        stable_account_id = derive_account_id("outlook", account_email) or account_id
        try:
            db_helpers.save_service_connection(DEFAULT_USER_ID, 'outlook', {}, account_email=account_email)
        except Exception as db_err:
            print(f"Warning: Could not save service connection: {db_err}")
        return jsonify({
            "status": "pending",
            "outlooks": demo_emails,
            "account_id": stable_account_id,
            "email_address": account_email,
        })

    try:
        access_token = _extract_access_token_from_file(token_file)
        if not access_token:
            flow_key = _ms_flow_key("outlook", account_id)
            flow = ms_flows.get(flow_key)
            token_response = generate_access_token(
                flow,
                app_id=APP_ID,
                scopes=SCOPES,
                token_file=token_file,
                reconnect_only=reconnect_only,
            )
            if not token_response or "access_token" not in token_response:
                return jsonify({
                    "status": "reauth_required",
                    "message": "Reconnect failed. Please authenticate this account again.",
                    "account_id": account_id,
                    "email_address": requested_account_email,
                    "outlooks": [],
                })
            access_token = token_response["access_token"]

        headers = {'Authorization': f'Bearer {access_token}'}
        outlook_summary = _outlooks_module().display_and_summarize_emails(headers, cutoff_days_outlook)
        account_email = (
            _extract_account_email_from_token_file(token_file)
            or _get_ms_account_email(access_token)
            or requested_account_email
        )
        stable_account_id = derive_account_id("outlook", account_email) or account_id
        _maybe_migrate_ms_token("outlook", account_id, stable_account_id)

        try:
            db_helpers.save_service_connection(DEFAULT_USER_ID, 'outlook', {}, account_email=account_email)
        except Exception as db_err:
            print(f"Warning: Could not save service connection: {db_err}")

        return jsonify({
            "status": "pending",
            "outlooks": outlook_summary,
            "account_id": stable_account_id,
            "email_address": account_email,
        })
    except Exception as e:
        print(f"Error in fetch_outlook: {str(e)}")
        # Return mock data for testing
        return jsonify({
            "status": "pending",
            "outlooks": [
                {
                    "id": "1",
                    "sender": "Test Outlook Sender",
                    "subject": "Test Outlook Email",
                    "date": "2024-01-01",
                    "link": "https://outlook.com",
                    "summary": "This is a test Outlook email summary"
                }
            ]
        })

@app.route('/fetch_onedrive', methods=['POST'])
def fetch_onedrive():
    print("Fetch onedrive endpoint hit!")

    APP_ID = Config.MICROSOFT_APP_ID
    SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']
    request_data = request.get_json() or {}
    cutoff_days_onedrive = request_data.get('cutoff_days_onedrive', -1)
    requested_account_id = request_data.get('account_id', f"onedrive_{int(time.time() * 1000)}")
    requested_account_email = request_data.get('account_email')
    reconnect_only = bool(request_data.get("reconnect_only"))

    account_id = requested_account_id
    if requested_account_email:
        stable_from_email = derive_account_id("onedrive", requested_account_email)
        if stable_from_email:
            account_id = stable_from_email

    token_file = _ms_token_file("onedrive", account_id)

    print(f"Received cutoff_days: OneDrive={cutoff_days_onedrive}, Outlook={cutoff_days_outlook}")  # Debugging

    if _demo_mode_enabled():
        account_email = requested_account_email or "demo.user@outlook.com"
        stable_account_id = derive_account_id("onedrive", account_email) or account_id
        try:
            db_helpers.save_service_connection(DEFAULT_USER_ID, 'onedrive', {}, account_email=account_email)
        except Exception as db_err:
            print(f"Warning: Could not save service connection: {db_err}")
        return jsonify({
            "status": "pending",
            "o_files": [
                ["Demo PRD.docx", "demo_onedrive_1"],
                ["Pitch Deck.pptx", "demo_onedrive_2"],
            ],
            "account_id": stable_account_id,
            "email_address": account_email,
        })

    try:
        access_token = _extract_access_token_from_file(token_file)
        if not access_token:
            flow_key = _ms_flow_key("onedrive", account_id)
            flow = ms_flows.get(flow_key)
            token_response = generate_access_token(
                flow,
                app_id=APP_ID,
                scopes=SCOPES,
                token_file=token_file,
                reconnect_only=reconnect_only,
            )
            if not token_response or "access_token" not in token_response:
                return jsonify({
                    "status": "reauth_required",
                    "message": "Reconnect failed. Please authenticate this account again.",
                    "account_id": account_id,
                    "email_address": requested_account_email,
                    "o_files": [],
                })
            access_token = token_response["access_token"]

        headers = {'Authorization': f'Bearer {access_token}'}
        onedrive_files = _onedrive_module().navigate_onedrive(headers, access_token, cutoff_days_onedrive)
        account_email = (
            _extract_account_email_from_token_file(token_file)
            or _get_ms_account_email(access_token)
            or requested_account_email
        )
        stable_account_id = derive_account_id("onedrive", account_email) or account_id
        _maybe_migrate_ms_token("onedrive", account_id, stable_account_id)

        try:
            db_helpers.save_service_connection(DEFAULT_USER_ID, 'onedrive', {}, account_email=account_email)
        except Exception as db_err:
            print(f"Warning: Could not save service connection: {db_err}")

        return jsonify({
            "status": "pending",
            "o_files": onedrive_files,
            "account_id": stable_account_id,
            "email_address": account_email,
        })
    except Exception as e:
        print(f"Error in fetch_onedrive: {str(e)}")
        # Return mock data for testing
        return jsonify({
            "status": "pending",
            "o_files": [
                ["Test OneDrive File.docx", "file_id_1"],
                ["Sample Presentation.pptx", "file_id_2"]
            ],
        })


@app.route('/')
def index():
    print("Index endpoint hit!")
    try:
        # Get active courses
        courses = get_active_courses()
        return render_template('index.html', courses=courses)
    except Exception as e:
        print(f"Error in index: {str(e)}")
        return jsonify({"status": "healthy", "message": "Flask backend is running"})

@app.route('/get_courses', methods=['GET'])
def get_courses():
    print("Get courses endpoint hit!")
    try:
        if _demo_mode_enabled():
            try:
                db_helpers.save_service_connection(DEFAULT_USER_ID, 'canvas', {})
            except Exception as db_err:
                print(f"Warning: Could not save service connection: {db_err}")
            return jsonify({
                "status": "success",
                "courses": [
                    {"id": "101", "name": "Demo Course: Product"},
                    {"id": "102", "name": "Demo Course: Engineering"},
                ],
            })

        # Get active courses from Canvas using your existing function
        courses = get_active_courses()

        # Format courses for frontend
        formatted_courses = []
        for course in courses:
            formatted_courses.append({
                "id": str(course.get('id', '')),
                "name": course.get('name', 'Unknown Course')
            })

        print(f"Found {len(formatted_courses)} courses")

        # Save Canvas service connection
        try:
            db_helpers.save_service_connection(DEFAULT_USER_ID, 'canvas', {})
        except Exception as db_err:
            print(f"Warning: Could not save service connection: {db_err}")

        return jsonify({"status": "success", "courses": formatted_courses})

    except Exception as e:
        print(f"Error in get_courses: {str(e)}")
        return jsonify({
            "status": "error",
            "message": str(e),
            "courses": []
        })

@app.route('/course_details', methods=['POST'])
def course_details():
    print("Course details endpoint hit!")

    data = request.get_json()
    course_id = data.get('course_id')
    content_type = data.get('content_type')
    force_refresh = data.get('force_refresh', False)

    # Check for cached summary
    source_id = f"canvas_{course_id}_{content_type}"
    if not force_refresh:
        try:
            cached = db_helpers.get_cached_summary('canvas_course', source_id)
            if cached:
                return jsonify({
                    "content": cached.summary_text,
                    "cached": True,
                    "cached_at": cached.created_at.isoformat() if cached.created_at else None
                })
        except Exception as db_err:
            print(f"Warning: Cache lookup failed: {db_err}")

    try:
        if _demo_mode_enabled():
            demo_content = {
                "syllabus": "Demo syllabus: show an end-to-end workflow and discuss design tradeoffs.",
                "upcoming_assignments": "Upcoming: rehearse pitch, record backup demo video, finalize README.",
                "recent_announcements": "Announcement: DEMO_MODE is enabled — no real accounts needed.",
            }.get(content_type, "Invalid content type")
            try:
                db_helpers.save_summary(DEFAULT_USER_ID, 'canvas_course', source_id, demo_content)
            except Exception:
                pass
            return jsonify({"content": demo_content, "cached": False})

        # Get all active courses and find the specific course by id
        courses = get_active_courses()
        course = next((course for course in courses if course['id'] == int(course_id)), None)

        # If course is not found, return an error
        if not course:
            return jsonify({"error": "Course not found"}), 404

        # Fetch the content based on the content_type
        if content_type == 'syllabus':
            content = get_syllabus(course)
        elif content_type == 'upcoming_assignments':
            content = get_upcoming_assignments(course)
        elif content_type == 'recent_announcements':
            content = get_recent_announcements(course)
        else:
            content = "Invalid content type"

        # Cache the result
        try:
            db_helpers.save_summary(DEFAULT_USER_ID, 'canvas_course', source_id, content)
        except Exception as db_err:
            print(f"Warning: Could not cache summary: {db_err}")

        return jsonify({"content": content, "cached": False})
    except Exception as e:
        print(f"Error in course_details: {str(e)}")
        return jsonify({
            "content": f"Mock {content_type} content for course {course_id}: This is test content from Canvas.",
            "cached": False
        })

@app.route('/summarize_emails', methods=['POST'])
def summarize_selected_emails():
    print("Summarize emails endpoint hit!")

    data = request.get_json()
    email_ids = data.get('email_ids', []) if data else []
    account_id = data.get('account_id', 'default') if data else 'default'
    force_refresh = data.get('force_refresh', False) if data else False

    if _demo_mode_enabled():
        demo_summary = clean_summary_text(
            "Demo Gmail Summary:\n"
            "- Prioritize the showcase checklist.\n"
            "- Confirm the demo runs in DEMO_MODE.\n"
            "- Keep the pitch to 2–3 minutes.\n"
        )
        return jsonify({'summary': demo_summary, 'cached': False})

    # Deduplicate email IDs while preserving order
    seen = set()
    unique_email_ids = []
    for eid in email_ids:
        if eid not in seen:
            seen.add(eid)
            unique_email_ids.append(eid)
    email_ids = unique_email_ids

    print(f"Received email_ids: {email_ids}, account_id: {account_id}")

    # Create a composite source_id for the set of emails
    source_id = f"gmail_{'_'.join(sorted(email_ids))}"

    # Check cache
    if not force_refresh:
        try:
            cached = db_helpers.get_cached_summary('email_batch', source_id)
            if cached:
                return jsonify({
                    'summary': clean_summary_text(cached.summary_text),
                    'cached': True,
                    'cached_at': cached.created_at.isoformat() if cached.created_at else None
                })
        except Exception as db_err:
            print(f"Warning: Cache lookup failed: {db_err}")

    gmail_service = gmail_services.get(account_id)

    if not gmail_service:
        mock_summary = f'Test summary of {len(email_ids)} emails: This is a mock summary for testing purposes.'
        try:
            db_helpers.save_summary(DEFAULT_USER_ID, 'email_batch', source_id, mock_summary)
        except Exception:
            pass
        return jsonify({
            'summary': mock_summary,
            'cached': False
        })

    summaries = []

    try:
        for msg_id in email_ids:
            try:
                gmail_module = _gmail_module()
                predict_module = _predict_module()
                sender, formatted_date, subject = gmail_module.get_message_metadata(gmail_service, msg_id=msg_id)
                content = gmail_module.get_message_content(gmail_service, msg_id=msg_id)
                if content:
                    summary = predict_module.predict_sentences_action_notes(content)
                    if not any(char.isalpha() for char in summary):
                        summary = predict_module.predict_sentences_action_notes(content)
                    summaries.append(f"Sender: {sender}\nSubject: {subject}\nDate: {formatted_date}\nSummary:\n{summary}\n")
            except Exception as e:
                print(f"Error summarizing email {msg_id}: {e}")

        final_summary = "\n\n".join(summaries) if summaries else "No emails selected for summarization."
        final_summary = clean_summary_text(final_summary)

        # Cache the result
        try:
            db_helpers.save_summary(DEFAULT_USER_ID, 'email_batch', source_id, final_summary)
        except Exception as db_err:
            print(f"Warning: Could not cache summary: {db_err}")

        return jsonify({'summary': final_summary, 'cached': False})
    except Exception as e:
        print(f"Error in summarize_selected_emails: {str(e)}")
        return jsonify({
            'summary': f'Test summary of {len(email_ids)} emails: This is a mock summary for testing purposes.',
            'cached': False
        })

@app.route('/summarize_outlook_emails', methods=['POST'])
def summarize_outlook_emails():
    print("Summarize outlook emails endpoint hit!")

    global cutoff_days_outlook
    data = request.get_json()
    email_ids = data.get('email_ids', []) if data else []
    force_refresh = data.get('force_refresh', False) if data else False
    account_id = data.get('account_id', 'outlook_default') if data else 'outlook_default'
    account_email = data.get('account_email') if data else None

    if _demo_mode_enabled():
        demo_summary = clean_summary_text(
            "Demo Outlook Summary:\n"
            "- Showcase logistics email received.\n"
            "- Practice run reminder.\n"
        )
        return jsonify({'summary': demo_summary, 'cached': False})

    # Deduplicate email IDs
    email_ids = list(dict.fromkeys(email_ids))

    summaries = []
    print("Received email IDs:", email_ids)

    source_id = f"outlook_{'_'.join(sorted(email_ids))}"

    # Check cache
    if not force_refresh:
        try:
            cached = db_helpers.get_cached_summary('email_batch', source_id)
            if cached:
                return jsonify({
                    'summary': clean_summary_text(cached.summary_text),
                    'cached': True,
                    'cached_at': cached.created_at.isoformat() if cached.created_at else None
                })
        except Exception as db_err:
            print(f"Warning: Cache lookup failed: {db_err}")

    try:
        APP_ID = Config.MICROSOFT_APP_ID
        SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']
        token_file = _ms_token_file("outlook", derive_account_id("outlook", account_email) or account_id)
        access_token = _extract_access_token_from_file(token_file)
        if not access_token:
            return jsonify({'summary': "Reconnect required for this Outlook account.", 'cached': False})
        headers = {'Authorization': 'Bearer ' + access_token}

        email_data = _outlooks_module().display_and_summarize_emails(headers, cutoff_days_outlook)
        print(f"Outlook email_data returned: {len(email_data) if email_data else 0} items")
        if email_data:
            for item in email_data:
                subject = item.get('subject', 'Unknown')
                sender = item.get('sender', 'Unknown')
                date = item.get('date', 'Unknown')
                summary = item.get('summary', '')
                summaries.append(f"Email from {sender}: \n({subject}) sent on \n{date}:\n{summary}\n")
        final_summary = "\n\n".join(summaries) if summaries else "No emails selected for summarization."
        final_summary = clean_summary_text(final_summary)
        print(f"Outlook final_summary length: {len(final_summary)}")
        print(f"Outlook response: summary={'yes' if final_summary else 'no'}, cached=False")

        # Cache the result
        try:
            db_helpers.save_summary(DEFAULT_USER_ID, 'email_batch', source_id, final_summary)
        except Exception as db_err:
            print(f"Warning: Could not cache summary: {db_err}")

        return jsonify({'summary': final_summary, 'cached': False})
    except Exception as e:
        print(f"Error in summarize_outlook_emails: {str(e)}")
        mock_summary = f'Test summary of {len(email_ids)} Outlook emails: This is a mock summary for testing purposes.'
        try:
            db_helpers.save_summary(DEFAULT_USER_ID, 'email_batch', source_id, mock_summary)
        except Exception:
            pass
        return jsonify({
            'summary': mock_summary,
            'cached': False
        })


@app.route('/summarize', methods=['POST'])
def summarize():
    print("Summarize endpoint hit!")
    print("Request form data:", request.form)

    if request.method == 'POST':
        file_id = request.form.get('file_id')
        file_name = request.form.get('file_name')
        file_mime_type = request.form.get('file_mime_type')
        file_source = request.form.get('file_source')
        account_id = request.form.get('account_id')
        force_refresh = request.form.get('force_refresh', 'false').lower() == 'true'

        if _demo_mode_enabled():
            demo_original = f"Demo content for {file_name or 'file'} ({file_source or 'unknown source'})."
            demo_summary = clean_summary_text(
                f"Demo Summary ({file_name or 'file'}):\n"
                "- Key points extracted.\n"
                "- Action items listed.\n"
                "- Ready for showcase.\n"
            )
            return jsonify({
                'summary': demo_summary,
                'original_text': demo_original,
                'cached': False,
            })

        print(f"Received for summarization: ID={file_id}, Name={file_name}, Type={file_mime_type}, Source={file_source}")

        # Check cache — use 'file' as the source_type for the summaries DB enum
        source_type = 'file'

        if not force_refresh:
            try:
                cached = db_helpers.get_cached_summary(source_type, file_id)
                if cached:
                    return jsonify({
                        'summary': clean_summary_text(cached.summary_text),
                        'original_text': None,
                        'cached': True,
                        'cached_at': cached.created_at.isoformat() if cached.created_at else None
                    })
            except Exception as db_err:
                print(f"Warning: Cache lookup failed: {db_err}")

        summary = ""
        file_content = ""

        try:
            if file_source == 'google_drive' or file_source == 'drive':
                service_creds = drive_services.get(account_id)
                if service_creds:
                    service, credentials = service_creds
                    drive_module = _drive_module()
                    whisper_model = drive_module.setup_whisper()
                    file_content, summary = drive_module.combine_file_contents(
                        file_name, file_id, file_mime_type, credentials, service, whisper_model
                    )
                else:
                    # Mock data for testing
                    file_content = f"Mock content for file: {file_name}"
                    summary = f"Mock summary for {file_name}: This is a test summary of the file content."

            elif file_source == 'onedrive':
                APP_ID = Config.MICROSOFT_APP_ID
                SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']
                token_file = _ms_token_file("onedrive", account_id or "onedrive_default")
                access_token_str = _extract_access_token_from_file(token_file)
                if not access_token_str:
                    return jsonify({
                        'summary': "Reconnect required for this OneDrive account.",
                        'original_text': "",
                        'cached': False,
                    })
                headers = {'Authorization': 'Bearer ' + access_token_str}
                access_token = {'access_token': access_token_str}

                file_content, summary = _onedrive_module().get_onedrive_file_content(
                    headers, file_id, file_name, access_token, 300
                )

            # Cache the result
            summary = clean_summary_text(summary)
            try:
                db_helpers.save_summary(DEFAULT_USER_ID, source_type, file_id, summary)
            except Exception as db_err:
                print(f"Warning: Could not cache summary: {db_err}")

            return jsonify({
                'summary': summary,
                'original_text': file_content,
                'cached': False
            })
        except Exception as e:
            print(f"Error in summarize: {str(e)}")
            return jsonify({
                'summary': f"Mock summary for {file_name}: This is a test summary of the file content.",
                'original_text': f"Mock content for file: {file_name}",
                'cached': False
            })


@app.route('/ask_gemini', methods=['POST'])
def ask_gemini():
    print("Ask gemini endpoint hit!")

    data = request.get_json()
    query = "My question is about original content and summary. If needed, search the web to answer the question. " + data.get('query', '').strip()
    original_text = data.get('original_text', '').strip()
    summary = data.get('summary', '').strip()

    print(f"Received query: {query}")

    if _demo_mode_enabled():
        return jsonify({
            "answer": clean_summary_text(
                "Demo answer:\n"
                "- This is fixture data (DEMO_MODE).\n"
                "- Connect real accounts by disabling DEMO_MODE and adding credentials.\n"
            )
        })

    if not query:
        return jsonify({"error": "No query provided"}), 400
    if not original_text and not summary:
        return jsonify({"error": "No relevant text provided"}), 400

    combined_text = f"Original Content:\n{original_text}\n\nSummary:\n{summary}"

    try:
        answer = _drive_module().summarize_content_with_gemini(combined_text, query)
        return jsonify({"answer": clean_summary_text(answer)})
    except Exception as e:
        print(f"Error querying Gemini: {e}")
        return jsonify({"answer": f"Mock answer to your question: '{query}'. This is a test response."})


# ==================== Disconnect Services Endpoints ====================

@app.route('/disconnect/<service_type>', methods=['POST'])
def disconnect_service(service_type):
    """Disconnect a service by marking it inactive and clearing caches."""
    print(f"Disconnect {service_type} endpoint hit!")

    # Map frontend service names to database enum values
    SERVICE_TYPE_MAP = {
        'gmail': 'gmail',
        'drive': 'google_drive',
        'google_drive': 'google_drive',
        'outlook': 'outlook',
        'onedrive': 'onedrive',
        'canvas': 'canvas',
    }
    db_service_type = SERVICE_TYPE_MAP.get(service_type, service_type)

    data = request.get_json() or {}
    account_email = data.get('account_email')

    # Clear in-memory caches based on service type
    if service_type == 'gmail':
        if account_email:
            stable_id = derive_account_id("gmail", account_email)
            to_remove = [k for k in gmail_services.keys() if k == stable_id]
            for k in to_remove:
                gmail_services.pop(k, None)
        else:
            gmail_services.clear()
    elif service_type in ('drive', 'google_drive'):
        if account_email:
            stable_id = derive_account_id("google_drive", account_email)
            to_remove = [k for k in drive_services.keys() if k == stable_id]
            for k in to_remove:
                drive_services.pop(k, None)
        else:
            drive_services.clear()
    elif service_type in ('outlook', 'onedrive'):
        if account_email:
            stable_id = derive_account_id(service_type, account_email)
            token_file = _ms_token_file(service_type, stable_id or service_type)
            if os.path.exists(token_file):
                try:
                    os.remove(token_file)
                except Exception as e:
                    print(f"Warning: Could not remove token file: {e}")
            ms_flows.pop(_ms_flow_key(service_type, stable_id or service_type), None)
        else:
            prefix = f"ms_graph_api_token_{service_type}_"
            for filename in os.listdir("."):
                if filename.startswith(prefix) and filename.endswith(".json"):
                    try:
                        os.remove(filename)
                    except Exception as e:
                        print(f"Warning: Could not remove token file {filename}: {e}")

    # Mark inactive in database
    try:
        db_helpers.disconnect_service(db_service_type, account_email=account_email)
    except Exception as db_err:
        print(f"Warning: Could not update database: {db_err}")

    return jsonify({"status": "success", "message": f"{service_type} disconnected"})


@app.route('/connected_services', methods=['GET'])
def connected_services():
    """Get all active service connections."""
    print("Connected services endpoint hit!")
    try:
        if _demo_mode_enabled():
            return jsonify({"status": "success", "services": []})

        services = db_helpers.get_connected_services()
        existing_keys = {
            (
                s.get("service_type"),
                s.get("account_email"),
                s.get("account_id"),
            )
            for s in services
        }

        # Also discover remembered Microsoft accounts from token cache files.
        for service_type in ("outlook", "onedrive"):
            prefix = f"ms_graph_api_token_{service_type}_"
            for filename in os.listdir("."):
                if not (filename.startswith(prefix) and filename.endswith(".json")):
                    continue
                account_id = filename[len(prefix):-5]
                token_file = filename
                account_email = _extract_account_email_from_token_file(token_file)
                key = (service_type, account_email, account_id)
                if key in existing_keys:
                    continue
                services.append({
                    "service_type": service_type,
                    "account_email": account_email,
                    "account_id": account_id,
                    "connected_at": None,
                })
                existing_keys.add(key)
        return jsonify({"status": "success", "services": services})
    except Exception as e:
        print(f"Error getting connected services: {str(e)}")
        return jsonify({"status": "success", "services": []})


if __name__ == '__main__':
    for warning in Config.validate():
        print(f"Config: {warning}")

    print(f"Starting Flask server on http://localhost:{Config.FLASK_PORT}")
    print("Available routes:")
    print("  GET  /health")
    print("  GET  /")
    print("  GET  /connected_services")
    print("  POST /connect_gmail")
    print("  POST /connect_google_drive")
    print("  POST /get_gmail_labels")
    print("  POST /summarize_emails")
    print("  POST /fetch_code_outlook")
    print("  POST /fetch_code_onedrive")
    print("  POST /fetch_outlook")
    print("  POST /fetch_onedrive")
    print("  POST /course_details")
    print("  POST /summarize")
    print("  POST /ask_gemini")
    print("  POST /summarize_outlook_emails")
    print("  POST /disconnect/<service_type>")
    app.run(host=Config.FLASK_HOST, debug=Config.FLASK_DEBUG, port=Config.FLASK_PORT)
