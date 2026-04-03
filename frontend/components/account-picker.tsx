"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, User, Clock, CheckCircle2, Circle } from "lucide-react"
import { apiClient, type ServiceAccount } from "@/lib/api"

interface AccountPickerProps {
  serviceType: string
  serviceName: string
  onConnectNew: () => void
  onReconnect: (accountEmail: string) => void
  isConnecting?: boolean
  connectButtonLabel?: string
}

export function AccountPicker({
  serviceType,
  serviceName,
  onConnectNew,
  onReconnect,
  isConnecting = false,
  connectButtonLabel,
}: AccountPickerProps) {
  const [accounts, setAccounts] = useState<ServiceAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [reconnectingEmail, setReconnectingEmail] = useState<string | null>(null)

  useEffect(() => {
    loadAccounts()
  }, [serviceType])

  const loadAccounts = async () => {
    setIsLoading(true)
    try {
      const response = await apiClient.getServiceAccounts(serviceType)
      setAccounts(response.accounts || [])
    } catch (error) {
      console.error("Error loading service accounts:", error)
      setAccounts([])
    }
    setIsLoading(false)
  }

  const handleReconnect = async (accountEmail: string) => {
    setReconnectingEmail(accountEmail)
    try {
      await apiClient.reconnectService(serviceType, accountEmail)
      onReconnect(accountEmail)
    } catch (error) {
      console.error("Error reconnecting:", error)
    }
    setReconnectingEmail(null)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Unknown"
    const date = new Date(dateStr)
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const activeAccounts = accounts.filter((a) => a.is_active)
  const inactiveAccounts = accounts.filter((a) => !a.is_active)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading accounts...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Previously connected accounts */}
      {inactiveAccounts.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-300">Previously Connected</h4>
          <div className="space-y-2">
            {inactiveAccounts.map((account) => (
              <div
                key={account.account_email}
                className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10 hover:border-white/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-600/30 rounded-full">
                    <User className="w-4 h-4 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{account.account_email || "Unknown Account"}</p>
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last used: {formatDate(account.last_updated)}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => handleReconnect(account.account_email!)}
                  disabled={reconnectingEmail === account.account_email}
                  className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-sm"
                >
                  {reconnectingEmail === account.account_email ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Reconnect"
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Currently active accounts */}
      {activeAccounts.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-300">Active Connections</h4>
          <div className="space-y-2">
            {activeAccounts.map((account) => (
              <div
                key={account.account_email}
                className="flex items-center justify-between p-3 bg-green-900/20 rounded-lg border border-green-500/30"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-600/30 rounded-full">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{account.account_email || "Unknown Account"}</p>
                    <p className="text-xs text-green-400">Connected</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connect new account button */}
      <Button
        onClick={onConnectNew}
        disabled={isConnecting}
        className="w-full bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
      >
        {isConnecting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Connecting...
          </>
        ) : (
          connectButtonLabel || `Connect ${accounts.length > 0 ? "Another" : ""} ${serviceName} Account`
        )}
      </Button>
    </div>
  )
}
