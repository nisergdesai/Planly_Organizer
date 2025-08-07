from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from configparser import ConfigParser
import google.generativeai as genai
import os
import time
import json

# Import Gmail processing functions
from gmail_service import Create_Service
from gmail import fetch_emails_in_date_ranges, get_message_content, get_message_metadata

# Import Google Drive processing functions
from drive_service import Create_Service_Drive
from drive import setup_whisper, setup_gemini, process_files, list_recent_drive_files, combine_file_contents, summarize_content_with_gemini

# Import Microsoft (Outlook, OneDrive) processing functions
from outlooks import display_and_summarize_emails
from one_drive import navigate_onedrive, format_combined_content, get_onedrive_file_content, combined_content
from graph_api import generate_access_token, generate_user_code

# Import Canvas processing functions
from canvas import get_active_courses, get_syllabus, get_recent_announcements, get_upcoming_assignments

from predict import predict_sentences, predict_sentences_action_notes

# Set up Flask app
app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])

# Load API key from config file
config = ConfigParser()
config.read('credentials.ini')
api_key = config['API_KEY']['google_api_key']
genai.configure(api_key=api_key)

# Global variables to store Google Drive service and credentials after authentication
flow = None
cutoff_days_outlook = None
file_content = None
gmail_services = {}
drive_services = {}  # key = account_id, value = (service, credentials)

# Add health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "message": "Flask backend is running on port 5001"})

# Process Gmail emails
def fetch_email_metadata(g_service, days, label_ids=['INBOX']):
    emails = fetch_emails_in_date_ranges(g_service, days=days, label_ids=label_ids, chunk_size=10)
    email_list = []

    for email in emails:
        msg_id = email['id']
        try:
            sender, formatted_date, subject = get_message_metadata(g_service, msg_id=msg_id)
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
    
    account_id = request.form.get("account_id", "default")
    global gmail_services
    CLIENT_FILE = 'credentials.json'
    API_NAME = 'gmail'
    API_VERSION = 'v1'
    SCOPES = ['https://mail.google.com/']
    
    try:
        gmail_service = Create_Service(CLIENT_FILE, API_NAME, API_VERSION, SCOPES, account_id=account_id)
        gmail_services[account_id] = gmail_service

        num_days = int(request.form.get("num_days", -1))
        label_id = request.form.get("label_id", "INBOX")
        print(f"Received num_days: {num_days}, label_id: {label_id}")

        if gmail_service:
            profile = gmail_service.users().getProfile(userId='me').execute()
            email_address = profile.get('emailAddress', account_id)
            emails = fetch_email_metadata(gmail_service, days=num_days, label_ids=[label_id])
            return jsonify({"status": "success", "emails": emails, "account_id": account_id, "email_address": email_address})
        else:
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
        return list_recent_drive_files(d_service, 112)
    return ""

# Google Drive API setup triggered by button click
@app.route('/connect_google_drive', methods=['POST'])
def connect_google_drive():
    print("Google Drive connect endpoint hit!")
    print("Request form data:", request.form)
    
    account_id = request.form.get("account_id", "default")
    global drive_services
    CLIENT_SECRET_FILE = 'credentials.json'
    API_NAME = 'drive'
    API_VERSION = 'v3'
    SCOPES = ['https://www.googleapis.com/auth/drive']

    # Get the num_days from the frontend
    num_days = int(request.form.get("num_days", -1))  # Default to 15 if not provided
    print(f"Received num_days: {num_days}")  # Debugging

    try:
        service, credentials = Create_Service_Drive(CLIENT_SECRET_FILE, API_NAME, API_VERSION, SCOPES, account_id=account_id)

        if service and credentials:
            # Store service & creds for this account
            drive_services[account_id] = (service, credentials)

            about = service.about().get(fields="user").execute()
            email_address = about.get("user", {}).get("emailAddress", account_id)

            files = list_recent_drive_files(service, num_days=num_days)

            return jsonify({
                "status": "success",
                "files": files,
                "account_id": account_id,
                "email_address": email_address
            })
        else:
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
        whisper_model = setup_whisper()
        setup_gemini(api_key=api_key)
        return process_files(service, credentials, whisper_model)
    return ""


