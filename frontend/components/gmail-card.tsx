"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw, Unplug } from "lucide-react"
import { useToast } from "@/lib/toast-context"
import {
  apiClient,
  ApiError,
  type GmailLabel,
  type GmailEmail,
  type GmailConnectResponse,
  type GmailLabelsResponse,
  type SummarizeResponse,
} from "@/lib/api"
import { AccountPicker } from "@/components/account-picker"
import type { DataItem, GmailState } from "@/app/page"

interface GmailCardProps {
  storeData: (service: string, data: DataItem[]) => void
  state: GmailState
  setState: React.Dispatch<React.SetStateAction<GmailState>>
  onDisconnect: () => void
}

interface GmailAccount {
  id: string
  email: string
  emails: GmailEmail[]
  labels: GmailLabel[]
  isConnected: boolean
  showDatePicker: boolean
  summary?: string
  summaryCached?: boolean
  summaryCachedAt?: string
}

export function GmailCard({ storeData, state, setState, onDisconnect }: GmailCardProps) {
  const { status, accounts, connectedCount } = state
  const toast = useToast()
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)

  const updateState = (updates: Partial<GmailState>) => {
    setState((prev) => ({ ...prev, ...updates }))
  }

  const connectGmail = async (isAdditional = false, reconnectEmail?: string) => {
    updateState({ status: reconnectEmail ? `Reconnecting ${reconnectEmail}... ⏳` : "Connecting Gmail... ⏳" })

    try {
      // Use the reconnect email as a hint for account selection, or generate new ID
      const accountId = reconnectEmail || `gmail_${Date.now()}`

      const response = await fetch("/api/connect_gmail", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          account_id: accountId,
          num_days: "0",
        }),
      })

      const data = await response.json()

      if (data.status === "success") {
        const newAccount: GmailAccount = {
          id: data.account_id || accountId,
          email: data.email_address || "Connected Account",
          emails: [],
          labels: [],
          isConnected: true,
          showDatePicker: true,
        }

        setState((prev) => ({
          ...prev,
          status: "Connected ✅ - Please select a date range",
          connectedCount: prev.connectedCount + 1,
          accounts: [...prev.accounts, newAccount],
        }))

        toast.success("Gmail connected successfully!")

        try {
          const labelsData: GmailLabelsResponse = await apiClient.getGmailLabels(newAccount.id)
          if (labelsData.status === "success") {
            setState((prev) => ({
              ...prev,
              accounts: prev.accounts.map((acc) =>
                acc.id === newAccount.id ? { ...acc, labels: labelsData.labels } : acc
              ),
            }))
          }
        } catch (err) {
          if (err instanceof ApiError) {
            toast.warning(err.friendlyMessage)
          }
        }
      } else {
        updateState({ status: "Connection Failed ❌" })
        toast.error("Failed to connect Gmail.")
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

  const fetchEmailsFromDate = async (accountId: string, startDate: string, labelId = "INBOX") => {
    updateState({ status: "Fetching emails... ⏳" })

    try {
      const selectedDate = new Date(startDate)
      const today = new Date()
      const timeDiff = today.getTime() - selectedDate.getTime()
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))

      const data: GmailConnectResponse = await apiClient.connectGmail(accountId, daysDiff, labelId)

      if (data.status === "success") {
        setState((prev) => {
          const updatedAccounts = prev.accounts.map((acc) =>
            acc.id === accountId ? { ...acc, emails: data.emails || [] } : acc
          )

          const gmailData: DataItem[] = (data.emails || []).map((email: GmailEmail) => ({
            service: "gmail",
            text: `${email.sender} - ${email.subject}`,
            link: email.link,
            account: data.email_address,
          }))
          storeData("gmail", gmailData)

          return {
            ...prev,
            status: "Emails loaded ✅",
            accounts: updatedAccounts,
          }
        })
        toast.success("Emails loaded successfully!")
      } else {
        updateState({ status: "Failed to fetch emails ❌" })
        toast.error("Failed to fetch emails.")
      }
    } catch (error) {
      updateState({ status: "Error fetching emails ❌" })
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Unable to connect to server. Please check your connection.")
      }
    }
  }

  const summarizeEmails = async (accountId: string, selectedEmails: string[], forceRefresh = false) => {
    try {
      const data = await apiClient.summarizeEmails(selectedEmails, accountId, forceRefresh) as any

      if (data.summary) {
        const account = accounts.find((acc: GmailAccount) => acc.id === accountId)
        const summaryData: DataItem[] = [
          {
            service: "gmail",
            text: `Gmail Summary: ${data.summary}`,
            link: null,
            account: account?.email || null,
          },
        ]
        storeData("gmail", summaryData)

        setState((prev) => ({
          ...prev,
          accounts: prev.accounts.map((acc) =>
            acc.id === accountId ? {
              ...acc,
              summary: data.summary,
              summaryCached: data.cached || false,
              summaryCachedAt: data.cached_at || null,
            } : acc
          ),
        }))

        if (data.cached) {
          toast.info("Showing cached summary.")
        } else {
          toast.success("Emails summarized successfully!")
        }

        return data.summary
      }
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Error summarizing emails.")
      }
    }
    return null
  }

  const refreshGmailEmails = async (accountId: string, labelId = "INBOX") => {
    try {
      const data: GmailConnectResponse = await apiClient.connectGmail(accountId, -1, labelId)

      if (data.status === "success") {
        updateState({
          accounts: accounts.map((acc: GmailAccount) =>
            acc.id === accountId ? { ...acc, emails: data.emails || [] } : acc
          ),
        })

        const gmailData: DataItem[] = data.emails.map((email: GmailEmail) => ({
          service: "gmail",
          text: `${email.sender} - ${email.subject}`,
          link: email.link,
          account: data.email_address,
        }))
        storeData("gmail", gmailData)
      }
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Error refreshing emails.")
      }
    }
  }

  const isConnected = accounts.length > 0

  return (
    <div className="bg-amber-900/15 p-8 rounded-xl shadow-lg border border-white/20 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Gmail Emails</h2>
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
                title="Disconnect Gmail"
              >
                <Unplug className="w-4 h-4 mr-1" />
                Disconnect
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mb-4">
        <AccountPicker
          serviceType="gmail"
          serviceName="Gmail"
          onConnectNew={() => connectGmail(accounts.length > 0)}
          onReconnect={(accountEmail) => connectGmail(true, accountEmail)}
          isConnecting={status.includes("Connecting")}
        />
      </div>

      <p className="mb-4">Status: {status}</p>

      {accounts.map((account) => (
        <GmailAccountSection
          key={account.id}
          account={account}
          onSummarize={summarizeEmails}
          onRefresh={refreshGmailEmails}
          onFetchEmails={fetchEmailsFromDate}
          accounts={accounts}
          updateAccounts={(newAccounts) => updateState({ accounts: newAccounts })}
        />
      ))}
    </div>
  )
}

