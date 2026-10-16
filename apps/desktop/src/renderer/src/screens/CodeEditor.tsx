/**
 * Built-in code editor. Ghost text is a decoration, not a document change, until Tab or Ctrl/Cmd+Right.
 * Accepting inserts into the buffer. Saving is a separate button. Completions never write the file.
 */
import { useEffect, useRef, useState } from 'react'
import { acceptAll, acceptWord } from '../../../shared/completion-edit'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Annotation, EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, drawSelection, keymap, lineNumbers } from '@codemirror/view'

const setGhost = StateEffect.define<{ pos: number; text: string } | null>()
const accepting = Annotation.define<boolean>()

class GhostText extends WidgetType {
  constructor(readonly text: string) { super() }
  eq(other: WidgetType): boolean { return other instanceof GhostText && other.text === this.text }
  ignoreEvent(): boolean { return true }
  toDOM(): HTMLElement {
    const node = document.createElement('span')
    node.className = 'cm-ghost'
    node.setAttribute('data-code-ghost', 'yes')
    node.textContent = this.text
    return node
  }
}

const ghostField = StateField.define<{ pos: number; text: string } | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setGhost)) return effect.value
    if (tr.annotation(accepting)) return value
    if (tr.docChanged || tr.selection) return null
    return value
  },
  provide: (field) => EditorView.decorations.from(field, (ghost) => {
    if (!ghost?.text) return Decoration.none
    return Decoration.set([
      Decoration.widget({ widget: new GhostText(ghost.text), side: 1 }).range(ghost.pos),
    ])
  }),
})

function languageSupport(language: string) {
  if (language === 'python') return python()
  if (language === 'javascript' || language === 'typescript' || language === 'tsx') {
    return javascript({ typescript: language !== 'javascript', jsx: language !== 'typescript' })
  }
  return []
}

export function CodeEditor({ enabled, languagesOff }: { enabled: boolean; languagesOff: string[] }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const enabledRef = useRef(enabled)
  const offRef = useRef(languagesOff)
  const saved = useRef('')
  const [files, setFiles] = useState<{ path: string; language: string }[]>([])
  const [path, setPath] = useState('')
  const [language, setLanguage] = useState('plaintext')
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState('')
  enabledRef.current = enabled
  offRef.current = languagesOff

  useEffect(() => {
    void window.surf.codeComplete.files().then(setFiles).catch((error: unknown) => setNote((error as Error).message))
  }, [])

  useEffect(() => {
    const parent = host.current
    if (!parent || !path) return
    let dead = false
    let seq = 0
    const sessionId = `editor-${path}`
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: saved.current,
        extensions: [
          lineNumbers(),
          drawSelection(),
          history(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          languageSupport(language),
          ghostField,
          Prec.highest(keymap.of([
            { key: 'Tab', run: (current) => applyGhost(current, 'all') },
            { key: 'Escape', run: dismissGhost },
            { key: 'Mod-ArrowRight', run: (current) => applyGhost(current, 'word') },
            { key: 'Ctrl-ArrowRight', run: (current) => applyGhost(current, 'word') },
          ])),
          keymap.of([...defaultKeymap, indentWithTab, ...historyKeymap]),
          EditorView.theme({
            '&': { height: '100%', background: 'var(--bg)', color: 'var(--ink)', fontSize: '13px' },
            '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.45' },
            '.cm-gutters': { background: 'var(--bg-elev)', color: 'var(--muted)', border: 'none' },
            '.cm-ghost': { color: 'var(--muted)', opacity: '0.55' },
            '.cm-content': { caretColor: 'var(--ink)' },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setDirty(update.state.doc.toString() !== saved.current)
            if (update.transactions.some((tr) => tr.annotation(accepting))) return
            if (!update.docChanged && !update.selectionSet) return
            void requestGhost(update.view)
          }),
        ],
      }),
    })
    viewRef.current = view
    void requestGhost(view)
    return () => {
      dead = true
      seq += 1
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
    }

    function applyGhost(current: EditorView, kind: 'all' | 'word'): boolean {
      const ghost = current.state.field(ghostField)
      if (!ghost?.text) return false
      const cursor = current.state.selection.main.head
      if (cursor !== ghost.pos) return false
      const doc = current.state.doc.toString()
      const applied = kind === 'word' ? acceptWord(doc, cursor, ghost.text) : { ...acceptAll(doc, cursor, ghost.text), rest: '' }
      const insert = applied.text.slice(cursor, applied.cursor)
      current.dispatch({
        changes: { from: cursor, insert },
        selection: { anchor: applied.cursor },
        effects: setGhost.of(applied.rest ? { pos: applied.cursor, text: applied.rest } : null),
        annotations: accepting.of(true),
      })
      setDirty(current.state.doc.toString() !== saved.current)
      return true
    }

    function dismissGhost(current: EditorView): boolean {
      if (!current.state.field(ghostField)) return false
      current.dispatch({ effects: setGhost.of(null) })
      return true
    }

    async function requestGhost(current: EditorView): Promise<void> {
      const id = ++seq
      const lang = language
      if (!enabledRef.current) return
      if (offRef.current.some((item) => item.toLowerCase() === lang.toLowerCase())) return
      if (!current.state.selection.main.empty) {
        current.dispatch({ effects: setGhost.of(null) })
        return
      }
      const cursor = current.state.selection.main.head
      const text = current.state.doc.toString()
      try {
        const result = await window.surf.codeComplete.suggest({ sessionId, path, language: lang, text, cursor })
        if (dead || id !== seq) return
        const head = current.state.selection.main.head
        if (head !== cursor || !result.text) {
          current.dispatch({ effects: setGhost.of(null) })
          return
        }
        current.dispatch({ effects: setGhost.of({ pos: head, text: result.text }) })
      } catch {
        if (!dead && id === seq) current.dispatch({ effects: setGhost.of(null) })
      }
    }
  }, [path, language])

  async function openFile(next: string) {
    setNote('')
    if (!next) {
      setPath('')
      return
    }
    try {
      const file = await window.surf.codeComplete.read(next)
      saved.current = file.text
      setLanguage(file.language)
      setPath(file.path)
      setDirty(false)
    } catch (error) {
      setNote((error as Error).message)
    }
  }

  async function save() {
    const view = viewRef.current
    if (!view || !path) return
    try {
      const text = view.state.doc.toString()
      const savedFile = await window.surf.codeComplete.save(path, text)
      saved.current = text
      setPath(savedFile.path)
      setDirty(false)
      setNote('Saved')
    } catch (error) {
      setNote((error as Error).message)
    }
  }

  const suggestions = enabled && !languagesOff.some((item) => item.toLowerCase() === language.toLowerCase())
  return (
    <div className="border-b border-[var(--line)]" data-code-editor="yes">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <select className="field w-auto max-w-xs py-1" aria-label="Project file" value={path} onChange={(event) => { void openFile(event.target.value) }}>
          <option value="">Open a file</option>
          {files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
        </select>
        <button type="button" className="btn btn-ghost" data-code-save="yes" disabled={!path || !dirty} onClick={() => { void save() }}>Save</button>
        <span className="text-xs text-[var(--muted)]" data-code-suggest={suggestions ? 'on' : 'off'}>
          {suggestions ? 'Tab accepts · Esc dismisses · Ctrl/Cmd+Right accepts a word' : 'Tab suggestions are off for this file'}
        </span>
        {note && <span className="text-xs text-[var(--muted)]">{note}</span>}
      </div>
      <div ref={host} className="h-64" data-code-editor-host="yes" />
    </div>
  )
}
