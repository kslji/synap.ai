import type { View } from './types'

export const TOUR = [
  { id: 'agents', view: 'home' as View, title: 'Your agents', body: 'General, Code + UI, and Assistant each keep their own chats. Coming soon stays on the card.' },
  { id: 'attach', view: 'chat' as View, title: 'Attach a file', body: 'Add a document here. It stays on this computer, and answers can cite the page.' },
  { id: 'online', view: 'chat' as View, title: 'Offline or online', body: 'Offline uses this computer. Online can search the web when you allow it.' },
]
