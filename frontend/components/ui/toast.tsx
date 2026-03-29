"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

export type ToastVariant = "success" | "error" | "warning" | "info"

export interface ToastData {
  id: string
  message: string
  variant: ToastVariant
}

interface ToastProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

const variantStyles: Record<ToastVariant, string> = {
  success: "bg-green-600 border-green-400",
  error: "bg-red-600 border-red-400",
  warning: "bg-yellow-600 border-yellow-400",
  info: "bg-blue-600 border-blue-400",
}

const variantIcons: Record<ToastVariant, string> = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
}

function Toast({ toast, onDismiss }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true)
      setTimeout(() => onDismiss(toast.id), 300)
    }, 5000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(() => onDismiss(toast.id), 300)
  }

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg text-white min-w-[300px] max-w-[450px] transition-all duration-300 ${
        variantStyles[toast.variant]
      } ${isExiting ? "opacity-0 translate-x-4" : "opacity-100 translate-x-0"}`}
    >
      <span className="text-lg font-bold flex-shrink-0">{variantIcons[toast.variant]}</span>
      <p className="flex-1 text-sm">{toast.message}</p>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 p-1 rounded hover:bg-white/20 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

interface ToastContainerProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
