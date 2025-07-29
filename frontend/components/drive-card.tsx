"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import {
  apiClient,
  type DriveFile,
  type DriveConnectResponse,
  type SummarizeFileResponse,
  type GeminiResponse,
} from "@/lib/api"
import type { DataItem, DriveState } from "@/app/page"

interface DriveCardProps {
  storeData: (service: string, data: DataItem[]) => void
  state: DriveState
  setState: (state: DriveState) => void
}

interface DriveAccount {
  id: string
  email: string
  files: DriveFile[]
  isConnected: boolean
  summaries: Record<string, { summary: string; originalText: string }>
  answers: Record<string, string>
}

export function DriveCard({ storeData, state, setState }: DriveCardProps) {
  const { status, accounts, connectedCount } = state

  const updateState = (updates: Partial<DriveState>) => {
    setState({ ...state, ...updates })
  }

  const connectDrive = async (isAdditional = false) => {
    const accountId = `drive_${connectedCount}`
    updateState({ status: "Connecting Google Drive... ⏳" })

    try {
      const response = await fetch("/api/connect_google_drive", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          account_id: accountId,
          num_days: "0",
        }),
      })

      const data = await response.json()

      if (data.status === "success") {
        updateState({
          status: "Connected ✅ - Please select a date range",
          connectedCount: connectedCount + 1,
        })

        const newAccount: DriveAccount = {
          id: data.account_id || accountId,
          email: data.email_address || "Connected Account",
          files: [],
          isConnected: true,
          summaries: {},
          answers: {},
        }

        updateState({ accounts: [...accounts, newAccount] })
      } else {
        updateState({ status: "Connection Failed ❌" })
      }
    } catch (error) {
      updateState({ status: "Connection Error ❌" })
      console.error("Drive connection error:", error)
    }
  }

  const fetchFilesFromDate = async (accountId: string, startDate: string) => {
    updateState({ status: "Fetching files... ⏳" })

    try {
      const selectedDate = new Date(startDate)
      const today = new Date()
      const timeDiff = today.getTime() - selectedDate.getTime()
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))

      const data: DriveConnectResponse = await apiClient.connectGoogleDrive(accountId, daysDiff)

      if (data.status === "success") {
        updateState({
          status: "Files loaded ✅",
          accounts: accounts.map((acc) =>
            acc.id === accountId ? { ...acc, files: data.files || [] } : acc
          ),
        })

        const driveData: DataItem[] = data.files.map((file: DriveFile) => ({
          service: "drive",
          text: file.name,
          link: `https://drive.google.com/file/d/${file.id}`,
          account: data.email_address,
        }))
        storeData("drive", driveData)
      } else {
        updateState({ status: "Failed to fetch files ❌" })
      }
    } catch (error) {
      updateState({ status: "Error fetching files ❌" })
      console.error("Error fetching files:", error)
    }
  }

  const summarizeFile = async (fileId: string, fileName: string, mimeType: string, accountId: string) => {
    try {
      const data: SummarizeFileResponse = await apiClient.summarizeFile(
        fileId,
        fileName,
        mimeType,
        "drive",
        accountId
      )

      if (data.summary) {
        const account = accounts.find((acc) => acc.id === accountId)
        const summaryData: DataItem[] = [
          {
            service: "drive",
            text: `${fileName} Summary: ${data.summary}`,
            link: null,
            account: account?.email || null,
          },
        ]
        storeData("drive", summaryData)

        setState({
          ...state,
          accounts: state.accounts.map((acc) =>
            acc.id === accountId
              ? {
                  ...acc,
                  summaries: {
                    ...acc.summaries,
                    [fileId]: {
                      summary: data.summary,
                      originalText: data.original_text,
                    },
                  },
                }
              : acc
          ),
        })

        return { summary: data.summary, originalText: data.original_text }
      }
    } catch (error) {
      console.error("Error summarizing file:", error)
    }
    return null
  }

  const askQuestion = async (
    query: string,
    originalText: string,
    summary: string,
    fileId: string,
    accountId: string
  ) => {
    try {
      const data: GeminiResponse = await apiClient.askGemini(query, originalText, summary)

      setState({
        ...state,
        accounts: state.accounts.map((acc) =>
          acc.id === accountId
            ? {
                ...acc,
                answers: {
                  ...acc.answers,
                  [fileId]: data.answer,
                },
              }
            : acc
        ),
      })

      return data.answer
    } catch (error) {
      console.error("Error asking question:", error)
      return "Error fetching answer."
    }
  }

  const getDefaultDate = () => {
    const date = new Date()
    date.setDate(date.getDate() - 30)
    return date.toISOString().split("T")[0]
  }

  return (
    <div className="bg-amber-900/15 p-8 rounded-xl shadow-lg border border-white/20 mb-8">
      <h2 className="text-2xl font-bold mb-4">Google Drive Files</h2>

      <div className="mb-4">
        {accounts.length === 0 ? (
          <Button
            onClick={() => connectDrive(false)}
            className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
          >
            Connect Google Drive
          </Button>
        ) : (
          <Button
            onClick={() => connectDrive(true)}
            className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
          >
            Connect Another Drive Account
          </Button>
        )}
      </div>

      <p className="mb-4">Status: {status}</p>

      {accounts.map((account) => (
        <DriveAccountSection
          key={account.id}
          account={account}
          onSummarize={summarizeFile}
          onAskQuestion={askQuestion}
          onFetchFiles={fetchFilesFromDate}
          getDefaultDate={getDefaultDate}
        />
      ))}
    </div>
  )
}

