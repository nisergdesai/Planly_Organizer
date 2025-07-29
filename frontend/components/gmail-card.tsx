"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  apiClient,
  type GmailLabel,
  type GmailEmail,
  type GmailConnectResponse,
  type GmailLabelsResponse,
  type SummarizeResponse,
} from "@/lib/api"
import type { DataItem, GmailState } from "@/app/page"

interface GmailCardProps {
  storeData: (service: string, data: DataItem[]) => void
  state: GmailState
  setState: React.Dispatch<React.SetStateAction<GmailState>>
}

interface GmailAccount {
  id: string
  email: string
  emails: GmailEmail[]
  labels: GmailLabel[]
  isConnected: boolean
  showDatePicker: boolean
  summary?: string
}

export function GmailCard({ storeData, state, setState }: GmailCardProps) {
  const { status, accounts, connectedCount } = state

  const updateState = (updates: Partial<GmailState>) => {
    setState((prev) => ({ ...prev, ...updates }))
  }

  const connectGmail = async (isAdditional = false) => {
    updateState({ status: "Connecting Gmail... \u23F3" })

    try {
      const accountId = `gmail_${Date.now()}`

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
          status: "Connected \u2705 - Please select a date range",
          connectedCount: prev.connectedCount + 1,
          accounts: [...prev.accounts, newAccount],
        }))

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
          console.error("Error fetching labels:", err)
        }
      } else {
        updateState({ status: "Connection Failed \u274C" })
      }
    } catch (error) {
      updateState({ status: "Connection Error \u274C" })
      console.error("Gmail connection error:", error)
    }
  }

  const fetchEmailsFromDate = async (accountId: string, startDate: string, labelId = "INBOX") => {
    updateState({ status: "Fetching emails... \u23F3" })

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
            status: "Emails loaded \u2705",
            accounts: updatedAccounts,
          }
        })
      } else {
        updateState({ status: "Failed to fetch emails \u274C" })
      }
    } catch (error) {
      updateState({ status: "Error fetching emails \u274C" })
      console.error("Error fetching emails:", error)
    }
  }

  const summarizeEmails = async (accountId: string, selectedEmails: string[]) => {
    try {
      const data: SummarizeResponse = await apiClient.summarizeEmails(selectedEmails, accountId)

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
            acc.id === accountId ? { ...acc, summary: data.summary } : acc
          ),
        }))

        return data.summary
      }
    } catch (error) {
      console.error("Error summarizing emails:", error)
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
      console.error("Error refreshing Gmail emails:", error)
    }
  }

  return (
    <div className="bg-amber-900/15 p-8 rounded-xl shadow-lg border border-white/20 mb-8">
      <h2 className="text-2xl font-bold mb-4">Gmail Emails</h2>

      <div className="mb-4">
        {accounts.length === 0 ? (
          <Button
            onClick={() => connectGmail(false)}
            className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
          >
            Connect Gmail
          </Button>
        ) : (
          <Button
            onClick={() => connectGmail(true)}
            className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
          >
            Connect Another Gmail Account
          </Button>
        )}
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
  onSummarize: (accountId: string, selectedEmails: string[]) => Promise<string | null>
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
  const [selectedDate, setSelectedDate] = useState("")

  const getDefaultDate = () => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split("T")[0]
  }

  const handleEmailSelect = (emailId: string, checked: boolean) => {
    setSelectedEmails((prev) =>
      checked ? [...prev, emailId] : prev.filter((id) => id !== emailId)
    )
  }

  const handleSummarize = async () => {
    if (selectedEmails.length === 0) return
    setIsLoading(true)
    await onSummarize(account.id, selectedEmails)
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
        <h4 className="text-lg font-semibold mb-3 text-blue-300">\ud83d\uddd3\ufe0f Select Date Range</h4>
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
          onClick={handleSummarize}
          disabled={isLoading}
          className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700 mb-4"
        >
          {isLoading ? "Summarizing..." : "Summarize Selected"}
        </Button>
      )}

      {account.summary && (
        <div className="mt-4 p-4 bg-white/10 rounded-lg">
          <h4 className="font-semibold mb-2">Summary</h4>
          <p className="whitespace-pre-wrap">{account.summary}</p>
        </div>
      )}
    </div>
  )
}
