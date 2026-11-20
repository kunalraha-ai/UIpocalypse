import { useAuth } from './context/AuthContext'
import AuthScreen from './components/AuthScreen'
import NotesApp from './components/NotesApp'

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      </div>
    )
  }

  return user ? <NotesApp /> : <AuthScreen />
}
