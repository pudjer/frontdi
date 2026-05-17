export class WeakMapReverse<KEY, T extends object> {
  private store = new Map<KEY, WeakRef<T>>();
  private registry = new FinalizationRegistry<KEY>((key) => {
    // Если WeakRef всё ещё жив (редкая ситуация при повторной регистрации),
    // не удаляем ключ.
    const ref = this.store.get(key);
    if (ref !== undefined && ref.deref() !== undefined) return;
    this.store.delete(key);
  });

  // ---- Базовые методы (уже были) ----
  get(key: KEY): T | undefined {
    return this.store.get(key)?.deref();
  }

  set(key: KEY, value: T): this {
    const ref = new WeakRef(value);
    this.store.set(key, ref);
    this.registry.register(value, key);
    return this;
  }

  delete(key: KEY): boolean {
    return this.store.delete(key);
  }

  // ---- Дополнительные методы интерфейса Map ----
  has(key: KEY): boolean {
    const ref = this.store.get(key);
    return ref !== undefined && ref.deref() !== undefined;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    let count = 0;
    for (const ref of this.store.values()) {
      if (ref.deref() !== undefined) count++;
    }
    return count;
  }

  // Итерация: возвращаем только пары с живыми значениями.
  *[Symbol.iterator](): IterableIterator<[KEY, T]> {
    for (const [key, ref] of this.store) {
      const value = ref.deref();
      if (value !== undefined) yield [key, value];
    }
  }

  *entries(): IterableIterator<[KEY, T]> {
    yield* this;
  }

  *keys(): IterableIterator<KEY> {
    for (const [key, ref] of this.store) {
      if (ref.deref() !== undefined) yield key;
    }
  }

  *values(): IterableIterator<T> {
    for (const ref of this.store.values()) {
      const value = ref.deref();
      if (value !== undefined) yield value;
    }
  }

  forEach(
    callbackfn: (value: T, key: KEY, map: this) => void,
    thisArg?: any
  ): void {
    for (const [key, value] of this) {
      callbackfn.call(thisArg, value, key, this);
    }
  }
}