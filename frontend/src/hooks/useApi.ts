import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

interface Result<T> {
  key: string;
  data: T | null;
  error: ApiError | null;
}

/**
 * GET a path (null = do nothing). Cancels stale requests and keeps the previous data while
 * reloading. `loading` is derived (a result for a different request key means "still loading"),
 * so no state is set synchronously inside the effect.
 */
export function useApi<T>(path: string | null) {
  const [tick, setTick] = useState(0);
  const key = `${path}|${tick}`;
  const [result, setResult] = useState<Result<T>>({ key: "", data: null, error: null });
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    api
      .get<T>(path, { signal: controller.signal })
      .then((data) => setResult({ key, data, error: null }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setResult({ key, data: null, error: err instanceof ApiError ? err : new ApiError(0, "error", "Something went wrong.") });
      });
    return () => controller.abort();
  }, [path, key]);

  const current = result.key === key;
  return {
    data: result.data,
    error: current ? result.error : null,
    loading: path !== null && !current,
    reload,
  };
}
