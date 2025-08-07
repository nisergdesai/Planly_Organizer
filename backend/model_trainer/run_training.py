import torch
import json
import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt
from torch import nn
from transformers import (
    DistilBertForSequenceClassification, 
    DistilBertTokenizer,
    Trainer, 
    TrainingArguments, 
    EarlyStoppingCallback
)
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix
from sklearn.utils.class_weight import compute_class_weight
import os
import warnings
warnings.filterwarnings("ignore")

# Force CPU usage
torch.backends.mps.is_available = lambda: False
device = torch.device("cpu")
print(f"Forcing CPU usage: {device}")

# Use the same classes and functions from the fixed version
class EmailDataset(torch.utils.data.Dataset):
    def __init__(self, encodings, labels):
        self.encodings = encodings
        self.labels = labels

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        item = {key: torch.tensor(val[idx], dtype=torch.long) for key, val in self.encodings.items()}
        item["labels"] = torch.tensor(self.labels[idx], dtype=torch.long)
        return item

def compute_metrics(p):
    logits, labels = p
    predictions = np.argmax(logits, axis=1)
    precision, recall, f1, _ = precision_recall_fscore_support(labels, predictions, average='weighted')
    
    return {
        'accuracy': accuracy_score(labels, predictions),
        'precision': precision,
        'recall': recall,
        'f1': f1
    }

def create_sample_datasets():
    """Create sample datasets for testing"""
    print("Creating sample datasets...")
    
    sample_texts = [
        "Please complete the quarterly report by Friday",
        "URGENT: Server maintenance scheduled for tonight", 
        "Meeting reminder: Team standup at 10 AM",
        "FYI: New company policy regarding remote work",
        "Action required: Update your password",
        "Note: Office will be closed on Monday",
        "Task: Review the marketing proposal", 
        "Important: Budget approval needed",
        "Please note the change in meeting time",
        "Complete the training module by end of week",
        "Submit your timesheet by EOD",
        "Reminder: All hands meeting tomorrow",
        "Please review and approve the contract",
        "FYI: System update completed successfully",
        "Action needed: Sign the NDA document",
        "Note: Parking lot will be closed for repairs",
        "Task: Prepare presentation for client meeting",
        "Important: New security protocols in effect",
        "Please confirm your attendance for the event",
        "Complete the mandatory training course"
    ]
    
    sample_labels = [0, 1, 0, 1, 0, 1, 0, 1, 2, 0, 0, 1, 0, 1, 0, 1, 0, 1, 2, 0]
    
    tokenizer = DistilBertTokenizer.from_pretrained('distilbert-base-uncased')
    encodings = tokenizer(sample_texts, truncation=True, padding=True, max_length=128, return_tensors='pt')
    encodings_dict = {key: val.tolist() for key, val in encodings.items()}
    
    train_size = int(0.7 * len(sample_texts))
    val_size = int(0.15 * len(sample_texts))
    
    train_encodings = {key: val[:train_size] for key, val in encodings_dict.items()}
    val_encodings = {key: val[train_size:train_size+val_size] for key, val in encodings_dict.items()}
    test_encodings = {key: val[train_size+val_size:] for key, val in encodings_dict.items()}
    
    train_labels = sample_labels[:train_size]
    val_labels = sample_labels[train_size:train_size+val_size]
    test_labels = sample_labels[train_size+val_size:]
    
    train_dataset = EmailDataset(train_encodings, train_labels)
    val_dataset = EmailDataset(val_encodings, val_labels)
    test_dataset = EmailDataset(test_encodings, test_labels)
    
    torch.save(train_dataset, 'train_dataset.pt')
    torch.save(val_dataset, 'val_dataset.pt') 
    torch.save(test_dataset, 'test_dataset.pt')
    
    print(f"Created datasets: Train={len(train_dataset)}, Val={len(val_dataset)}, Test={len(test_dataset)}")
    return train_dataset, val_dataset, test_dataset

def main():
    print("Starting CPU-only training...")
    
    try:
        # Load or create datasets
        try:
            train_dataset = torch.load("train_dataset.pt")
            val_dataset = torch.load("val_dataset.pt")
            test_dataset = torch.load("test_dataset.pt")
            print("Datasets loaded successfully!")
        except FileNotFoundError:
            train_dataset, val_dataset, test_dataset = create_sample_datasets()
        
        # Initialize model
        model = DistilBertForSequenceClassification.from_pretrained(
            "distilbert-base-uncased", 
            num_labels=3
        )
        
        # Training arguments optimized for CPU
        training_args = TrainingArguments(
            output_dir='./results',
            num_train_epochs=3,  # Reduced for CPU
            per_device_train_batch_size=4,  # Small batch size for CPU
            per_device_eval_batch_size=4,
            evaluation_strategy="epoch",
            save_strategy="epoch",
            logging_steps=2,
            learning_rate=2e-5,
            weight_decay=0.01,
            save_total_limit=1,
            load_best_model_at_end=True,
            metric_for_best_model="eval_f1",
            greater_is_better=True,
            report_to=None,
            dataloader_num_workers=0,
        )
        
        # Initialize trainer
        trainer = Trainer(
            model=model,
            args=training_args,
            train_dataset=train_dataset,
            eval_dataset=val_dataset,
            compute_metrics=compute_metrics,
        )
        
        # Train
        print("Starting training on CPU...")
        trainer.train()
        
        # Evaluate
        test_results = trainer.evaluate(test_dataset)
        print("Test results:", test_results)
        
        # Save model
        model.save_pretrained("email_task_classifier_cpu")
        tokenizer = DistilBertTokenizer.from_pretrained('distilbert-base-uncased')
        tokenizer.save_pretrained("email_task_classifier_cpu")
        
        print("Training completed successfully on CPU!")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
