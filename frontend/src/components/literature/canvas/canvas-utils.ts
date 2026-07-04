// Debounce: trailing-edge call. The wrapped function is invoked at most once
// per `wait` ms, with the most recent arguments.
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  wait: number
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: TArgs) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

// Generate a short client-side id for ephemeral UI (not used for backend writes).
export function newId(): string {
  return `tmp_${Math.random().toString(36).slice(2, 10)}`;
}
