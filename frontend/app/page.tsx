"use client"

import { useState } from "react"
import { ServiceLogos } from "@/components/service-logos"
import { SearchContainer } from "@/components/search-container"
import { GmailCard } from "@/components/gmail-card"
import { DriveCard } from "@/components/drive-card"
import { OutlookCard } from "@/components/outlook-card"
import { OnedriveCard } from "@/components/onedrive-card"
import { CanvasCard } from "@/components/canvas-card"
import { useToast } from "@/lib/toast-context"
import { apiClient, ApiError } from "@/lib/api"

export type ServiceType = "gmail" | "drive" | "outlook" | "onedrive" | "canvas" | null

export interface DataItem {
  service: string
  text: string
  link: string | null
  account?: string | null
}

// Service state interfaces
export interface GmailState {
  status: string
  accounts: any[]
  connectedCount: number
}

export interface DriveState {
  status: string
  accounts: any[]
  connectedCount: number
}

export interface OutlookState {
  status: string
  account: any | null
  selectedEmails: string[]
  selectedDate?: string
}

export interface OnedriveState {
  status: string
  account: any | null
  selectedDate?: string
}

export interface CanvasState {
  status: string
  courses: any[]
  selectedCourse: string
  courseContent: string
}

export default function Dashboard() {
  const [activeService, setActiveService] = useState<ServiceType>(null)
  const [allData, setAllData] = useState<DataItem[]>([])
  const toast = useToast()

  // Persistent service states
  const [gmailState, setGmailState] = useState<GmailState>({
    status: "Not Connected",
    accounts: [],
    connectedCount: 0,
  })

  const [driveState, setDriveState] = useState<DriveState>({
    status: "Not Connected",
    accounts: [],
    connectedCount: 0,
  })

  const [outlookState, setOutlookState] = useState<OutlookState>({
    status: "Not Connected",
    account: null,
    selectedEmails: [],
  })

  const [onedriveState, setOnedriveState] = useState<OnedriveState>({
    status: "Not Connected",
    account: null,
  })

  const [canvasState, setCanvasState] = useState<CanvasState>({
    status: "Not Connected",
    courses: [],
    selectedCourse: "",
    courseContent: "",
  })

  const showDashboard = (service: ServiceType) => {
    setActiveService(service)
  }

  const storeData = (service: string, dataList: DataItem[]) => {
    console.log(`Storing data for ${service}:`, dataList)

    setAllData((prevData) => {
      const newData = [...prevData]

      dataList.forEach((item) => {
        const newItem = {
          service,
          text: item.text || "",
          link: item.link || null,
          account: item.account || null,
        }

        const exists = newData.some(
          (existingItem) =>
            existingItem.service === newItem.service &&
            existingItem.text === newItem.text &&
            existingItem.link === newItem.link &&
            existingItem.account === newItem.account,
        )

        if (!exists) {
          newData.push(newItem)
        }
      })

      return newData
    })
  }

  const handleDisconnect = async (serviceType: string) => {
    try {
      await apiClient.disconnectService(serviceType)
      toast.success(`${serviceType} disconnected successfully.`)

      // Reset the service state
      switch (serviceType) {
        case "gmail":
          setGmailState({ status: "Not Connected", accounts: [], connectedCount: 0 })
          break
        case "drive":
          setDriveState({ status: "Not Connected", accounts: [], connectedCount: 0 })
          break
        case "outlook":
          setOutlookState({ status: "Not Connected", account: null, selectedEmails: [] })
          break
        case "onedrive":
          setOnedriveState({ status: "Not Connected", account: null })
          break
        case "canvas":
          setCanvasState({ status: "Not Connected", courses: [], selectedCourse: "", courseContent: "" })
          break
      }

      // Remove data for this service
      setAllData((prev) => prev.filter((item) => item.service !== serviceType))
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error(`Failed to disconnect ${serviceType}.`)
      }
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-800 to-amber-800 text-gray-100 flex flex-col items-center justify-center p-4">
      <ServiceLogos onServiceClick={showDashboard} isShrunken={activeService !== null} />

      {activeService && (
        <div className="w-full max-w-4xl mt-20 bg-black/10 backdrop-blur-sm rounded-xl p-6">
          <SearchContainer allData={allData} />

          {activeService === "gmail" && (
            <GmailCard storeData={storeData} state={gmailState} setState={setGmailState} onDisconnect={() => handleDisconnect("gmail")} />
          )}
          {activeService === "drive" && (
            <DriveCard storeData={storeData} state={driveState} setState={setDriveState} onDisconnect={() => handleDisconnect("drive")} />
          )}
          {activeService === "outlook" && (
            <OutlookCard storeData={storeData} state={outlookState} setState={setOutlookState} onDisconnect={() => handleDisconnect("outlook")} />
          )}
          {activeService === "onedrive" && (
            <OnedriveCard storeData={storeData} state={onedriveState} setState={setOnedriveState} onDisconnect={() => handleDisconnect("onedrive")} />
          )}
          {activeService === "canvas" && (
            <CanvasCard storeData={storeData} state={canvasState} setState={setCanvasState} onDisconnect={() => handleDisconnect("canvas")} />
          )}
        </div>
      )}
    </div>
  )
}
