import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler } from "./api";
import { clearToken, getToken, setToken } from "./session";
import type { Me, TokenResponse } from "./types";

interface RegisterInput {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
}

interface AuthContextValue {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
  updateUser: (user: Me) => void; // after the profile is edited
  can: (module: string, action?: "read" | "write") => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  // Global 401 handling: the API client clears the token, we drop the user and guards redirect.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    const controller = new AbortController();
    api
      .get<Me>("/auth/me", { signal: controller.signal })
      .then(setUser)
      .catch(() => undefined) // 401 already cleared the session; network errors leave us signed out
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const startSession = useCallback(async (res: TokenResponse) => {
    setToken(res.access_token);
    setUser(await api.get<Me>("/auth/me"));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      await startSession(await api.post<TokenResponse>("/auth/login", { email, password }));
    },
    [startSession],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      await startSession(await api.post<TokenResponse>("/auth/register", input));
    },
    [startSession],
  );

  const can = useCallback(
    (module: string, action: "read" | "write" = "read") => user?.permissions[module]?.[action] ?? false,
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, register, logout, updateUser: setUser, can }),
    [user, loading, logout, login, register, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
