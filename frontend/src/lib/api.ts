import { s } from "./strings";
import { clearToken, getToken } from "./session";

const BASE_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const API = `${BASE_URL}/api/v1`;

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

let onUnauthorized: (() => void) | null = null;
/** Registered by the auth provider: clears the session and sends the user to sign in. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

interface Options {
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, body?: unknown, opts: Options = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network", s.errors.network);
  }

  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

  const payload = await res.json().catch(() => null);
  const error = payload?.error;
  // A 401 while holding a token means the session is gone. A 401 from /login is just a wrong password.
  if (res.status === 401 && token) {
    clearToken();
    onUnauthorized?.();
  }
  throw new ApiError(res.status, error?.code ?? "error", error?.message ?? s.errors.generic, error?.fields);
}

export const api = {
  get: <T>(path: string, opts?: Options) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: Options) => request<T>("POST", path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: Options) => request<T>("PUT", path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: Options) => request<T>("PATCH", path, body, opts),
  delete: <T>(path: string, opts?: Options) => request<T>("DELETE", path, undefined, opts),
};
