"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { ToastContainer, type ToastVariant, type ToastData } from "@/components/ui/toast"

interface ToastContextType {
  showToast: (message: string, variant?: ToastVariant) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`
    setToasts((prev) => [...prev, { id, message, variant }])
  }, [])

  const success = useCallback((message: string) => showToast(message, "success"), [showToast])
  const error = useCallback((message: string) => showToast(message, "error"), [showToast])
  const warning = useCallback((message: string) => showToast(message, "warning"), [showToast])
  const info = useCallback((message: string) => showToast(message, "info"), [showToast])

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return context
}