interface DriveAccountSectionProps {
  account: DriveAccount
  onSummarize: (fileId: string, fileName: string, mimeType: string, accountId: string) => Promise<any>
  onAskQuestion: (
    query: string,
    originalText: string,
    summary: string,
    fileId: string,
    accountId: string
  ) => Promise<string>
  onFetchFiles: (accountId: string, startDate: string) => Promise<void>
  getDefaultDate: () => string
}

function DriveAccountSection({
  account,
  onSummarize,
  onAskQuestion,
  onFetchFiles,
  getDefaultDate,
}: DriveAccountSectionProps) {
  const [selectedDate, setSelectedDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Record<string, string>>({})
  const [asking, setAsking] = useState<Record<string, boolean>>({})

  const handleSummarize = async (file: DriveFile) => {
    setLoadingFileId(file.id)
    await onSummarize(file.id, file.name, file.mimeType, account.id)
    setLoadingFileId(null)
  }

  const handleAsk = async (fileId: string) => {
    const query = questions[fileId]
    const summaryObj = account.summaries[fileId]
    if (!query || !summaryObj) return

    setAsking((prev) => ({ ...prev, [fileId]: true }))
    await onAskQuestion(query, summaryObj.originalText, summaryObj.summary, fileId, account.id)
    setAsking((prev) => ({ ...prev, [fileId]: false }))
  }

  const handleDateSubmit = async () => {
    if (!selectedDate) return
    setIsLoading(true)
    await onFetchFiles(account.id, selectedDate)
    setIsLoading(false)
  }

  return (
    <div className="mb-6 p-4 border border-gray-600 rounded-lg">
      <h3 className="text-lg font-semibold mb-3">Drive Account: {account.email}</h3>

      <div className="mb-6 p-4 bg-blue-900/20 rounded-lg border border-blue-500/30">
        <h4 className="text-lg font-semibold mb-3 text-blue-300">📅 Select Date Range</h4>
        <p className="text-sm text-gray-300 mb-3">
          Choose a start date to fetch files modified from that date to today:
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
            {isLoading ? "Loading..." : "Fetch Files"}
          </Button>
        </div>

        <p className="text-xs text-gray-400 mt-2">
          {selectedDate
            ? `Will fetch files from ${selectedDate} to ${new Date().toISOString().split("T")[0]}`
            : "Please select a start date"}
        </p>
      </div>

      <ul className="space-y-3">
        {account.files.length === 0 ? (
          <li className="text-gray-400 italic">No files found for the selected date range.</li>
        ) : (
          account.files.map((file) => (
            <li key={file.id} className="space-y-3">
              <div className="flex items-center justify-between p-2 bg-white/5 rounded">
                <a
                  href={`https://drive.google.com/file/d/${file.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-300 hover:underline flex-1"
                >
                  {file.name}
                </a>
                <Button
                  onClick={() => handleSummarize(file)}
                  disabled={loadingFileId === file.id}
                  className="ml-4 bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
                >
                  {loadingFileId === file.id ? <Loader2 className="animate-spin w-4 h-4" /> : "Summarize"}
                </Button>
              </div>

              {account.summaries[file.id] && (
                <div className="p-4 bg-white/10 rounded-lg">
                  <h4 className="font-semibold mb-2">File Summary</h4>
                  <p className="whitespace-pre-wrap mb-4">{account.summaries[file.id].summary}</p>

                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Ask a question..."
                      value={questions[file.id] || ""}
                      onChange={(e) => setQuestions((prev) => ({ ...prev, [file.id]: e.target.value }))}
                      className="flex-1 p-2 rounded border text-gray-900"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAsk(file.id)
                      }}
                    />
                    <Button
                      onClick={() => handleAsk(file.id)}
                      className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
                    >
                      {asking[file.id] ? <Loader2 className="animate-spin w-4 h-4" /> : "Ask"}
                    </Button>
                  </div>

                  {account.answers[file.id] && (
                    <div className="mt-2 p-3 bg-white/5 rounded">
                      <strong>Answer:</strong> {account.answers[file.id]}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
