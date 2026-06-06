import type { Data } from "../CoreApiTypes/ClientRule";
import type { Descriptor, Subscribe } from "../CoreApiTypes/Resolver";
import { DependencyGraph } from "./DepsTracking/Graph";

import {
  createGarbageCollectPromise,
  promiseWithResolvers,
  serialize,
} from "./utils";


export type DepsDescriptor<T extends object, DATA extends Data> = Descriptor<T> & {
  onData(data: Data): DepsDescriptor<T, DATA>;
  fetchData(fetch: () => Promise<DATA>): void;
  graph: DependencyGraph<DepsDescriptor<object, Data>>;
  invalidate(): void;
};

export const unAssigned = Symbol("unAssigned");

const refs = new WeakMap<object, object>();

class Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: any) => void;

  constructor() {
    const { promise, resolve, reject } = promiseWithResolvers<T>();

    this.promise = promise;
    this.resolve = resolve;
    this.reject = reject;
  }
}

class DataState<DATA extends Data> {
  private value: DATA | typeof unAssigned = unAssigned;

  pending(): boolean {
    return this.value === unAssigned;
  }

  assign(data: DATA): void {
    if (!this.pending()) {
      throw Error("already assigned");
    }

    this.value = data;
  }

  similar(other: DATA): boolean {
    if (this.pending()) {
      throw Error("pending");
    }

    const current = this.value;

    if (current instanceof Object && other instanceof Object) {
      if ("equals" in current && "equals" in other) {
        return current.equals(other);
      }

      return serialize(current) === serialize(other);
    }

    return current === other;
  }
}



class Invalidatable {
  private invalidated = false;

  private subscribers = new Set<() => void>();

  invalidate(): boolean {
    if (this.invalidated) {
      return false;
    }

    this.invalidated = true;

    for (const subscriber of this.subscribers) {
      try {
        subscriber();
      } catch {}
    }
    this.subscribers.clear();
    return true;
  }

  subscribe: Subscribe = callback => {
    this.subscribers.add(callback);

    return () => {
      this.subscribers.delete(callback);
    };
  };
}

export class DescriptorImpl<T extends object, DATA extends Data> implements DepsDescriptor<T, DATA> {

  private readonly result = new Deferred<T>();
  private readonly state = new DataState<DATA>();
  public readonly graph: DependencyGraph<DepsDescriptor<object, Data>> = new DependencyGraph<DepsDescriptor<object, Data>>(this);
  private readonly invalidation = new Invalidatable();
  readonly resPromise = this.result.promise;
  readonly garbageCollected: Promise<void>;

  onInvalidate = this.invalidation.subscribe;

  constructor(
    private readonly build: (data: DATA) => Promise<T>
  ) {
    this.garbageCollected = createGarbageCollectPromise(this);
  }

  private buildResult(data: DATA): void {
    this.build(data)
      .then(result => {
        refs.set(result, this);
        this.result.resolve(result);
      })
      .catch(error => {
        this.result.reject(error);
        this.invalidate();
      });
  }

  onData(data: DATA): DescriptorImpl<T, DATA> {
    if (this.state.pending()) {
      this.state.assign(data);
      this.buildResult(data);

      return this;
    }

    if (this.state.similar(data)) {
      return this;
    }

    this.invalidate();

    return new DescriptorImpl(this.build).onData(data);
  }

  fetchData(fetch: () => Promise<DATA>): void {
    if (!this.state.pending()) {
      return;
    }

    fetch()
      .then(data => this.onData(data))
      .catch(error => {
        if (!this.state.pending()) {
          return;
        }

        this.result.reject(error);
        this.invalidate();
      });
  }

  invalidate = (): void => {
    const shouldRun = this.invalidation.invalidate();
    if (!shouldRun) {
      return;
    }
    this.graph.dependents.forEach(dependent => dependent.node.invalidate());
    this.graph.clear();
  };
}