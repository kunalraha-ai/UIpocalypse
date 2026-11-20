function formatWhen(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

function snippet(body) {
  const text = (body ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return 'No content'
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

export default function NoteList({
  notes,
  totalCount,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  onNew,
  loading,
  error,
  onRetry,
}) {
  const hasQuery = query.trim().length > 0
  const noteWord = totalCount === 1 ? 'note' : 'notes'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b border-slate-200 p-4">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          <span className="text-base leading-none" aria-hidden="true">+</span>
          New note
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error ? (
          <div className="m-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <p>Failed to load notes: {error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 font-medium underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <p className="p-4 text-center text-sm text-slate-400">Loading notes…</p>
        ) : notes.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">
            <div className="mb-2 text-3xl" aria-hidden="true">🗒️</div>
            {hasQuery ? (
              <p>No notes match “{query.trim()}”.</p>
            ) : (
              <p>No notes yet. Click “New note” to create your first one.</p>
            )}
          </div>
        ) : (
          <ul className="space-y-1">
            {notes.map((note) => {
              const active = note.id === selectedId
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(note.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      active ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-100'
                    }`}
                  >
                    <span className="block truncate font-medium text-slate-900">
                      {note.title || 'Untitled'}
                    </span>
                    <span className="block truncate text-sm text-slate-500">{snippet(note.body)}</span>
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {formatWhen(note.updated_at)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 px-4 py-2 text-xs text-slate-400">
        {hasQuery ? `${notes.length} of ${totalCount} ${noteWord}` : `${totalCount} ${noteWord}`}
      </div>
    </div>
  )
}
