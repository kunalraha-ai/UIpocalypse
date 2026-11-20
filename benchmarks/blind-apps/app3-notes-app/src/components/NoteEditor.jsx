import { useState } from 'react'

export default function NoteEditor({ note, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(note.title ?? '')
  const [body, setBody] = useState(note.body ?? '')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isNew = note.id === 'new'

  async function save() {
    if (busy) return
    setBusy(true)
    setError(null)
    const saveError = await onSave(title.trim(), body)
    setError(saveError ? saveError?.message ?? 'Failed to save the note.' : null)
    setBusy(false)
  }

  async function remove() {
    if (busy) return
    // First click arms the button, second click actually deletes.
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    setError(null)
    const deleteError = await onDelete()
    if (deleteError) {
      setError(deleteError?.message ?? 'Failed to delete the note.')
      setConfirmDelete(false)
      setBusy(false)
    }
  }

  function handleKeyDown(event) {
    // Ctrl/Cmd + Enter saves the note.
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      save()
    }
  }

  return (
    <div onKeyDown={handleKeyDown} className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:hidden"
        >
          ← Back
        </button>
        <span className="hidden text-xs text-slate-400 md:block">Ctrl/⌘ + Enter to save</span>
        <div className="flex items-center gap-2">
          {!isNew && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                confirmDelete ? 'bg-red-600 text-white hover:bg-red-700' : 'text-red-600 hover:bg-red-50'
              }`}
            >
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
          aria-label="Note title"
          className="w-full border-0 text-2xl font-semibold tracking-tight text-slate-900 placeholder:text-slate-300 focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Start writing…"
          aria-label="Note body"
          className="mt-4 min-h-0 w-full flex-1 resize-none border-0 text-base leading-relaxed text-slate-700 placeholder:text-slate-300 focus:outline-none"
        />
      </div>
    </div>
  )
}
