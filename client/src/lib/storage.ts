// localStorage can throw (private mode, blocked storage); the app must still work without it.

export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const tokenKey = (code: string) => `mc:token:${code}`;
