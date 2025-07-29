// Response type interfaces
export interface GmailLabel {
  id: string
  name: string
}

export interface GmailEmail {
  id: string
  sender: string
  subject: string
  date: string
  link: string
}

export interface GmailConnectResponse {
  status: string
  account_id: string
  email_address: string
  emails: GmailEmail[]
}

export interface GmailLabelsResponse {
  status: string
  labels: GmailLabel[]
}

export interface SummarizeResponse {
  status: string
  summary: string
}

// API utility functions for backend communication

export interface ApiResponse<T = any> {
  status: string
  data?: T
  error?: string
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
}

export interface DriveConnectResponse {
  status: string
  account_id: string
  email_address: string
  files: DriveFile[]
}

export interface SummarizeFileResponse {
  status: string
  summary: string
  original_text: string
}

export interface GeminiResponse {
  status: string
  answer: string
}

class ApiClient {
  private baseUrl: string

  constructor(baseUrl = "/api") {
    this.baseUrl = baseUrl
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`

    const config: RequestInit = {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    }

    try {
      const response = await fetch(url, config)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      console.error(`API request failed for ${endpoint}:`, error)
      throw error
    }
  }

  // Gmail API methods
  async connectGmail(accountId: string, numDays = -1, labelId?: string): Promise<GmailConnectResponse> {
    const formData = new FormData()
    formData.append("account_id", accountId)
    formData.append("num_days", numDays.toString())
    if (labelId) formData.append("label_id", labelId)

    const response = await fetch(`${this.baseUrl}/connect_gmail`, {
      method: "POST",
      body: formData,
    })
    return response.json()
  }

  async getGmailLabels(accountId: string): Promise<GmailLabelsResponse> {
    const response = await fetch(`${this.baseUrl}/get_gmail_labels`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ account_id: accountId }),
    })
    return response.json()
  }

  async summarizeEmails(emailIds: string[], accountId?: string): Promise<SummarizeResponse> {
    const response = await fetch(`${this.baseUrl}/summarize_emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_ids: emailIds,
        ...(accountId && { account_id: accountId }),
      }),
    })
    return response.json()
  }

  // Google Drive API methods
  async connectGoogleDrive(accountId: string, numDays = -1): Promise<DriveConnectResponse> {
    const formData = new FormData()
    formData.append("account_id", accountId)
    formData.append("num_days", numDays.toString())

    const response = await fetch(`${this.baseUrl}/connect_google_drive`, {
      method: "POST",
      body: formData,
    })
    return response.json()
  }

  // Outlook API methods
  async fetchCodeOutlook() {
    return this.request("/fetch_code_outlook", {
      method: "POST",
    })
  }

  async fetchOutlook(cutoffDays = -1, type = "outlook") {
    return this.request("/fetch_outlook", {
      method: "POST",
      body: JSON.stringify({
        cutoff_days_outlook: cutoffDays,
        type: type,
      }),
    })
  }

  async summarizeOutlookEmails(emailIds: string[]) {
    return this.request("/summarize_outlook_emails", {
      method: "POST",
      body: JSON.stringify({ email_ids: emailIds }),
    })
  }

  // OneDrive API methods
  async fetchCodeOnedrive() {
    return this.request("/fetch_code_onedrive", {
      method: "POST",
    })
  }

  async fetchOnedrive(cutoffDays = -1, type = "onedrive") {
    return this.request("/fetch_onedrive", {
      method: "POST",
      body: JSON.stringify({
        cutoff_days_onedrive: cutoffDays,
        type: type,
      }),
    })
  }

  // File summarization
  async summarizeFile(
    fileId: string,
    fileName: string,
    fileMimeType: string,
    fileSource: string,
    accountId?: string,
  ): Promise<SummarizeFileResponse> {
    const formData = new FormData()
    formData.append("file_id", fileId)
    formData.append("file_name", fileName)
    formData.append("file_mime_type", fileMimeType)
    formData.append("file_source", fileSource)
    if (accountId) formData.append("account_id", accountId)

    const response = await fetch(`${this.baseUrl}/summarize`, {
      method: "POST",
      body: formData,
    })
    return response.json()
  }

  // AI Q&A
  async askGemini(query: string, originalText: string, summary: string): Promise<GeminiResponse> {
    const response = await fetch(`${this.baseUrl}/ask_gemini`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query,
        original_text: originalText,
        summary: summary,
      }),
    })
    return response.json()
  }

  // Canvas API methods
  async getCourseDetails(courseId: string, contentType: string) {
    return this.request("/course_details", {
      method: "POST",
      body: JSON.stringify({
        course_id: courseId,
        content_type: contentType,
      }),
    })
  }
}

export const apiClient = new ApiClient()
