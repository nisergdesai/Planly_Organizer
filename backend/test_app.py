from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])

# Stop any existing Flask servers first (Ctrl+C in all terminals)


from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])

@app.route('/health', methods=['GET'])
def health():
    print("Health endpoint hit!")
    return jsonify({"status": "healthy", "message": "Flask is working!"})

@app.route('/connect_gmail', methods=['POST'])
def connect_gmail():
    print("Gmail endpoint hit!")
    print("Form data:", dict(request.form))
    
    account_id = request.form.get('account_id', 'default')
    num_days = request.form.get('num_days', '-1')
    
    return jsonify({
        "status": "success",
        "account_id": account_id,
        "email_address": "test@gmail.com",
        "emails": [
            {
                "id": "1",
                "sender": "Test Sender",
                "subject": "Test Email",
                "date": "2024-01-01",
                "link": "https://mail.google.com"
            }
        ]
    })

if __name__ == '__main__':
    print("Starting Flask test server on http://localhost:5001")
    app.run(debug=True, host='0.0.0.0', port=5001)