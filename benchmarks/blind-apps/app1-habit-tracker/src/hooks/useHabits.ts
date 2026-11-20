import { useCallback, useEffect, useState } from "react";
import type { Habit } from "../types";
import { loadHabits, saveHabits } from "../lib/storage";
import { today } from "../lib/dates";

export function useHabits(email: string | null) {
  const [habits, setHabits] = useState<Habit[]>([]);

  useEffect(() => {
    setHabits(email ? loadHabits(email) : []);
  }, [email]);

  const update = useCallback(
    (next: Habit[]) => {
      setHabits(next);
      if (email) saveHabits(email, next);
    },
    [email],
  );

  const addHabit = useCallback(
    (name: string, description: string) => {
      const habit: Habit = {
        id: crypto.randomUUID(),
        name: name.trim(),
        description: description.trim(),
        createdAt: new Date().toISOString(),
        completions: [],
      };
      update([...habits, habit]);
    },
    [habits, update],
  );

  /** Toggle today's completion for one habit. */
  const toggleToday = useCallback(
    (id: string) => {
      const day = today();
      update(
        habits.map((h) =>
          h.id === id
            ? {
                ...h,
                completions: h.completions.includes(day)
                  ? h.completions.filter((d) => d !== day)
                  : [...h.completions, day],
              }
            : h,
        ),
      );
    },
    [habits, update],
  );

  const removeHabit = useCallback(
    (id: string) => {
      update(habits.filter((h) => h.id !== id));
    },
    [habits, update],
  );

  return { habits, addHabit, toggleToday, removeHabit };
}
