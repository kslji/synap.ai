import type { View } from './types'

export const TOUR = [
  { id: 'agents', view: 'home' as View, title: 'Your agents', body: 'Code is the agent you can chat with. The others are coming soon and stay on the card.' },
  { id: 'attach', view: 'chat' as View, title: 'Attach a file', body: 'Add a document here. It stays on this computer, and answers can cite the page.' },
  { id: 'online', view: 'chat' as View, title: 'Network', body: 'The status chip shows Offline, Online, or Auto. Change it in Settings. Offline stays on this computer.' },
]
