import type { Descriptor } from "../CoreApiTypes/Resolver";
import { createGarbageCollectPromise, promiseWithResolvers } from "./utils";
import { IterableWeakSet } from "./WeakDataStructures/WeakSetIterable";



export type DepsDescriptor<T extends object> = Descriptor<T> & { 
  addDependency(dependecy: DepsDescriptor<object>): void
  dependents: IterableWeakSet<DepsDescriptor<object>>
};

export const createDescriptor = <T extends object>(res: Promise<T>, onInvalidate?: () => void): DepsDescriptor<T> => new DescriptorImpl(res, onInvalidate);

class DescriptorImpl<T extends object> implements DepsDescriptor<T> {
  private readonly dependencies = new Set<DepsDescriptor<object>>();
  public readonly dependents = new IterableWeakSet<DepsDescriptor<object>>();
  public readonly invalidated: Promise<T>;
  private readonly resolveInvalidated: (value: T) => void;
  private readonly rejectInvalidated: (reason?: any) => void;
  public readonly garbageCollected: Promise<void>
  private alreadyInvalidated = false;
  constructor(
    public readonly res: Promise<T>,
    private readonly onInvalidate?: () => void
  ) {
    const { promise: invalidated, resolve: resolveInvalidated, reject: rejectInvalidated } = promiseWithResolvers<T>();
    this.invalidated = invalidated;
    this.resolveInvalidated = resolveInvalidated;
    this.rejectInvalidated = rejectInvalidated;
    this.garbageCollected = createGarbageCollectPromise(this)
  }
  public readonly invalidate = () => {
    if (this.alreadyInvalidated) return;
    this.onInvalidate?.();
    this.alreadyInvalidated = true;
    this.dependents.forEach((dep) => dep.invalidate());
    this.res.then(this.resolveInvalidated).catch(this.rejectInvalidated);
    this.dependencies.clear();
  };
  addDependency(dependecy: DepsDescriptor<object>): void {
    this.dependencies.add(dependecy);
    dependecy.dependents.add(this);
  }
}
