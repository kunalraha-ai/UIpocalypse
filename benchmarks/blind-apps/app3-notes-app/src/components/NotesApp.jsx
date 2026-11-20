import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNotes } from '../hooks/useNotes'
import NoteEditor from './NoteEditor'
import NoteList from './NoteList'

// Placeholder for a note that is being created and has not been saved yet.
const NEW_NOTE = { id: 'new', title: '', body: '', updated_at: null }

export default function NotesApp() {
  const { user, signOut } = useAuth()
  const { notes, loading, error, refresh, createNote, updateNote, deleteNote } = useNotes(user)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  // Search across both the title and the body of every note.
  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(
      (note) => note.title.toLowerCase().includes(q) || note.body.toLowerCase().includes(q)
    )
  }, [notes, query])

  const selectedNote = useMemo(() => {
    if (selectedId === 'new') return NEW_NOTE
    if (selectedId) return notes.find((note) => note.id === selectedId) ?? null
    return null
  }, [selectedId, notes])

  async function handleSave(title, body) {
    if (!selectedNote) return null
    if (selectedNote.id === 'new') {
      const { data, error: saveError } = await createNote({ title, body })
      if (!saveError && data) setSelectedId(data.id)
      return saveError
    }
    const { error: saveError } = await updateNote(selectedNote.id, { title, body })
    return saveError
  }

  async function handleDelete() {
    if (!selectedNote) return null
    if (selectedNote.id === 'new') {
      setSelectedId(null)
      return null
    }
    const { error: deleteError } = await deleteNote(selectedNote.id)
    if (!deleteError) setSelectedId(null)
    return deleteError
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden="true">📝</span>
          <span className="text-lg font-semibold tracking-tight text-slate-900">Notes</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-64 truncate text-sm text-slate-500 sm:block">{user?.email}</span>
          <button
            type="button"
            onClick={() => signOut()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* On small screens the list and the editor alternate; on md+ both show. */}
        <aside
          className={`${
            selectedNote ? 'hidden md:flex' : 'flex'
          } w-full shrink-0 flex-col border-r border-slate-200 bg-white md:w-80`}
        >
          <NoteList
            notes={filteredNotes}
            totalCount={notes.length}
            query={query}
            onQueryChange={setQuery}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={() => setSelectedId('new')}
            loading={loading}
            error={error}
            onRetry={refresh}
          />
        </aside>

        <main className={`${selectedNote ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
          {selectedNote ? (
            <NoteEditor
              key={selectedNote.id}
              note={selectedNote}
              onSave={handleSave}
              onDelete={handleDelete}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="text-5xl" aria-hidden="true">🗒️</span>
              <p className="text-slate-500">Select a note or create a new one.</p>
              <button
                type="button"
                onClick={() => setSelectedId('new')}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
              >
                New note
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
