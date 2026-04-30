"use client"

import { useEffect, useState } from "react"
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
  const [demoMode, setDemoMode] = useState(true)
  const [loadingDemoMode, setLoadingDemoMode] = useState(true)
  const [switchingDemoMode, setSwitchingDemoMode] = useState(false)
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

  const handleDisconnect = async (serviceType: string, accountEmail?: string) => {
    try {
      await apiClient.disconnectService(serviceType, accountEmail)
      toast.success(
        accountEmail
          ? `${serviceType} account disconnected: ${accountEmail}`
          : `${serviceType} disconnected successfully.`,
      )

      // Reset the service state
      switch (serviceType) {
        case "gmail":
          if (accountEmail) {
            setGmailState((prev) => {
              const nextAccounts = prev.accounts.filter((acc) => acc.email !== accountEmail)
              return {
                ...prev,
                accounts: nextAccounts,
                connectedCount: nextAccounts.length,
                status: nextAccounts.length > 0 ? "Connected ✅" : "Not Connected",
              }
            })
          } else {
            setGmailState({ status: "Not Connected", accounts: [], connectedCount: 0 })
          }
          break
        case "drive":
          if (accountEmail) {
            setDriveState((prev) => {
              const nextAccounts = prev.accounts.filter((acc) => acc.email !== accountEmail)
              return {
                ...prev,
                accounts: nextAccounts,
                connectedCount: nextAccounts.length,
                status: nextAccounts.length > 0 ? "Connected ✅" : "Not Connected",
              }
            })
          } else {
            setDriveState({ status: "Not Connected", accounts: [], connectedCount: 0 })
          }
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

      // Remove data for this service (and account if provided)
      setAllData((prev) =>
        prev.filter((item) => {
          if (item.service !== serviceType) return true
          if (!accountEmail) return false
          return item.account !== accountEmail
        }),
      )
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error(`Failed to disconnect ${serviceType}.`)
      }
    }
  }

  useEffect(() => {
    const loadDemoMode = async () => {
      try {
        const response = await apiClient.getDemoMode()
        setDemoMode(response.demo_mode)
      } catch {
        setDemoMode(true)
      } finally {
        setLoadingDemoMode(false)
      }
    }
    loadDemoMode()
  }, [])

  const toggleDemoMode = async () => {
    const nextMode = !demoMode
    setSwitchingDemoMode(true)
    try {
      await apiClient.setDemoMode(nextMode)
      setDemoMode(nextMode)
      toast.success(
        nextMode
          ? "Demo mode enabled. Reloading with fixture data."
          : "Live mode enabled. Reloading for real account connections.",
      )
      window.location.reload()
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.friendlyMessage)
      } else {
        toast.error("Could not switch modes right now.")
      }
      setSwitchingDemoMode(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-800 to-amber-800 text-gray-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-4xl flex justify-end mb-4">
        <button
          type="button"
          onClick={toggleDemoMode}
          disabled={loadingDemoMode || switchingDemoMode}
          className="rounded-full border border-white/30 bg-black/20 px-4 py-2 text-sm font-medium transition hover:bg-black/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loadingDemoMode
            ? "Checking mode..."
            : switchingDemoMode
              ? "Switching..."
              : demoMode
                ? "Switch to Real Accounts"
                : "Switch to Demo Mode"}
        </button>
      </div>

      {!loadingDemoMode && (
        <div className="mb-4 rounded-full border border-white/20 bg-black/20 px-4 py-2 text-sm">
          {demoMode
            ? "Demo mode is on. The app uses fixture data until you switch to real accounts."
            : "Live mode is on. Real account connection flows are enabled for this browser."}
        </div>
      )}

      <ServiceLogos onServiceClick={showDashboard} isShrunken={activeService !== null} />

      {activeService && (
        <div className="w-full max-w-4xl mt-20 bg-black/10 backdrop-blur-sm rounded-xl p-6">
          <SearchContainer allData={allData} />

          {activeService === "gmail" && (
            <GmailCard storeData={storeData} state={gmailState} setState={setGmailState} onDisconnect={(accountEmail?: string) => handleDisconnect("gmail", accountEmail)} />
          )}
          {activeService === "drive" && (
            <DriveCard storeData={storeData} state={driveState} setState={setDriveState} onDisconnect={(accountEmail?: string) => handleDisconnect("drive", accountEmail)} />
          )}
          {activeService === "outlook" && (
            <OutlookCard storeData={storeData} state={outlookState} setState={setOutlookState} onDisconnect={(accountEmail?: string) => handleDisconnect("outlook", accountEmail)} />
          )}
          {activeService === "onedrive" && (
            <OnedriveCard storeData={storeData} state={onedriveState} setState={setOnedriveState} onDisconnect={(accountEmail?: string) => handleDisconnect("onedrive", accountEmail)} />
          )}
          {activeService === "canvas" && (
            <CanvasCard storeData={storeData} state={canvasState} setState={setCanvasState} onDisconnect={(accountEmail?: string) => handleDisconnect("canvas", accountEmail)} />
          )}
        </div>
      )}
    </div>
  )
}
