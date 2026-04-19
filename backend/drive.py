"""
Google Drive integration — file listing, content extraction, and Gemini summarization.
"""

import os
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import io
try:
    import whisper
except ImportError:
    whisper = None
    print("Warning: whisper not installed — audio/video transcription will be unavailable")
import PyPDF2
import tempfile
import datetime
import time
import random
from googleapiclient.http import MediaIoBaseDownload
from google.cloud import vision
import pandas as pd
from drive_service import Create_Service_Drive
from googleapiclient.discovery import build
from google import genai
from google.genai import types
from text_cleaning import clean_summary_text
from docx import Document
from config import Config


def retry_with_backoff(api_call, max_retries=5):
    """Retry logic with exponential backoff for API calls."""
    retries = 0
    while retries < max_retries:
        try:
            return api_call()
        except Exception as e:
            if "429" in str(e):  # Check for rate limit error
                wait_time = (2 ** retries) + random.uniform(0, 1)
                print(f"Rate limit reached. Retrying in {wait_time:.2f} seconds...")
                time.sleep(wait_time)
                retries += 1
            else:
                raise e
    raise Exception("Max retries reached")

def setup_whisper(model_name="base"):
    return whisper.load_model(model_name)

def transcribe_audio_video(whisper_model, file_path):
    result = whisper_model.transcribe(file_path)
    return result['text']

def read_audio_video(service, whisper_model, file_id, file_name):
    temp_file_path = None
    try:
        # Retry logic for API call to get media
        request = retry_with_backoff(lambda: service.files().get_media(fileId=file_id))
        with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file_name}") as temp_file:
            downloader = MediaIoBaseDownload(temp_file, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            temp_file_path = temp_file.name

        # Transcribe the content
        transcribed_text = transcribe_audio_video(whisper_model, temp_file_path)
    except Exception as e:
        print(f"Error transcribing {file_name}: {e}")
        transcribed_text = ""
    finally:
        # Ensure the temporary file is deleted
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)

    return transcribed_text

def setup_vision_client(service_account_path):
    os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = service_account_path
    return vision.ImageAnnotatorClient()

def detect_text_from_image(client, image_content):
    image = vision.Image(content=image_content)
    response = client.text_detection(image=image)
    return response

def detect_handwriting_from_image(client, image_content):
    image = vision.Image(content=image_content)
    response = client.document_text_detection(image=image)
    return response

def process_text_annotations(response):
    df = pd.DataFrame(columns=['locale', 'description'])
    texts = response.text_annotations

    rows = []
    for text in texts:
        rows.append(dict(
            locale=text.locale,
            description=text.description
        ))

    df = pd.concat([df, pd.DataFrame(rows)], ignore_index=True)
    return df


# Vision client setup — only if ServiceAccountToken.json exists
try:
    vision_client = setup_vision_client(r"ServiceAccountToken.json")
except Exception:
    vision_client = None
    print("Warning: Could not initialize Vision client (ServiceAccountToken.json missing or invalid)")


def setup_gemini(api_key=None):
    key = api_key or Config.GEMINI_API_KEY
    return genai.Client(api_key=key)

def summarize_content_with_gemini(content, question='summarize'):
    client = setup_gemini()
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[question, content],
        config=types.GenerateContentConfig(
            safety_settings=[
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                ),
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                ),
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                ),
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                ),
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
                    threshold=types.HarmBlockThreshold.BLOCK_NONE,
                ),
            ]
        )
    )

    return clean_summary_text(response.text)


def get_cutoff_date():
    now = datetime.datetime.utcnow()
    cutoff_date = now - datetime.timedelta(weeks=16)
    return cutoff_date.isoformat() + 'Z'

def list_recent_drive_files(service, num_days=112):
    now = datetime.datetime.utcnow()
    cutoff_date = now - datetime.timedelta(days=num_days)
    cutoff_date = cutoff_date.isoformat() + 'Z'
    query = f"modifiedTime > '{cutoff_date}'"

    # Apply retry logic to the API call for listing files
    def api_call():
        return service.files().list(q=query, pageSize=100, fields="files(id, name, mimeType, modifiedTime)").execute()

    try:
        results = retry_with_backoff(api_call)
        items = results.get('files', [])
    except Exception as e:
        print(f"Error listing files: {e}")
        return []

    # Allowed MIME types (matching those used in combine_file_contents)
    allowed_mime_types = {
        'application/vnd.google-apps.document',  # Google Docs
        'application/vnd.google-apps.presentation',  # Google Slides
        'application/vnd.google-apps.spreadsheet',  # Google Sheets
        'application/pdf',  # PDFs
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' # Docx
    }

    # Include audio and video types
    allowed_mime_prefixes = ('audio/', 'video/')

    filtered_files = [
        file for file in items if 
        file['mimeType'] in allowed_mime_types or 
        file['mimeType'].startswith(allowed_mime_prefixes)
    ]

    return filtered_files  # Return the list instead of printing


