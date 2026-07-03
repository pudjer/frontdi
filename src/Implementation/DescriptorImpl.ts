import { DependencyCycleError, SelfReferenceError, type Descriptor, type Subscribe } from "../CoreApiTypes/Descriptor";

import {
  promiseWithResolvers,
  serialize,
} from "./utils";
import { IterableWeakSet } from "./WeakDataStructures/WeakSetIterable";




export type DepsDescriptor<T extends object, DATA> = Descriptor<T> & {
  onData(data: DATA): void;
  fetchData(fetch: () => Promise<DATA>): void;
  parents: IterableWeakSet<Descriptor<object>>
  children: Set<Descriptor<object>>
  addChild(child: DepsDescriptor<object, unknown>): void
  checkForCycles(child: DepsDescriptor<object, unknown>): void
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

class DataState<DATA> {
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

    return serialize(current) === serialize(other);
  }
}



class Invalidatable<T extends object> {
  readonly promise: Promise<T>
  private invalidated = false;
  private readonly subscribers = new Set<() => void>();
  private readonly resolve: (value: T | PromiseLike<T>) => void;
  private readonly reject: (reason?: any) => void;
  constructor(private resPromise: Promise<T>) {
    const { promise, resolve, reject } = promiseWithResolvers<T>();
    this.promise = promise;
    this.resolve = resolve;
    this.reject = reject;
  }

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

    this.resPromise.then(this.resolve).catch(this.reject);
    return true;
  }


  readonly subscribe: Subscribe = callback => {
    if (!this.invalidated){
      this.subscribers.add(callback);
    } else {
      callback();
    }
    return () => {
      this.subscribers.delete(callback);
    };
  };
}

export class DescriptorImpl<T extends object, DATA> implements DepsDescriptor<T, DATA> {

  private readonly result = new Deferred<T>();
  private readonly state = new DataState<DATA>();
  readonly resPromise = this.result.promise;

  res: T | undefined;
  error: unknown | undefined;
  isPending: boolean = true;

  invalidated: boolean = false;
  private readonly invalidation = new Invalidatable(this.resPromise);
  readonly invalidatedPromise = this.invalidation.promise;
  readonly onInvalidate = this.invalidation.subscribe;

  readonly parents = new IterableWeakSet<DepsDescriptor<object, unknown>>()
  readonly children = new Set<DepsDescriptor<object, unknown>>()

  constructor(
    private readonly build: (data: DATA) => Promise<T>
  ) {
    this.onInvalidate(() => {
      this.invalidated = true;
    });
  }


  checkForCycles(child: DepsDescriptor<object, unknown>): void {
    if(child === this) {
      throw new SelfReferenceError(this.resPromise);
    }
    for(const parent of this.parents){
      try{
        parent.checkForCycles(child);
      }catch(e){
        if(e instanceof DependencyCycleError){
          const cycle = [...e.cycle];
          cycle.pop();
          cycle.push(this.resPromise);
          cycle.push(child.resPromise);
          throw new DependencyCycleError(cycle);
        }
      }
    }
  }
  addChild(child: DepsDescriptor<object, unknown>): void {
    this.checkForCycles(child);
    this.children.add(child);
    child.parents.add(this);
  }

  private buildResult(data: DATA): void {
    this.build(data)
      .then(result => {
        refs.set(result, this);
        this.result.resolve(result);
        this.res = result;
        this.isPending = false;
      })
      .catch(error => {
        this.result.reject(error);
        this.isPending = false;
        this.error = error;
        this.invalidate();
      });
  }

  onData(data: DATA): void{
    if (this.state.pending()) {
      this.state.assign(data);
      this.buildResult(data);
      return
    }

    if (this.state.similar(data)) {
      return
    }

    this.invalidate();
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

        this.isPending = false;
        this.error = error;
        this.result.reject(error);
        this.invalidate();
      });
  }

  readonly invalidate = (): void => {
    const shouldRun = this.invalidation.invalidate();
    if (!shouldRun) {
      return;
    }
    this.parents.forEach(parent => parent.invalidate());
    this.children.clear();
    this.parents.clear();
  };
}