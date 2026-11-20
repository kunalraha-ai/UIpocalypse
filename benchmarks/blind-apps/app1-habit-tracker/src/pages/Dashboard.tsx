import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useHabits } from "../hooks/useHabits";
import { computeStreak, isDoneToday } from "../lib/streak";
import HabitCard from "../components/HabitCard";
import NewHabitForm from "../components/NewHabitForm";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { habits, addHabit, toggleToday, removeHabit } = useHabits(user);
  const [showForm, setShowForm] = useState(false);

  const stats = useMemo(() => {
    const doneTodayCount = habits.filter((h) => isDoneToday(h.completions)).length;
    const topStreak = habits.reduce(
      (max, h) => Math.max(max, computeStreak(h.completions)),
      0,
    );
    const totalCompletions = habits.reduce((sum, h) => sum + h.completions.length, 0);
    return { doneTodayCount, topStreak, totalCompletions };
  }, [habits]);

  if (!user) return <Navigate to="/login" replace />;

  function handleLogout() {
    logout();
    navigate("/login");
  }

  function handleDelete(id: string) {
    const habit = habits.find((h) => h.id === id);
    if (
      habit &&
      window.confirm(`Delete "${habit.name}" and its whole history? This cannot be undone.`)
    ) {
      removeHabit(id);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
            <defs>
              <linearGradient id="flame3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffb347" />
                <stop offset="1" stopColor="#ff5e3a" />
              </linearGradient>
            </defs>
            <path
              fill="url(#flame3)"
              d="M32 4c3 8-6 12-6 20 0 4 3 7 7 7 3 0 5-2 5-5 4 3 6 8 6 12 0 10-8 18-18 18S8 48 8 38C8 24 22 16 24 8c4 2 5 6 5 6 1-4 2-7 3-10z"
            />
          </svg>
          <span>Ember</span>
        </div>
        <div className="topbar__right">
          <span className="user-chip" title={user}>
            {user}
          </span>
          <button type="button" className="btn btn-ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="dashboard">
        <div className="dashboard__head">
          <div>
            <h1>Your habits</h1>
            <p className="dashboard__sub">
              {habits.length === 0
                ? "Start by creating your first habit."
                : `${stats.doneTodayCount} of ${habits.length} done today · ${stats.totalCompletions} completions all-time`}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowForm((s) => !s)}
          >
            {showForm ? "Close" : "+ New habit"}
          </button>
        </div>

        <div className="stat-row">
          <div className="card stat">
            <span className="stat__value">{habits.length}</span>
            <span className="stat__label">Habits tracked</span>
          </div>
          <div className="card stat">
            <span className="stat__value stat__value--hot">🔥 {stats.topStreak}</span>
            <span className="stat__label">Longest current streak</span>
          </div>
          <div className="card stat">
            <span className="stat__value stat__value--green">{stats.doneTodayCount}</span>
            <span className="stat__label">Done today</span>
          </div>
          <div className="card stat">
            <span className="stat__value">{stats.totalCompletions}</span>
            <span className="stat__label">Total completions</span>
          </div>
        </div>

        {showForm && (
          <NewHabitForm
            onCreate={(name, desc) => {
              addHabit(name, desc);
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {habits.length === 0 && !showForm ? (
          <div className="card empty-state">
            <span className="empty-state__icon" aria-hidden="true">
              🔥
            </span>
            <h2>No habits yet</h2>
            <p>
              Create your first habit and start building a streak. Small steps,
              every day.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowForm(true)}
            >
              Create a habit
            </button>
          </div>
        ) : (
          <section className="habit-grid">
            {habits.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                onToggleToday={toggleToday}
                onDelete={handleDelete}
              />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
