import { useEffect, useState } from 'react';

export function usePersistentState<T>(
  key: string,
  initialValue: T,
  options?: {
    deserialize?: (value: string) => T;
    serialize?: (value: T) => string;
  },
) {
  const deserialize = options?.deserialize ?? ((value: string) => value as T);
  const serialize = options?.serialize ?? ((value: T) => String(value));

  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    const stored = window.localStorage.getItem(key);
    if (stored === null) return initialValue;
    try {
      return deserialize(stored);
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, serialize(state));
  }, [key, serialize, state]);

  return [state, setState] as const;
}
