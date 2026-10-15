import React, { createElement, type ReactNode } from 'react'
import { parseMarkdown, type Inline } from './markdown'

function InlineView({ nodes }: { nodes: Inline[] }): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'text') return <span key={index}>{node.text}</span>
    if (node.type === 'strong') return <strong key={index}><InlineView nodes={node.children} /></strong>
    if (node.type === 'em') return <em key={index}><InlineView nodes={node.children} /></em>
    if (node.type === 'code') return <code key={index}>{node.text}</code>
    return (
      <a key={index} href={node.href} target="_blank" rel="noreferrer">
        <InlineView nodes={node.children} />
      </a>
    )
  })
}

const headingClass: Record<number, string> = {
  1: 'mt-2 text-3xl font-semibold tracking-tight',
  2: 'mt-8 text-2xl font-semibold tracking-tight',
  3: 'mt-6 text-xl font-semibold',
  4: 'mt-4 text-lg font-semibold',
  5: 'mt-4 text-base font-semibold',
  6: 'mt-4 text-sm font-semibold',
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source)
  return (
    <div data-markdown="yes" className="flex flex-col gap-3">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
          return createElement(tag, { key: index, className: headingClass[block.level] }, <InlineView nodes={block.children} />)
        }
        if (block.type === 'paragraph') {
          return <p key={index}><InlineView nodes={block.children} /></p>
        }
        if (block.type === 'rule') return <hr key={index} className="border-[var(--line)]" />
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag key={index} className={block.ordered ? 'list-decimal space-y-2 pl-5' : 'list-disc space-y-2 pl-5'}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}><InlineView nodes={item} /></li>)}
            </Tag>
          )
        }
        return (
          <div key={index} className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={cellIndex} className="border-b border-[var(--line)] px-2 py-2 align-top font-semibold">{<InlineView nodes={cell} />}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border-b border-[var(--line)] px-2 py-2 align-top">{<InlineView nodes={cell} />}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
