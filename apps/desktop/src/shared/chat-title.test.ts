import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentFilterIds, isPlaceholderTitle, labelFromAgentId, messagePlaceholder, newChatTitle, switchAgentChat } from './chat-title.js'

test('a new chat is named after its agent until a real title exists', () => {
  assert.equal(newChatTitle('Code'), 'New Code chat')
  assert.equal(newChatTitle('  Assistant '), 'New Assistant chat')
  assert.equal(newChatTitle(''), 'New chat')
  assert.equal(newChatTitle('Code/chat'), 'New chat')
  assert.equal(isPlaceholderTitle('New chat'), true)
  assert.equal(isPlaceholderTitle('New Code chat'), true)
  assert.equal(isPlaceholderTitle('Hello'), false)
  assert.equal(isPlaceholderTitle('New Harbor ferry'), false)
  assert.equal(messagePlaceholder('Code'), 'Message Code…')
  assert.equal(messagePlaceholder('Surf'), 'Message Surf…')
  assert.equal(messagePlaceholder('Harbor'), 'Message Harbor…')
  assert.equal(labelFromAgentId('code'), 'Code')
  assert.equal(labelFromAgentId('marine'), 'Marine')
  assert.equal(labelFromAgentId(''), 'General')
})

test('switching agent opens that agent or starts a chat, and does not retitle', () => {
  const chats = [
    { id: 'g1', agentId: 'general', updatedAt: 1 },
    { id: 'c-old', agentId: 'code', updatedAt: 2 },
    { id: 'c-new', agentId: 'code', updatedAt: 5 },
  ]
  assert.deepEqual(switchAgentChat('g1', 'general', 'general', chats), { kind: 'stay' })
  assert.deepEqual(switchAgentChat('g1', 'general', 'code', chats), { kind: 'open', id: 'c-new' })
  assert.deepEqual(switchAgentChat('c-new', 'code', 'assistant', chats), { kind: 'start' })
  assert.deepEqual(switchAgentChat(null, null, 'general', chats), { kind: 'open', id: 'g1' })
})

test('the sidebar filter lists chat agents, and a coming-soon agent only after it has a chat', () => {
  const agents = [
    { id: 'general', canChat: true },
    { id: 'code', canChat: true },
    { id: 'construction', canChat: false },
  ]
  assert.deepEqual(agentFilterIds(agents, []), ['general', 'code'])
  assert.deepEqual(agentFilterIds(agents, [{ agentId: 'construction' }]), ['general', 'code', 'construction'])
  assert.deepEqual(agentFilterIds(agents, [{ agentId: 'pilot' }]), ['general', 'code', 'pilot'])
})
