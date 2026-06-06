import { IterableWeakSet } from "../WeakDataStructures/WeakSetIterable";

export class DependencyGraph<T> {

  readonly dependencies = new Set<DependencyGraph<T>>();
  readonly dependents = new IterableWeakSet<DependencyGraph<T>>();

  constructor(public readonly node: T) {}

  addDependency(dependency: DependencyGraph<T>) {
    this.dependencies.add(dependency);
    dependency.dependents.add(this);
  }

  clear() {
    this.dependencies.clear();
  }
}
