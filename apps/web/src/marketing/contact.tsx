import { useState, type FormEvent } from 'react'
import { allowSubmit, contactEmail, formKey } from '../site'
import { Faq, Shell } from './shell'

const FAQ = [
  {
    q: 'Can it run with no internet?',
    a: 'Yes, after a model is on the computer. Offline blocks every network call. Chat still works from what is already there.',
  },
  {
    q: 'Where do I get the app?',
    a: 'The home page has the Mac and Windows beta installers, and the Qwen model files.',
  },
  {
    q: 'Who reads this form?',
    a: 'It is mailed to the contact address. This website does not store the message.',
  },
]

export function ContactPage() {
  const email = contactEmail()
  const key = formKey()
  const [notice, setNotice] = useState('')
  const [honeypot, setHoneypot] = useState('')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (honeypot) {
      setNotice('Thanks. Your note is on its way.')
      return
    }
    const last = Number(sessionStorage.getItem('surf-form-at') || '0')
    if (!allowSubmit(Date.now(), last || null)) {
      setNotice('Please wait a moment, then try again.')
      return
    }
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name') || '')
    const from = String(data.get('email') || '')
    const message = String(data.get('message') || '')
    if (!key) {
      window.location.href = `mailto:${email}?subject=${encodeURIComponent('Synap.surf')}&body=${encodeURIComponent(`${name} <${from}>\n\n${message}`)}`
      return
    }
    sessionStorage.setItem('surf-form-at', String(Date.now()))
    const response = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ access_key: key, subject: 'Synap.surf', name, email: from, message, botcheck: honeypot }),
    })
    setNotice(response.ok ? 'Thanks. Your note is on its way.' : 'The form did not send. Use the email link below.')
  }

  return (
    <Shell>
      <div className="mx-auto grid max-w-6xl gap-10 px-6 pb-20 pt-10 md:grid-cols-2" data-page="contact">
        <div>
          <p className="pill">Contact</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">Write to us</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
            Questions about the app, a model, or a licence. The form uses the contact address configured for the site.
          </p>
          <p className="mt-4 text-sm">Email <a href={`mailto:${email}`}>{email}</a></p>
          <Faq items={FAQ} />
        </div>
        <form className="card flex flex-col gap-3 px-5 py-5" data-contact-form="yes" onSubmit={(event) => { void onSubmit(event) }}>
          <label className="text-sm">Name
            <input className="field mt-1" name="name" required autoComplete="name" />
          </label>
          <label className="text-sm">Email
            <input className="field mt-1" name="email" type="email" required autoComplete="email" />
          </label>
          <label className="text-sm">Message
            <textarea className="field mt-1 min-h-32" name="message" required />
          </label>
          <label className="absolute -left-[9999px]" aria-hidden="true">Company
            <input name="company" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
          </label>
          <button className="btn btn-primary" type="submit">Send</button>
          {notice && <p className="text-sm">{notice}</p>}
        </form>
      </div>
    </Shell>
  )
}
