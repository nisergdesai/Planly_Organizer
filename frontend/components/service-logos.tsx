"use client"

import type { ServiceType } from "@/app/page"

interface ServiceLogosProps {
  onServiceClick: (service: ServiceType) => void
  isShrunken: boolean
}

export function ServiceLogos({ onServiceClick, isShrunken }: ServiceLogosProps) {
  const services = [
    {
      id: "gmail" as const,
      src: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg",
      alt: "Gmail",
    },
    {
      id: "drive" as const,
      src: "https://upload.wikimedia.org/wikipedia/commons/d/da/Google_Drive_logo.png",
      alt: "Google Drive",
    },
    {
      id: "outlook" as const,
      src: "https://upload.wikimedia.org/wikipedia/commons/d/df/Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg",
      alt: "Outlook",
    },
    {
      id: "onedrive" as const,
      src: "https://upload.wikimedia.org/wikipedia/commons/3/3c/Microsoft_Office_OneDrive_%282019%E2%80%93present%29.svg",
      alt: "OneDrive",
    },
    { id: "canvas" as const, src: "https://www.wabash.edu/images2/technology/canvas.png", alt: "Canvas" },
  ]

  return (
    <div
      className={`flex gap-6 justify-center flex-wrap transition-all duration-500 ease-in-out p-5 relative z-10 ${
        isShrunken ? "fixed top-2 left-2 transform-none justify-start p-2 rounded-lg" : ""
      }`}
    >
      {services.map((service) => (
        <div
          key={service.id}
          className="bg-white/15 p-4 rounded-xl cursor-pointer transition-all duration-300 hover:scale-110 hover:bg-white/30"
          onClick={() => onServiceClick(service.id)}
        >
          <img
            src={service.src || "/placeholder.svg"}
            alt={service.alt}
            className={`transition-all duration-300 ${
              isShrunken ? "w-10 h-10" : "w-16 h-16"
            } ${service.alt === "OneDrive" ? "scale-120" : ""}`}
          />
        </div>
      ))}
    </div>
  )
}
