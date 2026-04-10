"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw, Unplug } from "lucide-react"
import { useToast } from "@/lib/toast-context"
import {
  apiClient,
  ApiError,
  type DriveFile,
  type DriveConnectResponse,
  type SummarizeFileResponse,
  type GeminiResponse,
  type ConnectedService,
} from "@/lib/api"
import type { DataItem, DriveState } from "@/app/page"

interface DriveCardProps {
  storeData: (service: string, data: DataItem[]) => void
  state: DriveState
  setState: React.Dispatch<React.SetStateAction<DriveState>>
  onDisconnect: (accountEmail?: string) => void
}

interface DriveAccount {
  id: string
  email: string
  files: DriveFile[]
  isConnected: boolean
  selectedDate?: string
  summaries: Record<string, { summary: string; originalText: string; cached?: boolean; cachedAt?: string }>
  answers: Record<string, string>
}

export function DriveCard({ storeData, state, setState, onDisconnect }: DriveCardProps) {
  const { status, accounts, connectedCount } = state
  const toast = useToast()
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  const [rememberedAccounts, setRememberedAccounts] = useState<ConnectedService[]>([])

  const updateState = (updates: Partial<DriveState>) => {
    setState({ ...state, ...updates })
  }

  useEffect(() => {
    const loadRememberedAccounts = async () => {
      try {
        const response = await apiClient.getConnectedServices()
        const remembered = (response.services || []).filter((s) => s.service_type === "google_drive")
        setRememberedAccounts(remembered)
      } catch {
        setRememberedAccounts([])
      }
    }
    loadRememberedAccounts()
  }, [])

  const connectDrive = async (isAdditional = false, rememberedEmail?: string) => {
    const accountId = rememberedEmail
      ? `drive_${rememberedEmail.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`
      : `drive_${Date.now()}`
    updateState({ status: "Connecting Google Drive... ⏳" })

    try {
      const response = await fetch("/api/connect_google_drive", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          account_id: accountId,
          ...(rememberedEmail ? { account_email: rememberedEmail } : {}),
          reconnect_only: rememberedEmail ? "true" : "false",
          num_days: "0",
        }),
      })

      const data = await response.json()

      if (data.status === "reauth_required") {
        updateState({ status: "Reconnect requires authentication ❗" })
        toast.warning(data.message || "Saved credentials not found. Please authenticate again.")
        return
      }

      if (data.status === "success") {
        const newAccount: DriveAccount = {
          id: data.account_id || accountId,
          email: data.email_address || "Connected Account",
          files: [],
          isConnected: true,
          summaries: {},
          answers: {},
        }
        setState((prev) => {
          const existingIndex = prev.accounts.findIndex((acc) => acc.email === newAccount.email)
          const nextAccounts = [...prev.accounts]
          if (existingIndex >= 0) {
            nextAccounts[existingIndex] = { ...nextAccounts[existingIndex], ...newAccount }
          } else {
            nextAccounts.push(newAccount)
          }
          return {
            ...prev,
            status: "Connected ✅ - Please select a date range",
            connectedCount: nextAccounts.length,
            accounts: nextAccounts,
          }
        })
        toast.success("Google Drive connected successfully!")
      } else {
        updateState({ status: "Connection Failed ❌" })
        toast.error("Failed to connect Google Drive.")
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
        toast.success("Files loaded successfully!")
      } else {
        updateState({ status: "Failed to fetch files ❌" })
        toast.error("Failed to fetch Drive files.")
      }
    } catch (error) {
      updateState({ status: "Error fetching files ❌" })
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Unable to connect to server. Please check your connection.")
      }
    }
  }

  const summarizeFile = async (fileId: string, fileName: string, mimeType: string, accountId: string, forceRefresh = false) => {
    try {
      const data: SummarizeFileResponse = await apiClient.summarizeFile(
        fileId,
        fileName,
        mimeType,
        "drive",
        accountId,
        forceRefresh,
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
                      cached: (data as any).cached || false,
                      cachedAt: (data as any).cached_at || null,
                    },
                  },
                }
              : acc
          ),
        })

        if ((data as any).cached) {
          toast.info("Showing cached summary.")
        } else {
          toast.success(`${fileName} summarized successfully!`)
        }

        return { summary: data.summary, originalText: data.original_text }
      }
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Error summarizing file.")
      }
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
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Error asking question.")
      }
      return "Error fetching answer."
    }
  }

  const getDefaultDate = () => {
    const date = new Date()
    date.setDate(date.getDate() - 30)
    return date.toISOString().split("T")[0]
  }

  const isConnected = accounts.length > 0
  const availableRemembered = rememberedAccounts.filter(
    (r) => r.account_email && !accounts.some((acc) => acc.email === r.account_email)
  )

  return (
    <div className="bg-amber-900/15 p-8 rounded-xl shadow-lg border border-white/20 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Google Drive Files</h2>
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
                title="Disconnect Google Drive"
              >
                <Unplug className="w-4 h-4 mr-1" />
                Disconnect
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mb-4">
        {availableRemembered.length > 0 && (
          <div className="mb-3 p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm mb-2">Previously connected Drive accounts:</p>
            <div className="flex gap-2 flex-wrap">
              {availableRemembered.map((saved) => (
                <div key={`${saved.service_type}-${saved.account_email}`} className="flex items-center gap-1">
                  <Button
                    onClick={() => connectDrive(true, saved.account_email || undefined)}
                    className="bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/40"
                  >
                    Reconnect {saved.account_email}
                  </Button>
                  <Button
                    onClick={() => onDisconnect(saved.account_email || undefined)}
                    className="bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 px-2"
                    title="Forget this remembered account"
                  >
                    Forget
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        {accounts.length === 0 ? (
          <Button
            onClick={() => connectDrive(false)}
            className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
          >
            Authenticate New Drive Account
          </Button>
        ) : (
          <Button
            onClick={() => connectDrive(true)}
            className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
          >
            Authenticate Another Drive Account
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
          onDisconnectAccount={(accountEmail) => onDisconnect(accountEmail)}
          getDefaultDate={getDefaultDate}
          onDateChange={(date) => {
            const updated = state.accounts.map((a) => a.id === account.id ? { ...a, selectedDate: date } : a)
            updateState({ accounts: updated })
          }}
        />
      ))}
    </div>
  )
}

interface DriveAccountSectionProps {
  account: DriveAccount
  onSummarize: (fileId: string, fileName: string, mimeType: string, accountId: string, forceRefresh?: boolean) => Promise<any>
  onAskQuestion: (
    query: string,
    originalText: string,
    summary: string,
    fileId: string,
    accountId: string
  ) => Promise<string>
  onFetchFiles: (accountId: string, startDate: string) => Promise<void>
  onDisconnectAccount: (accountEmail: string) => void
  getDefaultDate: () => string
  onDateChange?: (date: string) => void
}

function DriveAccountSection({
  account,
  onSummarize,
  onAskQuestion,
  onFetchFiles,
  onDisconnectAccount,
  getDefaultDate,
  onDateChange,
}: DriveAccountSectionProps) {
  const [selectedDate, setSelectedDate] = useState(account.selectedDate || "")
  const [isLoading, setIsLoading] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Record<string, string>>({})
  const [asking, setAsking] = useState<Record<string, boolean>>({})

  const handleSummarize = async (file: DriveFile, forceRefresh = false) => {
    setLoadingFileId(file.id)
    await onSummarize(file.id, file.name, file.mimeType, account.id, forceRefresh)
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
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Drive Account: {account.email}</h3>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsMinimized((v) => !v)}
            className="bg-white/10 hover:bg-white/20 border border-white/20 text-xs px-2 py-1"
          >
            {isMinimized ? "Expand" : "Minimize"}
          </Button>
          <Button
            onClick={() => onDisconnectAccount(account.email)}
            className="bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-xs px-2 py-1"
          >
            Disconnect Account
          </Button>
        </div>
      </div>

      {!isMinimized && (
      <>
      <div className="mb-6 p-4 bg-blue-900/20 rounded-lg border border-blue-500/30">
        <h4 className="text-lg font-semibold mb-3 text-blue-300">Select Date Range</h4>
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
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold">File Summary</h4>
                    <div className="flex items-center gap-2">
                      {account.summaries[file.id].cached && account.summaries[file.id].cachedAt && (
                        <span className="text-xs bg-blue-600/30 text-blue-300 px-2 py-1 rounded">
                          Cached {new Date(account.summaries[file.id].cachedAt!).toLocaleDateString()}
                        </span>
                      )}
                      <button
                        onClick={() => handleSummarize(file, true)}
                        className="p-1 rounded hover:bg-white/20 transition-colors"
                        title="Re-summarize (force refresh)"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
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
      </>
      )}
    </div>
  )
}