interface GmailAccountSectionProps {
  account: GmailAccount
  onSummarize: (accountId: string, selectedEmails: string[], forceRefresh?: boolean) => Promise<string | null>
  onRefresh: (accountId: string, labelId: string) => Promise<void>
  onFetchEmails: (accountId: string, startDate: string, labelId?: string) => Promise<void>
  accounts: GmailAccount[]
  updateAccounts: (accounts: GmailAccount[]) => void
}

function GmailAccountSection({
  account,
  onSummarize,
  onRefresh,
  onFetchEmails,
  accounts,
  updateAccounts,
}: GmailAccountSectionProps) {
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])
  const [selectedLabel, setSelectedLabel] = useState("INBOX")
  const [isLoading, setIsLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState(account.selectedDate || "")

  const getDefaultDate = () => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split("T")[0]
  }

  // Persist date selection to parent state
  const handleDateChange = (value: string) => {
    setSelectedDate(value)
    const updated = accounts.map((a) => a.id === account.id ? { ...a, selectedDate: value } : a)
    updateAccounts(updated)
  }

  const handleEmailSelect = (emailId: string, checked: boolean) => {
    setSelectedEmails((prev) =>
      checked ? [...prev, emailId] : prev.filter((id) => id !== emailId)
    )
  }

  const handleSummarize = async (forceRefresh = false) => {
    if (selectedEmails.length === 0) return
    setIsLoading(true)
    await onSummarize(account.id, selectedEmails, forceRefresh)
    setIsLoading(false)
  }

  const handleLabelChange = async (newLabel: string) => {
    setSelectedLabel(newLabel)
    if (!account.showDatePicker) {
      setIsLoading(true)
      await onRefresh(account.id, newLabel)
      setIsLoading(false)
    }
  }

  const handleDateSubmit = async () => {
    if (!selectedDate) return
    setIsLoading(true)
    await onFetchEmails(account.id, selectedDate, selectedLabel)
    setSelectedEmails([])
    setIsLoading(false)
  }

  return (
    <div className="mb-6 p-4 border border-gray-600 rounded-lg">
      <h3 className="text-lg font-semibold mb-3">Gmail Account: {account.email}</h3>

      <div className="mb-4">
        <label htmlFor={`label-select-${account.id}`} className="block mb-2">
          Select Label:
        </label>
        <select
          id={`label-select-${account.id}`}
          value={selectedLabel}
          onChange={(e) => handleLabelChange(e.target.value)}
          disabled={isLoading}
          className="p-2 rounded border text-gray-900"
        >
          <option value="INBOX">INBOX</option>
          {account.labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-6 p-4 bg-blue-900/20 rounded-lg border border-blue-500/30">
        <h4 className="text-lg font-semibold mb-3 text-blue-300">Select Date Range</h4>
        <p className="text-sm text-gray-300 mb-3">
          Choose a start date to fetch emails from that date to today:
        </p>

        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label htmlFor={`date-picker-${account.id}`} className="block mb-2 text-sm">
              Start Date:
            </label>
            <input
              type="date"
              id={`date-picker-${account.id}`}
              value={selectedDate || getDefaultDate()}
              onChange={(e) => handleDateChange(e.target.value)}
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

      {isLoading ? (
        <div className="text-center py-4">Loading emails...</div>
      ) : (
        <ul className="mb-4 space-y-2">
          {account.emails.length === 0 ? (
            <li className="text-gray-400 italic">No emails found for the selected criteria.</li>
          ) : (
            account.emails.map((email) => (
              <li key={email.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  value={email.id}
                  onChange={(e) => handleEmailSelect(email.id, e.target.checked)}
                  className="mr-2"
                />
                <a
                  href={email.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-300 hover:underline"
                >
                  {email.sender} - {email.subject} ({email.date})
                </a>
              </li>
            ))
          )}
        </ul>
      )}

      {selectedEmails.length > 0 && (
        <Button
          onClick={() => handleSummarize(false)}
          disabled={isLoading}
          className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700 mb-4"
        >
          {isLoading ? "Summarizing..." : "Summarize Selected"}
        </Button>
      )}

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
                onClick={() => handleSummarize(true)}
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
    </div>
  )
}
