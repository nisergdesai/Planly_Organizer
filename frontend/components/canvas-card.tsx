"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw, Unplug } from "lucide-react"
import { useToast } from "@/lib/toast-context"
import { apiClient, ApiError, type ConnectedService } from "@/lib/api"
import type { DataItem, CanvasState } from "@/app/page"

interface CanvasCardProps {
  storeData: (service: string, data: DataItem[]) => void
  state: CanvasState
  setState: (state: CanvasState) => void
  onDisconnect: () => void
}

interface Course {
  id: string
  name: string
}

export function CanvasCard({ storeData, state, setState, onDisconnect }: CanvasCardProps) {
  const { status, courses, selectedCourse, courseContent } = state
  const toast = useToast()
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  const [rememberedAccounts, setRememberedAccounts] = useState<ConnectedService[]>([])
  const [contentCached, setContentCached] = useState(false)
  const [contentCachedAt, setContentCachedAt] = useState<string | null>(null)
  const [lastContentType, setLastContentType] = useState<string | null>(null)

  const updateState = (updates: Partial<CanvasState>) => {
    setState({ ...state, ...updates })
  }

  useEffect(() => {
    const loadRememberedAccounts = async () => {
      try {
        const response = await apiClient.getConnectedServices()
        const remembered = (response.services || []).filter((s) => s.service_type === "canvas")
        setRememberedAccounts(remembered)
      } catch {
        setRememberedAccounts([])
      }
    }
    loadRememberedAccounts()
  }, [])

  const connectCanvas = async () => {
    updateState({ status: "Connecting Canvas... ⏳" })

    try {
      const response = await fetch("/api/get_courses")
      const data = await response.json()

      if (data.status === "success" && data.courses) {
        updateState({
          status: "Connected ✅",
          courses: data.courses
        })
        toast.success("Canvas connected successfully!")
      } else {
        updateState({ status: "Connection failed ❌" })
        toast.error("Failed to connect Canvas.")
      }
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Unable to connect to server. Please check your connection.")
      }
      updateState({ status: "Connection failed ❌" })
    }
  }

  const fetchContent = async (courseId: string, contentType: string, forceRefresh = false) => {
    try {
      const response = await fetch("/api/course_details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: courseId,
          content_type: contentType,
          force_refresh: forceRefresh,
        }),
      })

      const data = await response.json()
      if (data.content) {
        updateState({ courseContent: data.content })
        setContentCached(data.cached || false)
        setContentCachedAt(data.cached_at || null)
        setLastContentType(contentType)

        const contentData: DataItem[] = [
          {
            service: "canvas",
            text: `Canvas - ${contentType}: ${data.content}`,
            link: null,
            account: null,
          },
        ]
        storeData("canvas", contentData)

        if (data.cached) {
          toast.info("Showing cached content.")
        } else {
          toast.success(`${contentType} loaded!`)
        }
      } else {
        updateState({ courseContent: "Error fetching content." })
        toast.error("Failed to fetch course content.")
      }
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Error fetching course content.")
      }
      updateState({ courseContent: "Error fetching content." })
    }
  }

  const isConnected = courses.length > 0

  return (
    <div className="bg-amber-900/15 p-8 rounded-xl shadow-lg border border-white/20 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Canvas</h2>
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
                title="Disconnect Canvas"
              >
                <Unplug className="w-4 h-4 mr-1" />
                Disconnect
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mb-4 flex gap-2 flex-wrap">
        {courses.length === 0 && rememberedAccounts.length > 0 && (
          <Button
            onClick={connectCanvas}
            className="bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/40"
            disabled={status.includes("⏳")}
          >
            Reconnect Remembered Canvas
          </Button>
        )}
        <Button
          onClick={connectCanvas}
          className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
          disabled={status.includes("⏳")}
        >
          {status.includes("⏳") ? "Connecting..." : "Connect Canvas"}
        </Button>
      </div>
      <p className="mb-4">Status: {status}</p>

      {courses.length > 0 && (
        <div className="mb-6">
          <select
            value={selectedCourse}
            onChange={(e) => updateState({ selectedCourse: e.target.value })}
            className="p-3 rounded-md border border-gray-300 text-gray-900 w-full max-w-md"
          >
            <option value="">Select a Course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedCourse && (
        <div className="space-y-4">
          <div className="flex gap-4 flex-wrap">
            <Button
              onClick={() => fetchContent(selectedCourse, "syllabus")}
              className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
            >
              Syllabus
            </Button>
            <Button
              onClick={() => fetchContent(selectedCourse, "upcoming_assignments")}
              className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
            >
              Upcoming Assignments
            </Button>
            <Button
              onClick={() => fetchContent(selectedCourse, "recent_announcements")}
              className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700"
            >
              Recent Announcements
            </Button>
          </div>

          {courseContent && (
            <div className="mt-4 p-4 bg-white/10 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold">Content</h4>
                <div className="flex items-center gap-2">
                  {contentCached && contentCachedAt && (
                    <span className="text-xs bg-blue-600/30 text-blue-300 px-2 py-1 rounded">
                      Cached {new Date(contentCachedAt).toLocaleDateString()}
                    </span>
                  )}
                  {lastContentType && (
                    <button
                      onClick={() => fetchContent(selectedCourse, lastContentType, true)}
                      className="p-1 rounded hover:bg-white/20 transition-colors"
                      title="Refresh content"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              <div
                className="whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: courseContent }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
