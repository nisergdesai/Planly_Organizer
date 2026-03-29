import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import time
import random
from predict import predict_sentences, predict_sentences_action_notes

GRAPH_API_ENDPOINT = 'https://graph.microsoft.com/v1.0'


def retry_with_backoff(api_call, max_retries=5):
    """Retry logic with exponential backoff for API calls."""
    retries = 0
    while retries < max_retries:
        try:
            return api_call()
        except requests.exceptions.RequestException as e:
            if "429" in str(e):
                wait_time = (2 ** retries) + random.uniform(0, 1)
                print(f"Rate limit reached. Retrying in {wait_time:.2f} seconds...")
                time.sleep(wait_time)
                retries += 1
            else:
                print(f"Error occurred: {e}. Retrying...")
                time.sleep(2 ** retries)
                retries += 1
    raise Exception("Max retries reached. The operation failed.")


def display_and_summarize_emails(headers, cutoff_days=7):
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=cutoff_days)
        cutoff_date_str = cutoff_date.strftime('%Y-%m-%dT%H:%M:%SZ')

        params = {
            '$select': 'id,subject,from,receivedDateTime,bodyPreview,body',
            '$filter': f"receivedDateTime ge {cutoff_date_str}"
        }

        response = retry_with_backoff(lambda: requests.get(f'{GRAPH_API_ENDPOINT}/me/mailFolders/inbox/messages', headers=headers, params=params))
        response.raise_for_status()

        emails = response.json().get('value', [])
        if not emails:
            print("No emails found within the cutoff date.")
            return []

        outlook_emails = []

        for email in emails:
            email_id = email.get('id', 'Unknown ID')
            subject = email.get('subject', 'No Subject')
            sender = email.get('from', {}).get('emailAddress', {}).get('address', 'Unknown Sender')
            received_time = email.get('receivedDateTime', 'No Date')
            body_content = email.get('body', {}).get('content', 'No Content Available')

            formatted_date = 'No Date'
            if received_time != 'No Date':
                date_object = datetime.fromisoformat(received_time[:-1])
                formatted_date = date_object.strftime('%m/%d/%y')

            soup = BeautifulSoup(body_content, 'html.parser')
            clean_text = soup.get_text().strip()

            summary = predict_sentences(clean_text) if clean_text else "No important content detected."

            email_metadata = {
                "id": email_id,
                "subject": subject.strip() or 'No Action',
                "sender": sender,
                "date": formatted_date,
                "summary": summary,
                "link": f"https://outlook.office.com/mail/inbox/id/{email_id}"
            }

            outlook_emails.append(email_metadata)

        return outlook_emails

    except requests.exceptions.HTTPError as http_err:
        print(f"HTTP error occurred: {http_err}")
    except Exception as err:
        print(f"Other error occurred: {err}")

    return []
