import React from 'react'

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
      <a className="btn btn-primary no-underline" href={mac} data-download="mac" data-suggested={macSuggested ? 'yes' : 'no'} onClick={() => onStart?.('mac')}>
        {macLabel}
      </a>
      <a className="btn btn-ghost no-underline" href={win} data-download="windows" data-suggested={winSuggested ? 'yes' : 'no'} onClick={() => onStart?.('windows')}>
        {winLabel}
      </a>
    </>
  )
}
