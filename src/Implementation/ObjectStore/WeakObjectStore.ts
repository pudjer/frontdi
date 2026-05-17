export interface WeakObjectStore<KEY, T extends object> {
  get(key: KEY): T | undefined
  set(key: KEY, value: T): void
  delete(key: KEY): void
}