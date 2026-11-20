import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useNotes(user) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('notes')
      .select('*')
      .order('updated_at', { ascending: false })
    if (fetchError) {
      setError(fetchError.message)
    } else {
      setNotes(data ?? [])
      setError(null)
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createNote = useCallback(
    async ({ title, body }) => {
      const { data, error: insertError } = await supabase
        .from('notes')
        .insert({ user_id: user.id, title, body })
        .select()
        .single()
      if (!insertError) await refresh()
      return { data, error: insertError }
    },
    [user, refresh]
  )

  const updateNote = useCallback(
    async (id, { title, body }) => {
      const { data, error: updateError } = await supabase
        .from('notes')
        .update({ title, body, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (!updateError) await refresh()
      return { data, error: updateError }
    },
    [refresh]
  )

  const deleteNote = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from('notes').delete().eq('id', id)
      if (!deleteError) await refresh()
      return { error: deleteError }
    },
    [refresh]
  )

  return { notes, loading, error, refresh, createNote, updateNote, deleteNote }
}
