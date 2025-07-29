"use client"

import { useState } from "react"
import type { DataItem } from "@/app/page"

interface SearchContainerProps {
  allData: DataItem[]
}

export function SearchContainer({ allData }: SearchContainerProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [serviceFilter, setServiceFilter] = useState("all")

  const filterResults = () => {
    if (searchQuery.trim() === "") return []

    return allData.filter(
      (item) =>
        (serviceFilter === "all" || item.service === serviceFilter) &&
        item.text.toLowerCase().includes(searchQuery.toLowerCase()),
    )
  }

  const filteredResults = filterResults()

  const highlightText = (text: string, query: string) => {
    if (!query) return text
    const regex = new RegExp(`(${query})`, "gi")
    return text.replace(regex, "<mark>$1</mark>")
  }

  return (
    <div className="mb-6">
      <div className="flex justify-center gap-4 mb-5 p-2">
        <input
          type="text"
          placeholder="Search data..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-80 p-3 rounded-md border border-gray-300 text-gray-900"
        />
        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          className="p-3 rounded-md border border-gray-300 text-gray-900"
        >
          <option value="all">All</option>
          <option value="gmail">Gmail</option>
          <option value="drive">Google Drive</option>
          <option value="outlook">Outlook</option>
          <option value="onedrive">OneDrive</option>
          <option value="canvas">Canvas</option>
        </select>
      </div>

      {searchQuery.trim() !== "" && (
        <ul className="list-none p-0 mt-2 max-h-80 overflow-y-auto w-full max-w-2xl mx-auto bg-white/10 rounded-lg shadow-lg">
          {filteredResults.length === 0 ? (
            <li className="p-3 border-b border-white/20">No results found.</li>
          ) : (
            filteredResults.map((item, index) => (
              <li key={index} className="p-3 border-b border-white/20 transition-colors hover:bg-white/20">
                <span className="text-blue-300">({item.service})</span>{" "}
                {item.link ? (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-100 no-underline font-bold hover:underline"
                    dangerouslySetInnerHTML={{ __html: highlightText(item.text, searchQuery) }}
                  />
                ) : (
                  <span dangerouslySetInnerHTML={{ __html: highlightText(item.text, searchQuery) }} />
                )}
                {item.account && <br />}
                {item.account && <span className="text-gray-400 text-sm">Account: {item.account}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
