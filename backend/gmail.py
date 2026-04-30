from gmail_service import Create_Service
import base64
from email import message_from_bytes
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import time
import random

CLIENT_FILE = 'credentials.json'
API_NAME = 'gmail'
API_VERSION = 'v1'
SCOPES = ['https://mail.google.com/']


def retry_with_backoff(api_call, max_retries=5):
    """Retry logic with exponential backoff for API calls."""
    retries = 0
    while retries < max_retries:
        try:
            return api_call()
        except Exception as e:
            if "429" in str(e):
                wait_time = (2 ** retries) + random.uniform(0, 1)
                print(f"Rate limit reached. Retrying in {wait_time:.2f} seconds...")
                time.sleep(wait_time)
                retries += 1
            else:
                raise e
    raise Exception("Max retries reached")


def fetch_emails_in_date_ranges(service, user_id='me', label_ids=['INBOX'], days=3, chunk_size=10):
    """Fetch emails in smaller date ranges to bypass API limitations."""
    now = datetime.utcnow()
    messages = []

    for i in range(0, days, chunk_size):
        actual_chunk_size = min(chunk_size, days - i)
        start_date = now - timedelta(days=i + actual_chunk_size)
        end_date = now - timedelta(days=i)

        query = f"after:{start_date.strftime('%Y/%m/%d')} before:{(end_date + timedelta(days=1)).strftime('%Y/%m/%d')}"
        print(f"Querying emails with: {query}")

        page_token = None
        while True:
            response = retry_with_backoff(lambda: service.users().messages().list(
                userId=user_id,
                labelIds=label_ids,
                q=query,
                pageToken=page_token,
                maxResults=500
            ).execute())

            fetched_messages = response.get('messages', [])
            print(f"Fetched {len(fetched_messages)} messages in range {start_date} to {end_date}.")
            messages.extend(fetched_messages)
            page_token = response.get('nextPageToken')

            if not page_token:
                break

    print(f"Total emails fetched: {len(messages)}")
    return messages


def get_message_metadata(service, user_id='me', msg_id=''):
    """Retrieve metadata like the sender, date, and subject from the email."""
    try:
        msg = retry_with_backoff(lambda: service.users().messages().get(
            userId=user_id, id=msg_id, format='metadata', metadataHeaders=['From', 'Date', 'Subject']
        ).execute())

        headers = msg['payload']['headers']
        sender = next((header['value'] for header in headers if header['name'] == 'From'), 'unknown sender')
        date = next((header['value'] for header in headers if header['name'] == 'Date'), 'unknown date')
        subject = next((header['value'] for header in headers if header['name'] == 'Subject'), 'No Subject')

        try:
            formatted_date = datetime.strptime(date, '%a, %d %b %Y %H:%M:%S %z').strftime('%Y-%m-%d %H:%M:%S')
        except ValueError:
            formatted_date = date

        return sender, formatted_date, subject
    except Exception as error:
        print(f"An error occurred while retrieving metadata: {error}")
        return 'unknown sender', 'unknown date', 'No Subject'


def get_message_content(service, user_id='me', msg_id=''):
    """Retrieve and decode the email message content, extracting HTML and plain text."""
    try:
        msg = retry_with_backoff(lambda: service.users().messages().get(
            userId=user_id, id=msg_id, format='raw'
        ).execute())

        msg_str = base64.urlsafe_b64decode(msg['raw'].encode('ASCII'))
        mime_msg = message_from_bytes(msg_str)

        html_content, text_content = None, None
        for part in mime_msg.walk():
            if part.get_content_type() == 'text/html':
                html_content = part.get_payload(decode=True).decode()
            elif part.get_content_type() == 'text/plain':
                text_content = part.get_payload(decode=True).decode()

        if html_content:
            soup = BeautifulSoup(html_content, 'html.parser')
            for script in soup(["script", "style"]):
                script.decompose()
            text = soup.get_text(separator=' ')
        elif text_content:
            text = text_content
        else:
            return 'No content found.'

        return clean_email_text(text)
    except Exception as error:
        print(f"An error occurred: {error}")
        return None


def clean_email_text(text):
    """Clean up the email text by removing unnecessary content."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    cleaned_text = ' '.join(lines)
    footer_keywords = ['unsubscribe', 'no longer want to receive this email', 'this email was sent to']
    for keyword in footer_keywords:
        cleaned_text = cleaned_text.replace(keyword, '')
    return cleaned_text.strip()
