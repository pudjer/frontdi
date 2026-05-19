import type { Descriptor } from "../CoreApiTypes/Resolver";
import { promiseWithResolvers } from "./ResolverImpl";
import { IterableWeakSet } from "./WeakDataStructures/WeakSetIterable";




export class DescriptorImpl<T> implements Descriptor<T> {
  private readonly dependencies = new Set<DescriptorImpl<unknown>>();
  public readonly dependents = new IterableWeakSet<DescriptorImpl<unknown>>();
  public readonly invalidated: Promise<T>;
  private readonly resolveInvalidated: (value: T) => void;
  private readonly rejectInvalidated: (reason?: any) => void;
  private alreadyInvalidated = false;
  constructor(
    public readonly res: Promise<T>,
    private readonly onInvalidate?: () => void
  ) {
    const { promise: invalidated, resolve: resolveInvalidated, reject: rejectInvalidated } = promiseWithResolvers<T>();
    this.invalidated = invalidated;
    this.resolveInvalidated = resolveInvalidated;
    this.rejectInvalidated = rejectInvalidated;
  }
  public readonly invalidate = () => {
    if (this.alreadyInvalidated) return;
    this.onInvalidate?.();
    this.alreadyInvalidated = true;
    this.dependents.forEach((dep) => dep.invalidate());
    this.res.then(this.resolveInvalidated).catch(this.rejectInvalidated);
    this.dependencies.clear();
  };
  addDependency(dependecy: DescriptorImpl<unknown>): void {
    this.dependencies.add(dependecy);
    dependecy.dependents.add(this as DescriptorImpl<unknown>);
  }
}
