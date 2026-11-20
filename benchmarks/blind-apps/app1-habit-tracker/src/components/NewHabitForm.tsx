import { useState, type FormEvent } from "react";

interface Props {
  onCreate: (name: string, description: string) => void;
  onCancel: () => void;
}

export default function NewHabitForm({ onCreate, onCancel }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give your habit a name.");
      return;
    }
    onCreate(name, description);
  }

  return (
    <form className="new-habit card" onSubmit={handleSubmit}>
      <h2 className="new-habit__title">New habit</h2>
      <div className="field">
        <label htmlFor="habit-name">Name</label>
        <input
          id="habit-name"
          type="text"
          placeholder="e.g. Read for 20 minutes"
          value={name}
          maxLength={60}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="habit-desc">Description (optional)</label>
        <textarea
          id="habit-desc"
          placeholder="What does success look like?"
          value={description}
          maxLength={280}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          Create habit
        </button>
      </div>
    </form>
  );
}
