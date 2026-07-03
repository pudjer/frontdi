

type Unsubscribe = () => void
type Subscriber = () => void
export type Subscribe = (subscriber: Subscriber) => Unsubscribe

export interface Descriptor<T extends object> {
  resPromise: Promise<T>;
  res: T | undefined;
  error: unknown;
  isPending: boolean;
  invalidatedPromise: Promise<T>;
  invalidated: boolean;
  onInvalidate: Subscribe;
  invalidate(): void;
}

export class DependencyCycleError extends Error {
  constructor(public readonly cycle: Array<unknown>) { super(`Cycle detected`); }
}
export class SelfReferenceError extends DependencyCycleError {
  constructor(public readonly node: unknown) { super([node]); }
}
