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
  cached?: boolean
  cached_at?: string
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
  cached?: boolean
  cached_at?: string
}

export interface GeminiResponse {
  status: string
  answer: string
}

export interface ConnectedService {
  service_type: string
  account_email: string | null
  account_id: string | null
  connected_at: string | null
}

export interface MicrosoftCodeResponse {
  status: string
  user_code?: string
  verification_url?: string
  account_id?: string
  email_address?: string
  message?: string
}

export interface DemoModeResponse {
  status: string
  demo_mode: boolean
  default_demo_mode?: boolean
}

// ApiError class with friendly messages
export class ApiError extends Error {
  status: number
  friendlyMessage: string

  constructor(status: number, originalMessage: string) {
    super(originalMessage)
    this.status = status
    this.name = "ApiError"

    // Map HTTP status codes to friendly messages
    switch (status) {
      case 401:
      case 403:
        this.friendlyMessage = "Authentication expired. Please reconnect the service."
        break
      case 429:
        this.friendlyMessage = "Rate limit exceeded. Please wait a moment and try again."
        break
      case 404:
        this.friendlyMessage = "The requested resource was not found."
        break
      case 500:
        this.friendlyMessage = "Server error. The backend may be experiencing issues."
        break
      case 502:
      case 503:
      case 504:
        this.friendlyMessage = "Service temporarily unavailable. Please try again later."
        break
      default:
        if (status >= 400 && status < 500) {
          this.friendlyMessage = `Request failed (${status}). Please check your input and try again.`
        } else if (status >= 500) {
          this.friendlyMessage = "Server error. Please try again later."
        } else {
          this.friendlyMessage = originalMessage
        }
    }
  }
}

function createNetworkError(): ApiError {
  const err = new ApiError(0, "Network error")
  err.friendlyMessage = "Unable to connect to server. Please check your connection."
  return err
}

class ApiClient {
  private baseUrl: string

