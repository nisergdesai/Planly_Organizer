"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { DataItem, OutlookState } from "@/app/page"

interface OutlookCardProps {
  storeData: (service: string, data: DataItem[]) => void
  state: OutlookState
  setState: (state: OutlookState) => void
}

interface OutlookEmail {
  id: string
  sender: string
  subject: string
  date: string
  link: string
  summary?: string
}

interface OutlookAccount {
  id: string
  emails: OutlookEmail[]
  isConnected: boolean
  showDatePicker: boolean
  userCode?: string
  verificationUrl?: string
  summary?: string
}

export function OutlookCard({ storeData, state, setState }: OutlookCardProps) {
  const { status, account } = state

  const updateState = (updates: Partial<OutlookState>) => {
    setState({ ...state, ...updates })
  }

  const connectOutlook = async () => {
    updateState({ status: "Connecting Outlook... ⏳" })

    try {
      const response = await fetch("/api/fetch_code_outlook", {
        method: "POST",
      })

      const data = await response.json()

      if (data.status === "pending" && data.user_code) {
        updateState({
          status: "User authentication required! ⚠️",
          account: {
            id: "outlook_account",
            emails: [],
            isConnected: false,
            showDatePicker: true, // always show date picker even before auth
            userCode: data.user_code,
            verificationUrl: data.verification_url,
          },
        })
      } else if (data.status === "success") {
        updateState({
          status: "Connected ✅ - Please select a date range",
          account: {
            id: "outlook_account",
            emails: [],
            isConnected: true,
            showDatePicker: true,
          },
        })
      } else {
        updateState({ status: "Error connecting ❌" })
      }
    } catch (error) {
      updateState({ status: "Connection Error ❌" })
      console.error("Outlook connection error:", error)
    }
  }

  const authenticate = () => {
    if (account?.verificationUrl) {
      window.open(account.verificationUrl, "_blank")
    }
    updateState({
      status: "Connected ✅ - Please select a date range",
      account: account ? { ...account, isConnected: true, showDatePicker: true } : null,
    })
  }

  const fetchEmailsFromDate = async (startDate: string) => {
    updateState({ status: "Fetching emails from Outlook... ⏳" })

    try {
      const selectedDate = new Date(startDate)
      const today = new Date()
      const timeDiff = today.getTime() - selectedDate.getTime()
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))

      const response = await fetch("/api/fetch_outlook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cutoff_days_outlook: daysDiff,
          type: "outlook",
        }),
      })

      const data = await response.json()

      if (data.status === "pending") {
        updateState({
          status: "Emails loaded ✅",
          account: account
            ? {
                ...account,
                emails: data.outlooks || [],
                showDatePicker: true, // keep date picker always visible
                summary: undefined, // clear previous summary when new emails load
              }
            : null,
        })

        // Store emails globally
        const outlookData: DataItem[] = data.outlooks.map((email: OutlookEmail) => ({
          service: "outlook",
          text: `${email.sender}: ${email.subject} (${email.date})`,
          link: email.link,
          account: null,
        }))
        storeData("outlook", outlookData)
      } else {
        updateState({ status: "Error fetching emails ❌" })
      }
    } catch (error) {
      updateState({ status: "Error retrieving emails ❌" })
      console.error("Error fetching Outlook emails:", error)
    }
  }

  const [selectedEmails, setSelectedEmails] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const handleEmailSelect = (emailId: string, checked: boolean) => {
    setSelectedEmails((prev) => (checked ? [...prev, emailId] : prev.filter((id) => id !== emailId)))
  }

  const summarizeSelected = async () => {
    if (selectedEmails.length === 0) return
    setIsLoading(true)

    try {
      const response = await fetch("/api/summarize_outlook_emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_ids: selectedEmails }),
      })

      const data = await response.json()

      if (data.summary) {
        // Update account with summary
        updateState({
          account: account
            ? {
                ...account,
                summary: data.summary,
              }
            : null,
        })

        // Store summary globally for persistence
        const summaryData: DataItem[] = [
          {
            service: "outlook",
            text: `Outlook Summary: ${data.summary}`,
            link: null,
            account: null,
          },
        ]
        storeData("outlook", summaryData)
      }
    } catch (error) {
      console.error("Error summarizing Outlook emails:", error)
    }

    setIsLoading(false)
  }

  // Default date for date picker
  const getDefaultDate = () => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split("T")[0]
  }

  return (
    <div className="bg-amber-900/15 p-8 rounded-xl shadow-lg border border-white/20 mb-8">
      <h2 className="text-2xl font-bold mb-4">Outlook</h2>

      {!account && (
        <Button
          onClick={connectOutlook}
          className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700 mb-4"
        >
          Connect Microsoft
        </Button>
      )}

      <p className="mb-4">Status: {status}</p>

      {account && !account.isConnected && account.userCode && (
        <div className="mb-4 p-4 bg-blue-900/20 rounded-lg">
          <p className="mb-2">
            Enter this code: <strong>{account.userCode}</strong>
          </p>
          <Button
            onClick={authenticate}
            className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
          >
            Authenticate
          </Button>
        </div>
      )}

      {/* Always show date picker */}
      {account?.showDatePicker && (
        <OutlookDatePicker onFetchEmails={fetchEmailsFromDate} getDefaultDate={getDefaultDate} />
      )}

      {account && account.emails.length > 0 && (
        <>
          <OutlookEmailList
            emails={account.emails}
            selectedEmails={selectedEmails}
            onEmailSelect={handleEmailSelect}
            onSummarize={summarizeSelected}
            isLoading={isLoading}
          />
          {/* Show summary if present */}
          {account.summary && (
            <div className="mt-4 p-4 bg-white/10 rounded-lg">
              <h4 className="font-semibold mb-2">Summary</h4>
              <p className="whitespace-pre-wrap">{account.summary}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface OutlookDatePickerProps {
  onFetchEmails: (startDate: string) => Promise<void>
  getDefaultDate: () => string
}

function OutlookDatePicker({ onFetchEmails, getDefaultDate }: OutlookDatePickerProps) {
  const [selectedDate, setSelectedDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleDateSubmit = async () => {
    if (!selectedDate) return
    setIsLoading(true)
    await onFetchEmails(selectedDate)
    setIsLoading(false)
  }

  return (
    <div className="mb-6 p-4 bg-blue-900/20 rounded-lg border border-blue-500/30">
      <h4 className="text-lg font-semibold mb-3 text-blue-300">📅 Select Date Range</h4>
      <p className="text-sm text-gray-300 mb-3">Choose a start date to fetch emails from that date to today:</p>

      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label htmlFor="outlook-date-picker" className="block mb-2 text-sm">
            Start Date:
          </label>
          <input
            type="date"
            id="outlook-date-picker"
            value={selectedDate || getDefaultDate()}
            onChange={(e) => setSelectedDate(e.target.value)}
            max={new Date().toISOString().split("T")[0]}
            className="w-full p-2 rounded border text-gray-900"
          />
        </div>
        <Button
          onClick={handleDateSubmit}
          disabled={isLoading || !selectedDate}
          className="bg-gradient-to-r from-green-400 to-green-600 hover:from-green-500 hover:to-green-700"
        >
          {isLoading ? "Loading..." : "Fetch Emails"}
        </Button>
      </div>

      <p className="text-xs text-gray-400 mt-2">
        {selectedDate
          ? `Will fetch emails from ${selectedDate} to ${new Date().toISOString().split("T")[0]}`
          : "Please select a start date"}
      </p>
    </div>
  )
}

interface OutlookEmailListProps {
  emails: OutlookEmail[]
  selectedEmails: string[]
  onEmailSelect: (emailId: string, checked: boolean) => void
  onSummarize: () => Promise<void>
  isLoading: boolean
}

function OutlookEmailList({
  emails,
  selectedEmails,
  onEmailSelect,
  onSummarize,
  isLoading,
}: OutlookEmailListProps) {
  return (
    <div className="mt-4">
      <h3 className="text-lg font-semibold mb-3">Outlook Emails</h3>
      <ul className="space-y-2 mb-4">
        {emails.map((email: OutlookEmail) => (
          <li key={email.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              value={email.id}
              checked={selectedEmails.includes(email.id)}
              onChange={(e) => onEmailSelect(email.id, e.target.checked)}
              className="mr-2"
              disabled={isLoading}
            />
            <a href={email.link} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline">
              {email.sender} {email.subject} ({email.date})
            </a>
          </li>
        ))}
      </ul>

      {selectedEmails.length > 0 && (
        <Button
          onClick={onSummarize}
          disabled={isLoading}
          className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
        >
          {isLoading ? "Summarizing..." : "Summarize Selected"}
        </Button>
      )}
    </div>
  )
}
