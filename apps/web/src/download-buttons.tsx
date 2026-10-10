import React, { type MouseEvent } from 'react'

function beginDownload(event: MouseEvent<HTMLAnchorElement>, os: 'mac' | 'windows', onStart?: (os: 'mac' | 'windows') => void) {
  event.preventDefault()
  onStart?.(os)
  const link = document.createElement('a')
  link.href = event.currentTarget.href
  link.target = '_blank'
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function DownloadButtons({
  mac,
  win,
  macLabel,
  winLabel,
  macSuggested,
  winSuggested,
  onStart,
}: {
  mac: string
  win: string
  macLabel: string
  winLabel: string
  macSuggested: boolean
  winSuggested: boolean
  onStart?: (os: 'mac' | 'windows') => void
}) {
  return (
    <>
      <a className="btn btn-primary no-underline" href={mac} data-download="mac" data-suggested={macSuggested ? 'yes' : 'no'} onClick={(event) => beginDownload(event, 'mac', onStart)}>
        {macLabel}
      </a>
      <a className="btn btn-ghost no-underline" href={win} data-download="windows" data-suggested={winSuggested ? 'yes' : 'no'} onClick={(event) => beginDownload(event, 'windows', onStart)}>
        {winLabel}
      </a>
    </>
  )
}