  constructor(baseUrl = "/backend") {
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
        throw new ApiError(response.status, `HTTP error! status: ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      throw createNetworkError()
    }
  }

  // Gmail API methods
  async connectGmail(accountId: string, numDays = -1, labelId?: string, accountEmail?: string): Promise<GmailConnectResponse> {
    const formData = new FormData()
    formData.append("account_id", accountId)
    formData.append("num_days", numDays.toString())
    if (labelId) formData.append("label_id", labelId)
    if (accountEmail) formData.append("account_email", accountEmail)

    try {
      const response = await fetch(`${this.baseUrl}/connect_gmail`, {
        method: "POST",
        body: formData,
      })
      if (!response.ok) throw new ApiError(response.status, `HTTP error! status: ${response.status}`)
      return response.json()
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw createNetworkError()
    }
  }

  async getGmailLabels(accountId: string): Promise<GmailLabelsResponse> {
    return this.request("/get_gmail_labels", {
      method: "POST",
      body: JSON.stringify({ account_id: accountId }),
    })
  }

  async summarizeEmails(emailIds: string[], accountId?: string, forceRefresh = false): Promise<SummarizeResponse> {
    return this.request("/summarize_emails", {
      method: "POST",
      body: JSON.stringify({
        email_ids: emailIds,
        ...(accountId && { account_id: accountId }),
        force_refresh: forceRefresh,
      }),
    })
  }

  // Google Drive API methods
  async connectGoogleDrive(accountId: string, numDays = -1, accountEmail?: string): Promise<DriveConnectResponse> {
    const formData = new FormData()
    formData.append("account_id", accountId)
    formData.append("num_days", numDays.toString())
    if (accountEmail) formData.append("account_email", accountEmail)

    try {
      const response = await fetch(`${this.baseUrl}/connect_google_drive`, {
        method: "POST",
        body: formData,
      })
      if (!response.ok) throw new ApiError(response.status, `HTTP error! status: ${response.status}`)
      return response.json()
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw createNetworkError()
    }
  }

  // Outlook API methods
  async fetchCodeOutlook(options?: {
    forceNewAuth?: boolean
    reconnectOnly?: boolean
    accountId?: string
    accountEmail?: string
  }): Promise<MicrosoftCodeResponse> {
    const payload = {
      force_new_auth: options?.forceNewAuth || false,
      reconnect_only: options?.reconnectOnly || false,
      account_id: options?.accountId,
      account_email: options?.accountEmail,
    }
    return this.request("/fetch_code_outlook", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async fetchOutlook(cutoffDays = -1, type = "outlook", accountId?: string, accountEmail?: string, reconnectOnly = false) {
    return this.request("/fetch_outlook", {
      method: "POST",
      body: JSON.stringify({
        cutoff_days_outlook: cutoffDays,
        type: type,
        account_id: accountId,
        account_email: accountEmail,
        reconnect_only: reconnectOnly,
      }),
    })
  }

  async summarizeOutlookEmails(emailIds: string[], forceRefresh = false, accountId?: string, accountEmail?: string) {
    return this.request("/summarize_outlook_emails", {
      method: "POST",
      body: JSON.stringify({
        email_ids: emailIds,
        force_refresh: forceRefresh,
        account_id: accountId,
        account_email: accountEmail,
      }),
    })
  }

  // OneDrive API methods
  async fetchCodeOnedrive(options?: {
    forceNewAuth?: boolean
    reconnectOnly?: boolean
    accountId?: string
    accountEmail?: string
  }): Promise<MicrosoftCodeResponse> {
    const payload = {
      force_new_auth: options?.forceNewAuth || false,
      reconnect_only: options?.reconnectOnly || false,
      account_id: options?.accountId,
      account_email: options?.accountEmail,
    }
    return this.request("/fetch_code_onedrive", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async fetchOnedrive(cutoffDays = -1, type = "onedrive", accountId?: string, accountEmail?: string, reconnectOnly = false) {
    return this.request("/fetch_onedrive", {
      method: "POST",
      body: JSON.stringify({
        cutoff_days_onedrive: cutoffDays,
        type: type,
        account_id: accountId,
        account_email: accountEmail,
        reconnect_only: reconnectOnly,
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
    forceRefresh = false,
  ): Promise<SummarizeFileResponse> {
    const formData = new FormData()
    formData.append("file_id", fileId)
    formData.append("file_name", fileName)
    formData.append("file_mime_type", fileMimeType)
    formData.append("file_source", fileSource)
    if (accountId) formData.append("account_id", accountId)
    formData.append("force_refresh", forceRefresh.toString())

    try {
      const response = await fetch(`${this.baseUrl}/summarize`, {
        method: "POST",
        body: formData,
      })
      if (!response.ok) throw new ApiError(response.status, `HTTP error! status: ${response.status}`)
      return response.json()
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw createNetworkError()
    }
  }

  // AI Q&A
  async askGemini(query: string, originalText: string, summary: string): Promise<GeminiResponse> {
    return this.request("/ask_gemini", {
      method: "POST",
      body: JSON.stringify({
        query: query,
        original_text: originalText,
        summary: summary,
      }),
    })
  }

  // Canvas API methods
  async getCourseDetails(courseId: string, contentType: string, forceRefresh = false) {
    return this.request("/course_details", {
      method: "POST",
      body: JSON.stringify({
        course_id: courseId,
        content_type: contentType,
        force_refresh: forceRefresh,
      }),
    })
  }

  // Disconnect service
  async disconnectService(serviceType: string, accountEmail?: string): Promise<{ status: string; message: string }> {
    return this.request(`/disconnect/${serviceType}`, {
      method: "POST",
      body: JSON.stringify({
        ...(accountEmail && { account_email: accountEmail }),
      }),
    })
  }

  // Get connected services
  async getConnectedServices(): Promise<{ status: string; services: ConnectedService[] }> {
    return this.request("/connected_services", {
      method: "GET",
    })
  }

  async getDemoMode(): Promise<DemoModeResponse> {
    return this.request("/demo_mode", {
      method: "GET",
    })
  }

  async setDemoMode(enabled: boolean): Promise<DemoModeResponse> {
    return this.request("/demo_mode", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    })
  }
}

export const apiClient = new ApiClient()