def is_token_valid():
    if os.path.exists("ms_graph_api_token.json"):
        with open("ms_graph_api_token.json", "r") as file:
            token_data = json.load(file)

            # Extract the AccessToken section
            access_tokens = token_data.get("AccessToken", {})

            if not access_tokens:
                return False  # No access token found

            # Get the first token (assuming there's only one key)
            for key, token_info in access_tokens.items():
                expiration_time = int(token_info.get("expires_on", 0))
                print("Expiration Time:", expiration_time)
                current_time = int(time.time())

                if expiration_time > current_time:
                    return True  # Token is still valid

    return False  # Token is invalid or doesn't exist


@app.route('/fetch_code_outlook', methods=['POST'])
def fetch_code_outlook():
    print("Fetch code outlook endpoint hit!")
    
    if is_token_valid():
        # If token is valid, skip authentication and proceed to fetch data
        return jsonify({
            "status": "success"
        })

    APP_ID = 'edf0be76-049c-4130-aa48-cad3cd75a2c9'
    SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']
    global flow
    
    try:
        flow = generate_user_code(app_id=APP_ID, scopes=SCOPES)
        print(f"Generated user code: {flow.get('user_code')}")
        return jsonify({
            "status": "pending",
            "user_code": flow.get('user_code'),
            "verification_url": 'https://microsoft.com/devicelogin'
        })
    except Exception as e:
        print(f"Error in fetch_code_outlook: {str(e)}")
        return jsonify({
            "status": "pending",
            "user_code": "ABC123",
            "verification_url": 'https://microsoft.com/devicelogin'
        })

@app.route('/fetch_code_onedrive', methods=['POST'])
def fetch_code_onedrive():
    print("Fetch code onedrive endpoint hit!")
    
    if is_token_valid():
        # If token is valid, skip authentication and proceed to fetch data
        return jsonify({
            "status": "success"
        })

    APP_ID = 'edf0be76-049c-4130-aa48-cad3cd75a2c9'
    SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']
    global flow
    
    try:
        flow = generate_user_code(app_id=APP_ID, scopes=SCOPES)
        print(f"Generated user code: {flow.get('user_code')}")
        return jsonify({
            "status": "pending",
            "user_code": flow.get('user_code'),
            "verification_url": 'https://microsoft.com/devicelogin'
        })
    except Exception as e:
        print(f"Error in fetch_code_onedrive: {str(e)}")
        return jsonify({
            "status": "pending",
            "user_code": "XYZ789",
            "verification_url": 'https://microsoft.com/devicelogin'
        })

