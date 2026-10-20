/**
 * IDE Code Editor - Integrates with the IDE tab system
 * Supports syntax highlighting, AI completions, and file editing
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { acceptAll, acceptWord } from '../../../shared/completion-edit'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Annotation, EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, drawSelection, keymap, lineNumbers } from '@codemirror/view'
import { Save, CheckCircle2 } from 'lucide-react'

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
  if (language === 'javascript' || language === 'typescript' || language === 'tsx' || language === 'jsx') {
    return javascript({ typescript: language === 'typescript' || language === 'tsx', jsx: language === 'jsx' || language === 'tsx' })
  }
  return []
}

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    py: 'python',
    python: 'python',
  }
  return langMap[ext] || 'plaintext'
}

interface IDECodeEditorProps {
  path: string
  content: string
  onContentChange: (content: string) => void
  onSave: () => void
  enabled?: boolean
  languagesOff?: string[]
}

export function IDECodeEditor({
  path,
  content,
  onContentChange,
  onSave,
  enabled = true,
  languagesOff = [],
}: IDECodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const enabledRef = useRef(enabled)
  const offRef = useRef(languagesOff)
  const savedContentRef = useRef(content)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  enabledRef.current = enabled
  offRef.current = languagesOff
  const language = getLanguageFromPath(path)

  // Update saved content when prop changes
  useEffect(() => {
    savedContentRef.current = content
  }, [content])

  const applyGhost = useCallback((current: EditorView, kind: 'all' | 'word'): boolean => {
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
    setDirty(current.state.doc.toString() !== savedContentRef.current)
    return true
  }, [])

  const dismissGhost = useCallback((current: EditorView): boolean => {
    if (!current.state.field(ghostField)) return false
    current.dispatch({ effects: setGhost.of(null) })
    return true
  }, [])

  useEffect(() => {
    const parent = hostRef.current
    if (!parent || !path) return

    let dead = false
    let seq = 0
    const sessionId = `ide-editor-${path}`

    // Destroy existing view
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
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

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: content,
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
            { key: 'Mod-s', run: () => { onSave(); return true } },
            { key: 'Ctrl-s', run: () => { onSave(); return true } },
          ])),
          keymap.of([...defaultKeymap, indentWithTab, ...historyKeymap]),
          EditorView.theme({
            '&': { height: '100%', background: 'var(--bg)', color: 'var(--ink)', fontSize: '13px' },
            '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.5' },
            '.cm-gutters': { background: 'var(--bg-elev)', color: 'var(--muted)', border: 'none' },
            '.cm-ghost': { color: 'var(--muted)', opacity: '0.55', fontStyle: 'italic' },
            '.cm-content': { caretColor: 'var(--ink)', padding: '8px 0' },
            '.cm-cursor': { borderLeftColor: 'var(--accent)' },
            '.cm-activeLine': { background: 'color-mix(in srgb, var(--accent) 4%, transparent)' },
            '.cm-selectionBackground': { background: 'color-mix(in srgb, var(--accent) 20%, transparent)' },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newText = update.state.doc.toString()
              onContentChange(newText)
              setDirty(newText !== savedContentRef.current)
              setSaved(false)
            }
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
  }, [path, language])

  const suggestions = enabled && !languagesOff.some((item) => item.toLowerCase() === language.toLowerCase())

  return (
    <div className="flex h-full flex-col" data-ide-code-editor="yes">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg-elev)] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted)]">
            {path.split(/[/\\]/).pop()}
          </span>
          {dirty && <span className="text-xs text-[var(--accent)]">●</span>}
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 size={12} /> Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted)]">
            {suggestions ? 'Tab: accept · Esc: dismiss' : 'Suggestions off'}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--bg-hover)]"
            disabled={!dirty}
            onClick={() => { onSave(); setSaved(true); setTimeout(() => setSaved(false), 2000) }}
            title="Save (Ctrl+S)"
          >
            <Save size={12} /> Save
          </button>
        </div>
      </div>
      {/* Editor host */}
      <div ref={hostRef} className="flex-1 overflow-auto" data-code-editor-host="yes" />
    </div>
  )
}