def read_google_doc(credentials, file_id):
    docs_service = build('docs', 'v1', credentials=credentials)
    request = retry_with_backoff(lambda: docs_service.documents().get(documentId=file_id).execute())
    document = request
    content = document.get('body').get('content')

    text = ''
    for element in content:
        if 'paragraph' in element:
            for text_run in element.get('paragraph').get('elements', []):
                if 'textRun' in text_run:
                    text += text_run['textRun'].get('content', '')
    return text

def read_google_sheet(credentials, spreadsheet_id, range_name='A1:Z1000'):
    sheets_service = build('sheets', 'v4', credentials=credentials)
    request = retry_with_backoff(lambda: sheets_service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=range_name).execute())
    sheet = request
    values = sheet.get('values', [])
    
    content = "\n".join([", ".join(row) for row in values])
    return content

def read_google_slides(credentials, presentation_id):
    slides_service = build('slides', 'v1', credentials=credentials)
    request = retry_with_backoff(lambda: slides_service.presentations().get(presentationId=presentation_id).execute())
    presentation = request
    slides = presentation.get('slides')

    text = ''
    for slide in slides:
        for element in slide.get('pageElements', []):
            if 'shape' in element and 'text' in element['shape']:
                text_elements = element['shape']['text']['textElements']
                for text_element in text_elements:
                    if 'textRun' in text_element:
                        text += text_element['textRun'].get('content', '').strip() + '\n'
    return text

def read_pdf_file(service, file_id, file_name):
    request = service.files().get_media(fileId=file_id)
    with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file_name}.pdf") as temp_file:
        downloader = MediaIoBaseDownload(temp_file, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        temp_file_path = temp_file.name

    try:
        text = ""
        with open(temp_file_path, "rb") as pdf_file:
            reader = PyPDF2.PdfReader(pdf_file)
            for page in reader.pages:
                # Extract text and replace any newlines with spaces
                page_text = page.extract_text() or ""
                text += page_text.replace("\n", " ")  # Replace newlines with spaces
    except Exception as e:
        print(f"Error reading PDF file {file_name}: {e}")
        text = ""
    finally:
        os.remove(temp_file_path)

    return text

def read_docx_file(service, file_id, file_name):
    request = service.files().get_media(fileId=file_id)
    with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file_name}.docx") as temp_file:
        downloader = MediaIoBaseDownload(temp_file, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        temp_file_path = temp_file.name

    try:
        doc = Document(temp_file_path)
        text = "\n".join([para.text for para in doc.paragraphs])
    except Exception as e:
        print(f"Error reading DOCX file {file_name}: {e}")
        text = ""
    finally:
        os.remove(temp_file_path)

    return text

def combine_file_contents(file_name, file_id, mime_type, credentials, service, whisper_model):
    combined_content_list = []

    content = ""

    if mime_type == 'application/vnd.google-apps.document':
        content = read_google_doc(credentials, file_id)
    elif mime_type == 'application/vnd.google-apps.presentation':
        content = read_google_slides(credentials, file_id)
    elif mime_type == 'application/vnd.google-apps.spreadsheet':
        content = read_google_sheet(credentials, file_id)
    elif mime_type.startswith('audio/') or mime_type.startswith('video/'):
        content = read_audio_video(service, whisper_model, file_id, file_name)
    elif mime_type == 'application/pdf':
        content = read_pdf_file(service, file_id, file_name)
    elif mime_type == 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':  # DOCX MIME type
        content = read_docx_file(service, file_id, file_name)

    return content, summarize_content_with_gemini(content)

def generate_todo_list(content):
    return summarize_content_with_gemini(content)

def process_files(service, credentials, whisper_model):
    files = list_recent_drive_files(service)
    if not files:
        return

    combined_content = combine_file_contents(files, credentials, service, whisper_model)

    if combined_content:
        return (combined_content)
