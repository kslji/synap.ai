/**
 * Live connector desk. The sample mailbox stays for the approval screens.
 * Sign-in, the outbox, and invoice files go through ConnectorHub and the same gate.
 */
import { app, safeStorage, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createAssistantDesk, type ConnectorSpec, type DeskView } from './assistant-desk.js'
import { randomCipher, type Cipher } from './connector-crypto.js'
import { ConnectorHub, loginItem } from './connector-hub.js'
import { devPlaceholder, productionEndpoints, startMockCloud, type MockCloud, type ProviderId } from './connector-oauth.js'
import { draftInvoice } from './invoice.js'
import { invoicePdf } from './invoice-export.js'

async function vaultCipher(): Promise<Cipher> {
  try {
    if (await safeStorage.isAsyncEncryptionAvailable()) {
      return {
        encrypt: async (plain) => Buffer.from(await safeStorage.encryptStringAsync(plain)),
        decrypt: async (blob) => (await safeStorage.decryptStringAsync(blob)).result,
      }
    }
  } catch { /* headless capture has no keychain */ }
  return randomCipher()
}

export function createLiveAssistant(connectors: ConnectorSpec[]) {
  const desk = createAssistantDesk(connectors)
  let hub: ConnectorHub | null = null
  let mock: MockCloud | null = null
  let invoice: DeskView['invoice'] = null
  let notice: string | null = null

  async function cloud(): Promise<ConnectorHub> {
    if (hub) return hub
    const cipher = await vaultCipher()
    const dir = join(app.getPath('userData'), 'connectors')
    mkdirSync(dir, { recursive: true })
    hub = new ConnectorHub({
      dir,
      cipher,
      open: async (url) => {
        if (mock) await fetch(url)
        else await shell.openExternal(url)
      },
      notify: (title, body) => {
        try {
          const { Notification } = require('electron') as typeof import('electron')
          if (Notification.isSupported()) new Notification({ title, body }).show()
        } catch { /* notifications are optional in tests */ }
      },
      login: (openAtLogin) => {
        try { app.setLoginItemSettings(loginItem(openAtLogin)) } catch { /* some Linux sessions have no login item */ }
      },
      apiBase: '',
    })
    await hub.load()
    return hub
  }

  async function useMock(): Promise<MockCloud> {
    if (!mock) mock = await startMockCloud()
    return mock
  }

  function providerId(raw: string): ProviderId | null {
    if (raw === 'gmail' || raw === 'gcalendar' || raw === 'gdrive' || raw === 'google') return 'google'
    if (raw === 'outlook') return 'microsoft'
    if (raw === 'slack') return 'slack'
    return null
  }

  function features(raw: string): string[] {
    if (raw === 'gcalendar') return ['gmail', 'calendar']
    if (raw === 'gdrive') return ['gmail', 'drive']
    if (raw === 'outlook') return ['mail', 'calendar']
    if (raw === 'google') return ['gmail']
    return ['gmail']
  }

  async function endpointsFor(id: ProviderId) {
    const fromEnv = productionEndpoints(id, process.env)
    if (fromEnv && !process.env.SURF_CAPTURE_DIR) return { endpoints: fromEnv, base: '' }
    const cloudMock = await useMock()
    const clientId = fromEnv?.clientId || devPlaceholder(id)
    return { endpoints: cloudMock.endpoints(id, clientId), base: cloudMock.base }
  }

  async function view(now = Date.now()): Promise<DeskView> {
    const base = desk.view(now)
    const current = hub
    const connected = new Map<string, string>()
    if (current?.token('google')) {
      const account = current.token('google')?.account || 'ada@harbor.example'
      connected.set('gmail', account)
      if (current.token('google')?.scopes.some((scope) => scope.includes('calendar'))) connected.set('gcalendar', account)
      if (current.token('google')?.scopes.some((scope) => scope.includes('drive'))) connected.set('gdrive', account)
    }
    if (current?.token('microsoft')) connected.set('outlook', current.token('microsoft')?.account || 'ada@harbor.example')
    if (current?.token('slack')) connected.set('slack', current.token('slack')?.account || 'ada')
    return {
      ...base,
      connectors: base.connectors.map((row) => ({
        ...row,
        connected: connected.has(row.id),
        account: connected.get(row.id) ?? null,
      })),
      outbox: (current?.outbox() ?? []).map((item) => ({
        id: item.id,
        summary: item.subject,
        status: item.status,
        when: item.runAt ? new Date(item.runAt).toISOString() : 'when online',
      })),
      invoice,
      loginAtStart: current?.wantsLogin() ?? false,
      notice,
    }
  }

  return {
    desk: () => view(),
    draft: async (summary: string) => desk.armSend(summary, Date.now()),
    approve: async (id: string) => {
      const now = Date.now()
      if (hub?.outbox().some((item) => item.id === id)) await hub.approve(id, now)
      else desk.approve(id, now)
      return view(now)
    },
    cancel: async (id: string) => desk.cancel(id, Date.now()),
    armDelete: async () => desk.armDelete(Date.now()),
    async connect(raw: string) {
      const id = providerId(raw)
      if (!id) {
        notice = 'That connector does not use a remote sign-in.'
        return view()
      }
      if (id === 'google' && (raw === 'alarms' || raw === 'files')) {
        notice = 'Alarms and files stay on this computer.'
        return view()
      }
      try {
        const { endpoints, base } = await endpointsFor(id)
        const current = await cloud()
        if (base) current.setApiBase(base)
        await current.connect(endpoints, features(raw === 'google' ? 'gmail' : raw))
        notice = null
      } catch (error) {
        notice = (error as Error).message
      }
      return view()
    },
    async showOutbox() {
      const { endpoints, base } = await endpointsFor('google')
      const current = await cloud()
      if (base) current.setApiBase(base)
      if (!current.token('google')) await current.connect(endpoints, ['gmail'])
      const when = Date.parse('2026-10-11T09:00:00.000Z')
      if (!current.outbox().some((item) => item.id === 'sched-demo')) {
        await current.queueSend({
          id: 'sched-demo',
          provider: 'google',
          to: 'ada@harbor.example',
          subject: 'Re: Berth tonight',
          body: 'The berth is North.',
          runAt: when,
        }, Date.now())
        await current.approve('sched-demo', Date.now())
      }
      notice = 'Approved send is stored on this computer. It goes out at the scheduled time, or when you are back online.'
      return view()
    },
    async showInvoice() {
      const draft = draftInvoice('gst-india', [{ label: 'Berth fee', cents: 100_000 }], 2026, 6)
      const pdf = await invoicePdf(draft)
      invoice = { number: draft.number, template: draft.template, total: (draft.totalCents / 100).toFixed(2), pdfBytes: pdf.length }
      const when = Date.parse('2026-10-11T09:00:00.000Z')
      const { endpoints, base } = await endpointsFor('google')
      const current = await cloud()
      if (base) current.setApiBase(base)
      if (!current.token('google')) await current.connect(endpoints, ['gmail'])
      if (!current.outbox().some((item) => item.id === 'inv-demo')) {
        await current.queueSend({
          id: 'inv-demo',
          provider: 'google',
          to: 'ada@harbor.example',
          subject: draft.number,
          body: 'Invoice attached.',
          attachment: { filename: `${draft.number}.pdf`, mime: 'application/pdf', base64: pdf.toString('base64') },
          runAt: when,
        }, Date.now())
      }
      notice = 'The PDF is ready. Sending it still needs Approve.'
      return view()
    },
  }
}
