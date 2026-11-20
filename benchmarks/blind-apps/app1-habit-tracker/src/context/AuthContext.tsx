import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearSession,
  getUser,
  getSessionEmail,
  hashPassword,
  newSalt,
  saveUser,
  setSession,
} from "../lib/storage";

interface AuthContextValue {
  /** Email of the logged-in user, or null. */
  user: string | null;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(() => getSessionEmail());

  const signup = useCallback(async (email: string, password: string) => {
    const normalized = email.trim().toLowerCase();
    if (!validateEmail(normalized)) {
      throw new Error("Please enter a valid email address.");
    }
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }
    if (getUser(normalized)) {
      throw new Error("An account with this email already exists.");
    }
    const salt = newSalt();
    const passwordHash = await hashPassword(password, salt);
    saveUser({
      email: normalized,
      salt,
      passwordHash,
      createdAt: new Date().toISOString(),
    });
    setSession(normalized);
    setUser(normalized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const normalized = email.trim().toLowerCase();
    const record = getUser(normalized);
    if (!record) {
      throw new Error("Invalid email or password.");
    }
    const passwordHash = await hashPassword(password, record.salt);
    if (passwordHash !== record.passwordHash) {
      throw new Error("Invalid email or password.");
    }
    setSession(normalized);
    setUser(normalized);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, signup, login, logout }),
    [user, signup, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
