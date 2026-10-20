/**
 * Simple Chat Layout
 * Just the chat interface, no file management
 */

interface SimpleChatLayoutProps {
  children: React.ReactNode
}

export function SimpleChatLayout({
  children,
}: SimpleChatLayoutProps) {
  return (
    <div className="flex h-full" data-simple-chat="yes">
      {/* Chat Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  )
}
