import { Extension } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { yCursorPlugin } from '@tiptap/y-tiptap'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'

function renderCaret(user: { name?: string; color?: string }) {
  const color = /^#[0-9a-f]{6}$/i.test(user.color ?? '') ? user.color! : '#4f46e5'
  const caret = document.createElement('span')
  caret.classList.add('collaboration-carets__caret')
  caret.style.borderColor = color
  const label = document.createElement('div')
  label.classList.add('collaboration-carets__label')
  label.style.backgroundColor = color
  label.textContent = user.name ?? ''
  caret.append(label)
  return caret
}

/**
 * Remote cursors for one field. Each field uses its own awareness key, so several editors bound
 * to the same document don't overwrite each other's cursor positions.
 */
const FieldCaret = Extension.create<{ provider: HocuspocusProvider | null; field: string }>({
  name: 'fieldCaret',
  addOptions() {
    return { provider: null, field: 'default' }
  },
  addProseMirrorPlugins() {
    const awareness = this.options.provider?.awareness
    if (!awareness) return []
    return [
      yCursorPlugin(
        awareness,
        {
          cursorBuilder: renderCaret,
          selectionBuilder: (u: any) => ({ style: `background-color: ${u.color}33`, class: 'collaboration-carets__selection' }),
        },
        `cursor:${this.options.field}`,
      ),
    ]
  },
})

interface Props {
  fragment: Y.XmlFragment
  provider: HocuspocusProvider
  field: string
  label: string
  placeholder?: string
}

/** A rich-text editor bound to one shared field. Edits merge character-by-character (CRDT). */
export function FieldEditor({ fragment, provider, field, label, placeholder }: Props) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false, // Collaboration brings its own per-user undo.
          heading: false,
          codeBlock: false,
          code: false,
          blockquote: false,
          horizontalRule: false,
          link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
        }),
        Collaboration.configure({ fragment }),
        FieldCaret.configure({ provider, field }),
        Placeholder.configure({ placeholder: placeholder ?? '' }),
      ],
      editorProps: { attributes: { 'aria-label': label, 'data-field': field, spellcheck: 'true' } },
      onFocus: () => provider.setAwarenessField('activeField', field),
      onBlur: () => provider.setAwarenessField('activeField', null),
    },
    [fragment, provider, field],
  )
  return <EditorContent editor={editor} />
}
