"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import type { DataItem, CanvasState } from "@/app/page"

interface CanvasCardProps {
  storeData: (service: string, data: DataItem[]) => void
  state: CanvasState
  setState: (state: CanvasState) => void
}

interface Course {
  id: string
  name: string
}

export function CanvasCard({ storeData, state, setState }: CanvasCardProps) {
  const { status, courses, selectedCourse, courseContent } = state

  const updateState = (updates: Partial<CanvasState>) => {
    setState({ ...state, ...updates })
  }

  const connectCanvas = async () => {
    updateState({ status: "Connecting Canvas... ⏳" })
    // Add your Canvas connection logic here
    setTimeout(() => {
      updateState({ status: "Connected ✅" })
    }, 2000)
  }

  const fetchContent = async (courseId: string, contentType: string) => {
    try {
      const response = await fetch("/api/course_details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: courseId,
          content_type: contentType,
        }),
      })

      const data = await response.json()

      if (data.content) {
        updateState({ courseContent: data.content })
        const contentData: DataItem[] = [
          {
            service: "canvas",
            text: `Canvas - ${contentType}: ${data.content}`,
            link: null,
            account: null,
          },
        ]
        storeData("canvas", contentData)
      } else {
        updateState({ courseContent: "Error fetching content." })
      }
    } catch (error) {
      console.error("Error fetching course content:", error)
      updateState({ courseContent: "Error fetching content." })
    }
  }

  useEffect(() => {
    // Only fetch courses if we don't have them already
    if (courses.length === 0) {
      // In a real implementation, you would fetch courses from your backend
      // For now, we'll use placeholder data
      updateState({
        courses: [
          { id: "1", name: "Course 1" },
          { id: "2", name: "Course 2" },
          { id: "3", name: "Course 3" },
        ],
      })
    }
  }, [courses.length]) // Removed updateState from dependencies

  return (
    <div className="bg-amber-900/15 p-8 rounded-xl shadow-lg border border-white/20 mb-8">
      <h2 className="text-2xl font-bold mb-4">Canvas</h2>

      <Button
        onClick={connectCanvas}
        className="bg-gradient-to-r from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700 mb-4"
      >
        Connect Canvas
      </Button>

      <p className="mb-4">Status: {status}</p>

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
              <div className="whitespace-pre-wrap">{courseContent}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
