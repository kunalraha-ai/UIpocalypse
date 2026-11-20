export interface User {
  email: string;
  /** SHA-256 hash of `<salt>:<password>` */
  passwordHash: string;
  salt: string;
  createdAt: string;
}

/** Completion dates are stored as local-time `YYYY-MM-DD` strings. */
export interface Habit {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  completions: string[];
}
