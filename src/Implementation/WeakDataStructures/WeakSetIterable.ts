export class IterableWeakSet<T extends object> implements WeakSet<T> {
  readonly #weakSet = new WeakSet<T>();
  readonly #refSet = new Set<WeakRef<T>>();
  readonly #registry: FinalizationRegistry<{ ref: WeakRef<T>; set: Set<WeakRef<T>> }>;

  constructor(iterable?: Iterable<T> | null) {
    this.#registry = new FinalizationRegistry(({ ref, set }) => {
      set.delete(ref);
    });

    if (iterable) {
      for (const item of iterable) {
        this.add(item);
      }
    }
  }

  add(value: T): this {
    if (this.#weakSet.has(value)) return this;

    this.#weakSet.add(value);
    const ref = new WeakRef(value);
    this.#refSet.add(ref);

    this.#registry.register(value, { ref, set: this.#refSet }, ref);

    return this;
  }

  delete(value: T): boolean {
    if (!this.#weakSet.has(value)) return false;

    this.#weakSet.delete(value);

    for (const ref of this.#refSet) {
      if (ref.deref() === value) {
        this.#refSet.delete(ref);
        this.#registry.unregister(ref);
        break;
      }
    }

    return true;
  }

  has(value: T): boolean {
    return this.#weakSet.has(value);
  }

  get size(): number {
    this.#cleanup();
    return this.#refSet.size;
  }

  #cleanup(): void {
    for (const ref of this.#refSet) {
      if (!ref.deref()) {
        this.#refSet.delete(ref);
      }
    }
  }

  [Symbol.iterator](): Iterator<T> {
    this.#cleanup();
    const values: T[] = [];
    for (const ref of this.#refSet) {
      const value = ref.deref();
      if (value) values.push(value);
    }
    return values[Symbol.iterator]();
  }

  forEach(
    callbackfn: (value: T, value2: T, set: IterableWeakSet<T>) => void,
    thisArg?: any
  ): void {
    for (const value of this) {
      callbackfn.call(thisArg, value, value, this);
    }
  }

  clear(): void {
    for (const ref of this.#refSet) {
      const value = ref.deref();
      if (value) {
        this.#weakSet.delete(value);
        this.#registry.unregister(ref);
      }
    }
    this.#refSet.clear();
  }

  // Добавляем поддержку toStringTag как у нативного WeakSet
  get [Symbol.toStringTag](): string {
    return 'IterableWeakSet';
  }
}