









export function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}



const registry = new FinalizationRegistry<() => void>((cb) => {
    try {
        cb();
    } catch {}
});

export function createGarbageCollectPromise<T extends object>(
  object: T,
): Promise<void> {
  const { promise, resolve } = promiseWithResolvers<void>();
  registry.register(object, resolve);
  return promise
}

export function	serialize(obj: unknown): string {
    const allKeys = new Set();
    JSON.stringify(obj, (key, value) => (allKeys.add(key), value));
    return JSON.stringify(obj, Array.from(allKeys).sort() as (string | number)[]);
}