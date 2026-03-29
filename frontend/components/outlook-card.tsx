"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw, Unplug } from "lucide-react"
import { useToast } from "@/lib/toast-context"
import { ApiError } from "@/lib/api"
import type { DataItem, OutlookState } from "@/app/page"

interface OutlookCardProps {
  storeData: (service: string, data: DataItem[]) => void
  state: OutlookState
  setState: (state: OutlookState) => void
  onDisconnect: () => void
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
  summaryCached?: boolean
  summaryCachedAt?: string
}

export function OutlookCard({ storeData, state, setState, onDisconnect }: OutlookCardProps) {
  const { status, account } = state
  const toast = useToast()
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)

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
          status: "User authentication required!",
          account: {
            id: "outlook_account",
            emails: [],
            isConnected: false,
            showDatePicker: true,
            userCode: data.user_code,
            verificationUrl: data.verification_url,
          },
        })
        toast.info("Please authenticate with Microsoft using the code shown.")
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
        toast.success("Outlook connected successfully!")
      } else {
        updateState({ status: "Error connecting ❌" })
        toast.error("Failed to connect Outlook.")
      }
    } catch (error) {
      updateState({ status: "Connection Error ❌" })
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Unable to connect to server. Please check your connection.")
      }
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
                showDatePicker: true,
                summary: undefined,
              }
            : null,
        })

        const outlookData: DataItem[] = data.outlooks.map((email: OutlookEmail) => ({
          service: "outlook",
          text: `${email.sender}: ${email.subject} (${email.date})`,
          link: email.link,
          account: null,
        }))
        storeData("outlook", outlookData)
        toast.success("Outlook emails loaded!")
      } else {
        updateState({ status: "Error fetching emails ❌" })
        toast.error("Failed to fetch Outlook emails.")
      }
    } catch (error) {
      updateState({ status: "Error retrieving emails ❌" })
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Unable to connect to server. Please check your connection.")
      }
    }
  }

  const [selectedEmails, setSelectedEmails] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const handleEmailSelect = (emailId: string, checked: boolean) => {
    setSelectedEmails((prev) => (checked ? [...prev, emailId] : prev.filter((id) => id !== emailId)))
  }

  const summarizeSelected = async (forceRefresh = false) => {
    if (selectedEmails.length === 0) return
    setIsLoading(true)

    try {
      const response = await fetch("/api/summarize_outlook_emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_ids: selectedEmails, force_refresh: forceRefresh }),
      })

      const data = await response.json()

      if (data.summary) {
        updateState({
          account: account
            ? {
                ...account,
                summary: data.summary,
                summaryCached: data.cached || false,
                summaryCachedAt: data.cached_at || null,
              }
            : null,
        })

        const summaryData: DataItem[] = [
          {
            service: "outlook",
            text: `Outlook Summary: ${data.summary}`,
            link: null,
            account: null,
          },
        ]
        storeData("outlook", summaryData)

        if (data.cached) {
          toast.info("Showing cached summary.")
        } else {
          toast.success("Outlook emails summarized!")
        }
      }
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Error summarizing Outlook emails.")
      }
    }

    setIsLoading(false)
  }

  const getDefaultDate = () => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split("T")[0]
  }

  const isConnected = !!account

  return (
    <div className="bg-amber-900/15 p-8 rounded-xl shadow-lg border border-white/20 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Outlook</h2>
        {isConnected && (
          <div className="relative">
            {showDisconnectConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-300">Disconnect?</span>
                <Button
                  onClick={() => { onDisconnect(); setShowDisconnectConfirm(false) }}
                  className="bg-red-600 hover:bg-red-700 text-xs px-2 py-1"
                >
                  Yes
                </Button>
                <Button
                  onClick={() => setShowDisconnectConfirm(false)}
                  className="bg-gray-600 hover:bg-gray-700 text-xs px-2 py-1"
                >
                  No
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => setShowDisconnectConfirm(true)}
                className="bg-red-600/20 hover:bg-red-600/40 border border-red-500/30"
                title="Disconnect Outlook"
              >
                <Unplug className="w-4 h-4 mr-1" />
                Disconnect
              </Button>
            )}
          </div>
        )}
      </div>

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

      {account?.showDatePicker && (
        <OutlookDatePicker
          onFetchEmails={fetchEmailsFromDate}
          getDefaultDate={getDefaultDate}
          savedDate={state.selectedDate}
          onDateChange={(date) => updateState({ selectedDate: date })}
        />
      )}

      {account && account.emails.length > 0 && (
        <>
          <OutlookEmailList
            emails={account.emails}
            selectedEmails={selectedEmails}
            onEmailSelect={handleEmailSelect}
            onSummarize={() => summarizeSelected(false)}
            isLoading={isLoading}
          />
          {account.summary && (
            <div className="mt-4 p-4 bg-white/10 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold">Summary</h4>
                <div className="flex items-center gap-2">
                  {account.summaryCached && account.summaryCachedAt && (
                    <span className="text-xs bg-blue-600/30 text-blue-300 px-2 py-1 rounded">
                      Cached {new Date(account.summaryCachedAt).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    onClick={() => summarizeSelected(true)}
                    className="p-1 rounded hover:bg-white/20 transition-colors"
                    title="Re-summarize (force refresh)"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>
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
  savedDate?: string
  onDateChange?: (date: string) => void
}

function OutlookDatePicker({ onFetchEmails, getDefaultDate, savedDate, onDateChange }: OutlookDatePickerProps) {
  const [selectedDate, setSelectedDate] = useState(savedDate || "")
  const [isLoading, setIsLoading] = useState(false)

  const handleDateSubmit = async () => {
    if (!selectedDate) return
    setIsLoading(true)
    await onFetchEmails(selectedDate)
    setIsLoading(false)
  }

  return (
    <div className="mb-6 p-4 bg-blue-900/20 rounded-lg border border-blue-500/30">
      <h4 className="text-lg font-semibold mb-3 text-blue-300">Select Date Range</h4>
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
            onChange={(e) => { setSelectedDate(e.target.value); onDateChange?.(e.target.value) }}
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
