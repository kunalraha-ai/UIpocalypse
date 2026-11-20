import type { Habit } from "../types";
import { today, lastNDays, weekdayLabel } from "../lib/dates";
import { computeStreak, bestStreak, isDoneToday } from "../lib/streak";

interface Props {
  habit: Habit;
  onToggleToday: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function HabitCard({ habit, onToggleToday, onDelete }: Props) {
  const doneToday = isDoneToday(habit.completions);
  const streak = computeStreak(habit.completions);
  const best = bestStreak(habit.completions);
  const done = new Set(habit.completions);
  const days = lastNDays(7);

  return (
    <article className={`habit-card ${doneToday ? "habit-card--done" : ""}`}>
      <header className="habit-card__top">
        <h3 className="habit-card__name">{habit.name}</h3>
        <button
          type="button"
          className="icon-btn"
          title="Delete habit"
          aria-label={`Delete ${habit.name}`}
          onClick={() => onDelete(habit.id)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      {habit.description && (
        <p className="habit-card__desc">{habit.description}</p>
      )}

      <div className="habit-card__dots" aria-hidden="true">
        {days.map((d) => (
          <span
            key={d}
            className={`dot ${done.has(d) ? "dot--on" : ""} ${
              d === today() ? "dot--today" : ""
            }`}
            title={d}
          >
            {weekdayLabel(d)}
          </span>
        ))}
      </div>

      <footer className="habit-card__bottom">
        <span
          className={`streak-badge ${streak > 0 ? "streak-badge--hot" : ""}`}
          title={`Best streak: ${best} day${best === 1 ? "" : "s"}`}
        >
          🔥 {streak} day{streak === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          className={`btn ${doneToday ? "btn-success" : "btn-primary"}`}
          onClick={() => onToggleToday(habit.id)}
        >
          {doneToday ? (
            <>
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path
                  d="M4.5 12.5l5 5 10-11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Done today
            </>
          ) : (
            "Mark done today"
          )}
        </button>
      </footer>
    </article>
  );
}
