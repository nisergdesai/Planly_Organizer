import os
from typing import Any

import torch
from torch import nn
from transformers import AutoTokenizer, DistilBertForSequenceClassification
from nltk.tokenize import sent_tokenize, word_tokenize
from nltk.stem import WordNetLemmatizer

# Re-define the custom model class
class CustomDistilBertForSequenceClassification(DistilBertForSequenceClassification):
    def __init__(self, config):
        super().__init__(config)
        # Initialize the custom layers that were not part of the pre-trained model
        self.fc1 = nn.Linear(config.hidden_size, 128)
        self.fc2 = nn.Linear(128, config.num_labels)
        self.dropout = nn.Dropout(0.3)
        self.loss_fn = nn.CrossEntropyLoss()

    def forward(self, input_ids=None, attention_mask=None, labels=None):
        # Get the output from the DistilBERT model
        outputs = self.distilbert(input_ids=input_ids, attention_mask=attention_mask)
        hidden_state = outputs[0][:, 0, :]  # Get the hidden state from the first token (CLS token)
        
        # Pass through custom layers
        hidden_state = self.fc1(hidden_state)
        hidden_state = torch.relu(hidden_state)
        hidden_state = self.dropout(hidden_state)
        logits = self.fc2(hidden_state)

        loss = None
        if labels is not None:
            loss = self.loss_fn(logits, labels)
            return (loss, logits)
        return logits

_MODEL_DIR = os.getenv("EMAIL_TASK_MODEL_DIR", "model_trainer/email_task_classifier_cpu")
_MODEL: CustomDistilBertForSequenceClassification | None = None
_TOKENIZER: Any | None = None
_MODEL_LOAD_ERROR: str | None = None


def _simple_sentence_split(text: str) -> list[str]:
    parts = []
    for chunk in text.replace("\n", " ").split("."):
        cleaned = chunk.strip()
        if cleaned:
            parts.append(cleaned + ".")
    return parts


def _get_sentences(text: str) -> list[str]:
    try:
        return sent_tokenize(text)
    except Exception:
        return _simple_sentence_split(text)


def _ensure_model_loaded() -> bool:
    """
    Attempt to load the custom classifier from a local directory.

    Important: this intentionally avoids downloading from HuggingFace Hub so
    cloud deploys (Render) work without extra auth/network dependencies.
    """
    global _MODEL, _TOKENIZER, _MODEL_LOAD_ERROR
    if _MODEL is not None and _TOKENIZER is not None:
        return True
    if _MODEL_LOAD_ERROR is not None:
        return False

    if not os.path.isdir(_MODEL_DIR):
        _MODEL_LOAD_ERROR = f"Model directory not found: {_MODEL_DIR}"
        return False

    try:
        _MODEL = CustomDistilBertForSequenceClassification.from_pretrained(
            _MODEL_DIR,
            local_files_only=True,
        )
        _TOKENIZER = AutoTokenizer.from_pretrained(
            _MODEL_DIR,
            local_files_only=True,
            use_fast=True,
        )
        return True
    except Exception as e:
        _MODEL_LOAD_ERROR = str(e)
        _MODEL = None
        _TOKENIZER = None
        return False

# Function to preprocess the text (same as in process.py)
def preprocess_text(text):
    text = text.lower()  # Convert to lowercase
    tokens = word_tokenize(text)  # Tokenize text
    lemmatizer = WordNetLemmatizer()
    tokens = [lemmatizer.lemmatize(word) for word in tokens]
    return ' '.join(tokens)

# Function to predict the label of new text
def predict(text):
    if not _ensure_model_loaded():
        # Deployed environments may not include the optional classifier artifacts.
        return 2  # "Other" / default class

    # Preprocess the input text
    processed_text = preprocess_text(text)
    
    # Tokenize and encode the text for the model
    inputs = _TOKENIZER(processed_text, truncation=True, padding=True, max_length=128, return_tensors="pt")

    # Ensure the model is in evaluation mode
    _MODEL.eval()

    # Predict the label
    with torch.no_grad():
        outputs = _MODEL(**inputs)
        logits = outputs  # Now the output is a tensor directly
        prediction = torch.argmax(logits, dim=1).item()
        
    return prediction

# Function to predict each sentence in the input text
# Function to predict each sentence in the input text
def predict_sentences(text):
    sentences = _get_sentences(text)  # Split the text into sentences
    results = []

    for sentence in sentences:
        label = predict(sentence)  # Predict the label for each sentence
        if label == 0:  # Check if the label is Action Task (0) or Important Note (1)
            results.append(sentence)  # Add the sentence to results if it matches the labels

    # Join the selected sentences into one paragraph
    return ' '.join(results)

def predict_sentences_action_notes(text):
    sentences = _get_sentences(text)  # Split the text into sentences
    results = []

    for sentence in sentences:
        label = predict(sentence)  # Predict the label for each sentence
        if label == 0 or label == 1:  # Check if the label is Action Task (0) or Important Note (1)
            results.append(sentence)  # Add the sentence to results if it matches the labels

    # Join the selected sentences into one paragraph
    return ' '.join(results)
