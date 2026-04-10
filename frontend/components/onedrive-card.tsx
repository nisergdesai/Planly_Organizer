"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw, Unplug } from "lucide-react"
import { useToast } from "@/lib/toast-context"
import { apiClient, ApiError, type ConnectedService } from "@/lib/api"
import type { DataItem, OnedriveState } from "@/app/page"

interface OnedriveCardProps {
  storeData: (service: string, data: DataItem[]) => void
  state: OnedriveState
  setState: (state: OnedriveState) => void
  onDisconnect: (accountEmail?: string) => void
}

interface OnedriveFile {
  name: string
  id: string
}

interface OnedriveAccount {
  id: string
  email?: string | null
  files: OnedriveFile[]
  isConnected: boolean
  showDatePicker: boolean
  userCode?: string
  verificationUrl?: string
  summaries: Record<string, { summary: string; originalText: string; cached?: boolean; cachedAt?: string }>
  answers: Record<string, string>
}

export function OnedriveCard({ storeData, state, setState, onDisconnect }: OnedriveCardProps) {
  const { status, account } = state
  const toast = useToast()
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [rememberedAccounts, setRememberedAccounts] = useState<ConnectedService[]>([])
  const uniqueRememberedAccounts = rememberedAccounts.filter((saved, index, arr) => {
    const key = (saved.account_email || saved.account_id || "").toLowerCase()
    return key && arr.findIndex((s) => ((s.account_email || s.account_id || "").toLowerCase() === key)) === index
  })

  const updateState = (updates: Partial<OnedriveState>) => {
    setState({ ...state, ...updates })
  }

  useEffect(() => {
    const loadRememberedAccounts = async () => {
      try {
        const response = await apiClient.getConnectedServices()
        const remembered = (response.services || []).filter((s) => s.service_type === "onedrive")
        setRememberedAccounts(remembered)
      } catch {
        setRememberedAccounts([])
      }
    }
    loadRememberedAccounts()
  }, [])

  const connectOnedrive = async (forceNewAuth = false, rememberedEmail?: string, rememberedAccountId?: string) => {
    updateState({ status: "Connecting OneDrive... ⏳" })

    try {
      const accountId = rememberedAccountId || (rememberedEmail
        ? `onedrive_${rememberedEmail.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`
        : `onedrive_${Date.now()}`)
      const data = await apiClient.fetchCodeOnedrive({
        forceNewAuth,
        reconnectOnly: !!rememberedEmail,
        accountId,
        accountEmail: rememberedEmail,
      })

      if (data.status === "reauth_required") {
        updateState({ status: "Reconnect requires authentication ❗" })
        toast.warning(data.message || "Saved credentials not found. Please authenticate again.")
        return
      }

      if (data.status === "pending" && data.user_code) {
        updateState({
          status: "User authentication required!",
          account: {
            id: data.account_id || accountId,
            email: data.email_address || rememberedEmail || null,
            files: [],
            isConnected: false,
            showDatePicker: false,
            userCode: data.user_code,
            verificationUrl: data.verification_url,
            summaries: {},
            answers: {},
          },
        })
        toast.info("Please authenticate with Microsoft using the code shown.")
      } else if (data.status === "success") {
        updateState({
          status: "Connected ✅ - Please select a date range",
          account: {
            id: data.account_id || accountId,
            email: data.email_address || rememberedEmail || null,
            files: [],
            isConnected: true,
            showDatePicker: true,
            summaries: {},
            answers: {},
          },
        })
        toast.success("OneDrive connected successfully!")
      } else {
        updateState({ status: "Error connecting ❌" })
        toast.error("Failed to connect OneDrive.")
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

  const reconnectRememberedOnedrive = async (rememberedEmail?: string | null, rememberedAccountId?: string | null) => {
    await connectOnedrive(false, rememberedEmail || undefined, rememberedAccountId || undefined)
  }

  const authenticate = () => {
    if (account?.verificationUrl) {
      window.open(account.verificationUrl, "_blank")
    }
    updateState({
      status: "Connected ✅ - Please select a date range",
      account: account
        ? { ...account, isConnected: true, showDatePicker: true }
        : null,
    })
  }

  const fetchFilesFromDate = async (startDate: string) => {
    updateState({ status: "Fetching files from OneDrive... ⏳" })

    try {
      const selectedDate = new Date(startDate)
      const today = new Date()
      const timeDiff = today.getTime() - selectedDate.getTime()
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))

      const data: any = await apiClient.fetchOnedrive(
        daysDiff,
        "onedrive",
        account?.id,
        account?.email || undefined,
      )

      if (data.status === "pending") {
        const files = data.o_files.map((file: [string, string]) => ({
          name: file[0],
          id: file[1],
        }))

        const newAccount: OnedriveAccount = {
          ...(account as OnedriveAccount),
          files,
          showDatePicker: true,
        }

        updateState({ status: "Files loaded ✅", account: newAccount })

        const onedriveData: DataItem[] = files.map((file: OnedriveFile) => ({
          service: "onedrive",
          text: file.name,
          link: null,
          account: account?.email || null,
        }))
        storeData("onedrive", onedriveData)
        toast.success("OneDrive files loaded!")
      } else {
        updateState({ status: "Error fetching files ❌" })
        toast.error("Failed to fetch OneDrive files.")
      }
    } catch (error) {
      updateState({ status: "Error retrieving files ❌" })
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Unable to connect to server. Please check your connection.")
      }
    }
  }

  const summarizeFile = async (fileId: string, fileName: string, forceRefresh = false) => {
    try {
      const formData = new FormData()
      formData.append("file_id", fileId)
      formData.append("file_name", fileName)
      formData.append("file_mime_type", "")
      formData.append("file_source", "onedrive")
      if (account?.id) formData.append("account_id", account.id)
      formData.append("force_refresh", forceRefresh.toString())

      const response = await fetch("/api/summarize", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (data.summary) {
        const summaryData: DataItem[] = [
          {
            service: "onedrive",
            text: `${fileName} Summary: ${data.summary}`,
            link: null,
            account: account?.email || null,
          },
        ]
        storeData("onedrive", summaryData)

        updateState({
          account: account
            ? {
                ...account,
                summaries: {
                  ...account.summaries,
                  [fileId]: {
                    summary: data.summary,
                    originalText: data.original_text,
                    cached: data.cached || false,
                    cachedAt: data.cached_at || null,
                  },
                },
              }
            : null,
        })

        if (data.cached) {
          toast.info("Showing cached summary.")
        } else {
          toast.success(`${fileName} summarized!`)
        }
      }
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Error summarizing file.")
      }
    }
  }

  const askAboutFile = async (fileId: string, question: string) => {
    if (!account?.summaries[fileId]) return

    try {
      const { originalText, summary } = account.summaries[fileId]
      const data = await apiClient.askGemini(question, originalText, summary)

      updateState({
        account: account
          ? {
              ...account,
              answers: {
                ...account.answers,
                [fileId]: data.answer,
              },
            }
          : null,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Error with follow-up question.")
      }
    }
  }

  const getDefaultDate = () => {
    const date = new Date()
    date.setDate(date.getDate() - 30)
    return date.toISOString().split("T")[0]
  }

  const isConnected = !!account

  return (
    <div className="bg-amber-900/15 p-8 rounded-xl shadow-lg border border-white/20 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">OneDrive</h2>
        {isConnected && (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setIsMinimized((v) => !v)}
              className="bg-white/10 hover:bg-white/20 border border-white/20 text-xs px-2 py-1"
            >
              {isMinimized ? "Expand" : "Minimize"}
            </Button>
            <div className="relative">
              {showDisconnectConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-300">Disconnect?</span>
                  <Button
                    onClick={() => { onDisconnect(account?.email || undefined); setShowDisconnectConfirm(false) }}
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
                  title="Disconnect OneDrive"
                >
                  <Unplug className="w-4 h-4 mr-1" />
                  Disconnect
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {!account && (
        <div className="mb-4 flex gap-2 flex-wrap">
          {uniqueRememberedAccounts.map((saved) => (
              <div key={`${saved.service_type}-${saved.account_email || saved.account_id}`} className="flex items-center gap-1">
                <Button
                  onClick={() => reconnectRememberedOnedrive(saved.account_email, saved.account_id)}
                  className="bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/40"
                >
                  Reconnect {saved.account_email || saved.account_id || "saved account"}
                </Button>
                {saved.account_email && (
                  <Button
                    onClick={() => onDisconnect(saved.account_email || undefined)}
                    className="bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 px-2"
                  >
                    Forget
                  </Button>
                )}
              </div>
            ))}
          <Button
            onClick={() => connectOnedrive(true)}
            className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
          >
            Authenticate New Microsoft Account
          </Button>
        </div>
      )}

      <p className="mb-4">Status: {status}</p>

      {!isMinimized && (
      <>
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
        <OnedriveDatePicker
          onFetchFiles={fetchFilesFromDate}
          getDefaultDate={getDefaultDate}
          savedDate={state.selectedDate}
          onDateChange={(date) => updateState({ selectedDate: date })}
        />
      )}

      {account && account.files.length > 0 && (
        <OnedriveFileList
          files={account.files}
          summaries={account.summaries}
          answers={account.answers}
          onSummarize={summarizeFile}
          onAsk={askAboutFile}
        />
      )}
      </>
      )}
    </div>
  )
}

function OnedriveDatePicker({
  onFetchFiles,
  getDefaultDate,
  savedDate,
  onDateChange,
}: {
  onFetchFiles: (startDate: string) => Promise<void>
  getDefaultDate: () => string
  savedDate?: string
  onDateChange?: (date: string) => void
}) {
  const [selectedDate, setSelectedDate] = useState(savedDate || "")
  const [isLoading, setIsLoading] = useState(false)

  const handleDateSubmit = async () => {
    if (!selectedDate) return
    setIsLoading(true)
    await onFetchFiles(selectedDate)
    setIsLoading(false)
  }

  return (
    <div className="mb-6 p-4 bg-blue-900/20 rounded-lg border border-blue-500/30">
      <h4 className="text-lg font-semibold mb-3 text-blue-300">Select Date Range</h4>
      <p className="text-sm text-gray-300 mb-3">
        Choose a start date to fetch files modified from that date to today:
      </p>

      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label htmlFor="onedrive-date-picker" className="block mb-2 text-sm">
            Start Date:
          </label>
          <input
            type="date"
            id="onedrive-date-picker"
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
    </div>
  )
}

function OnedriveFileList({
  files,
  summaries,
  answers,
  onSummarize,
  onAsk,
}: {
  files: OnedriveFile[]
  summaries: Record<string, { summary: string; originalText: string; cached?: boolean; cachedAt?: string }>
  answers: Record<string, string>
  onSummarize: (fileId: string, fileName: string, forceRefresh?: boolean) => Promise<void>
  onAsk: (fileId: string, question: string) => Promise<void>
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Record<string, string>>({})
  const [askingId, setAskingId] = useState<string | null>(null)

  const handleSummarize = async (file: OnedriveFile, forceRefresh = false) => {
    setLoadingId(file.id)
    await onSummarize(file.id, file.name, forceRefresh)
    setLoadingId(null)
  }

  const handleAsk = async (fileId: string) => {
    const question = questions[fileId]
    if (!question) return
    setAskingId(fileId)
    await onAsk(fileId, question)
    setAskingId(null)
  }

  return (
    <ul className="space-y-3">
      {files.map((file) => (
        <li key={file.id} className="space-y-3">
          <div className="flex items-center justify-between p-2 bg-white/5 rounded">
            <span className="flex-1 text-blue-200">{file.name}</span>
            <Button
              onClick={() => handleSummarize(file)}
              disabled={loadingId === file.id}
              className="ml-4 bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
            >
              {loadingId === file.id ? <Loader2 className="animate-spin w-4 h-4" /> : "Summarize"}
            </Button>
          </div>

          {summaries[file.id] && (
            <div className="p-4 bg-white/10 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold">File Summary</h4>
                <div className="flex items-center gap-2">
                  {summaries[file.id].cached && summaries[file.id].cachedAt && (
                    <span className="text-xs bg-blue-600/30 text-blue-300 px-2 py-1 rounded">
                      Cached {new Date(summaries[file.id].cachedAt!).toLocaleDateString()}
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
              <p className="whitespace-pre-wrap mb-4">{summaries[file.id].summary}</p>

              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="Ask a question..."
                  value={questions[file.id] || ""}
                  onChange={(e) =>
                    setQuestions((prev) => ({ ...prev, [file.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAsk(file.id)
                  }}
                  className="flex-1 p-2 rounded border text-gray-900"
                />
                <Button
                  onClick={() => handleAsk(file.id)}
                  className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
                >
                  {askingId === file.id ? <Loader2 className="animate-spin w-4 h-4" /> : "Ask"}
                </Button>
              </div>

              {answers[file.id] && (
                <div className="mt-2 p-3 bg-white/5 rounded">
                  <strong>Answer:</strong> {answers[file.id]}
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