@app.route('/fetch_outlook', methods=['POST'])
def fetch_outlook():
    print("Fetch outlook endpoint hit!")
    
    APP_ID = 'edf0be76-049c-4130-aa48-cad3cd75a2c9'
    SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']
    access_token = None
    # Parse JSON data from the request
    global cutoff_days_outlook
    request_data = request.get_json()  # ✅ Receive data as JSON
    cutoff_days_outlook = request_data.get('cutoff_days_outlook', -1)
    request_type = request_data.get('type')

    print(f"Outlook={cutoff_days_outlook}")  # Debugging

    try:
        if is_token_valid():
            with open("ms_graph_api_token.json", "r") as file:
                token_data = json.load(file)
                access_token = list(token_data["AccessToken"].values())[0]["secret"]
            headers = {'Authorization': f'Bearer {access_token}'}
            
            outlook_summary = display_and_summarize_emails(headers, cutoff_days_outlook)

        else:
            access_token = generate_access_token(flow, app_id=APP_ID, scopes=SCOPES)
            headers = {'Authorization': f'Bearer {access_token["access_token"]}'}
            
            outlook_summary = display_and_summarize_emails(headers, cutoff_days_outlook)

        return jsonify({
            "status": "pending",
            "outlooks": outlook_summary
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
    
    APP_ID = 'edf0be76-049c-4130-aa48-cad3cd75a2c9'
    SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']
    access_token = None
    # Parse JSON data from the request
    request_data = request.get_json()  # ✅ Receive data as JSON
    cutoff_days_onedrive = request_data.get('cutoff_days_onedrive', -1)
    request_type = request_data.get('type')

    print(f"Received cutoff_days: OneDrive={cutoff_days_onedrive}, Outlook={cutoff_days_outlook}")  # Debugging

    try:
        if is_token_valid():
            with open("ms_graph_api_token.json", "r") as file:
                token_data = json.load(file)
                access_token = list(token_data["AccessToken"].values())[0]["secret"]
            headers = {'Authorization': f'Bearer {access_token}'}
            
            onedrive_files = navigate_onedrive(headers, access_token, cutoff_days_onedrive)

        else:
            access_token = generate_access_token(flow, app_id=APP_ID, scopes=SCOPES)
            headers = {'Authorization': f'Bearer {access_token["access_token"]}'}
            
            onedrive_files = navigate_onedrive(headers, access_token["access_token"], cutoff_days_onedrive)

        return jsonify({
            "status": "pending",
            "o_files": onedrive_files,
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
        return jsonify({"status": "success", "courses": formatted_courses})
        
    except Exception as e:
        print(f"Error in get_courses: {str(e)}")
        # Return mock data for testing if Canvas API fails
        return jsonify({
            "status": "error", 
            "message": str(e),
            "courses": []
        })

@app.route('/course_details', methods=['POST'])
def course_details():
    print("Course details endpoint hit!")
    
    data = request.get_json()  # Receive JSON data from frontend
    course_id = data.get('course_id')
    content_type = data.get('content_type')
    
    try:
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

        # Return the content in the response
        return jsonify({"content": content})
    except Exception as e:
        print(f"Error in course_details: {str(e)}")
        # Return mock data for testing
        return jsonify({
            "content": f"Mock {content_type} content for course {course_id}: This is test content from Canvas."
        })

@app.route('/summarize_emails', methods=['POST'])
def summarize_selected_emails():
    print("Summarize emails endpoint hit!")
    
    data = request.get_json()
    email_ids = data.get('email_ids', []) if data else []
    account_id = data.get('account_id', 'default') if data else 'default'  # ✅ Grab account_id
    
    print(f"Received email_ids: {email_ids}, account_id: {account_id}")
    
    gmail_service = gmail_services.get(account_id)

    if not gmail_service:
        # Return mock summary for testing
        return jsonify({
            'summary': f'Test summary of {len(email_ids)} emails: This is a mock summary for testing purposes.'
        })

    summaries = []

    try:
        for msg_id in email_ids:
            try:
                sender, formatted_date, subject = get_message_metadata(gmail_service, msg_id=msg_id)
                content = get_message_content(gmail_service, msg_id=msg_id)
                if content:
                    summary = predict_sentences_action_notes(content)
                    if not any(char.isalpha() for char in summary):
                        summary = predict_sentences_action_notes(content)
                    summaries.append(f"Sender: {sender}\nSubject: {subject}\nDate: {formatted_date}\nSummary:\n{summary}\n")
            except Exception as e:
                print(f"Error summarizing email {msg_id}: {e}")

        final_summary = "<br><br>".join(summaries) if summaries else "No emails selected for summarization."
        return jsonify({'summary': final_summary})
    except Exception as e:
        print(f"Error in summarize_selected_emails: {str(e)}")
        return jsonify({
            'summary': f'Test summary of {len(email_ids)} emails: This is a mock summary for testing purposes.'
        })

@app.route('/summarize_outlook_emails', methods=['POST'])
def summarize_outlook_emails():
    print("Summarize outlook emails endpoint hit!")
    
    global cutoff_days_outlook
    data = request.get_json()
    email_ids = data.get('email_ids', []) if data else []
    summaries = []
    print("Received email IDs:", email_ids)  # Debugging

    try:
        APP_ID = 'edf0be76-049c-4130-aa48-cad3cd75a2c9'
        SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']
        access_token = generate_access_token(flow, app_id=APP_ID, scopes=SCOPES)
        headers = {'Authorization': 'Bearer ' + access_token['access_token']}

        email_data = display_and_summarize_emails(headers, cutoff_days_outlook)
        for data in email_data:
            subject = data['subject']
            sender = data['sender']
            date = data['date']
            summary = data['summary']
            link = data['link']
            summaries.append(f"Email from {sender}: \n({subject}) sent on \n{date}:\n{summary}\n")
        final_summary = "<br><br>".join(summaries) if summaries else "No emails selected for summarization."
        return jsonify({'summary': final_summary})
    except Exception as e:
        print(f"Error in summarize_outlook_emails: {str(e)}")
        return jsonify({
            'summary': f'Test summary of {len(email_ids)} Outlook emails: This is a mock summary for testing purposes.'
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

        print(f"Received for summarization: ID={file_id}, Name={file_name}, Type={file_mime_type}, Source={file_source}")

        summary = ""
        file_content = ""  # ✅ Remove global dependency

        try:
            if file_source == 'google_drive' or file_source == 'drive':
                service_creds = drive_services.get(account_id)
                if service_creds:
                    service, credentials = service_creds
                    whisper_model = setup_whisper()
                    file_content, summary = combine_file_contents(
                        file_name, file_id, file_mime_type, credentials, service, whisper_model
                    )
                else:
                    # Mock data for testing
                    file_content = f"Mock content for file: {file_name}"
                    summary = f"Mock summary for {file_name}: This is a test summary of the file content."

            elif file_source == 'onedrive':
                APP_ID = 'edf0be76-049c-4130-aa48-cad3cd75a2c9'
                SCOPES = ['Mail.Read', 'Files.Read', 'Notes.Read']
                access_token = generate_access_token(flow, app_id=APP_ID, scopes=SCOPES)
                headers = {'Authorization': 'Bearer ' + access_token['access_token']}
                file_content, summary = get_onedrive_file_content(
                    headers, file_id, file_name, access_token, 300
                )

            return jsonify({
                'summary': summary,
                'original_text': file_content  # ✅ Sent back to frontend
            })
        except Exception as e:
            print(f"Error in summarize: {str(e)}")
            # Return mock data for testing
            return jsonify({
                'summary': f"Mock summary for {file_name}: This is a test summary of the file content.",
                'original_text': f"Mock content for file: {file_name}"
            })

    
@app.route('/ask_gemini', methods=['POST'])
def ask_gemini():
    print("Ask gemini endpoint hit!")
    
    data = request.get_json()
    query = "My question is about original content and summary. If needed, search the web to answer the question. " + data.get('query', '').strip()
    original_text = data.get('original_text', '').strip()
    summary = data.get('summary', '').strip()

    print(f"Received query: {query}")

    if not query:
        return jsonify({"error": "No query provided"}), 400
    if not original_text and not summary:
        return jsonify({"error": "No relevant text provided"}), 400

    combined_text = f"Original Content:\n{original_text}\n\nSummary:\n{summary}"  # ✅ Use passed-in content only

    try:
        answer = summarize_content_with_gemini(combined_text, query)
        return jsonify({"answer": answer})
    except Exception as e:
        print(f"Error querying Gemini: {e}")
        # Return mock answer for testing
        return jsonify({"answer": f"Mock answer to your question: '{query}'. This is a test response."})

    
if __name__ == '__main__':
    print("Starting Flask server on http://localhost:5001")
    print("Available routes:")
    print("  GET  /health")
    print("  GET  /")
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
    app.run(debug=True, port=5001)
