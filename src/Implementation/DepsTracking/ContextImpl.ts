import { DependencyCycleError, type IContext, SelfReferenceError } from "../../CoreApiTypes/Common";
import type { DependencyGraph } from "./Graph";




export class ContextImpl implements IContext {
  readonly _context = true as const;
  private readonly _depscontext = true as const; //for type checking
  constructor(
    private node?: DependencyGraph<unknown>
  ) {
  }

  copy(): ContextImpl {
    return new ContextImpl(this.node);
  }

  next(descriptor: DependencyGraph<unknown>): void {
    this.assertNoCycle(descriptor);
    if (this.node) {
      this.node.addDependency(descriptor);
    }
    this.node = descriptor;
  }

  assertNoCycle(descriptor: DependencyGraph<unknown>): void {
    if (!this.node) return;

    if (this.node === descriptor) {
      throw new SelfReferenceError(this.node);
    }

    const visited = new Set<DependencyGraph<unknown>>();
    const queue = [this.node];

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const dependent of current.dependents) {
        if (dependent === descriptor) {
          throw new DependencyCycleError([current.node, descriptor.node]);
        }
        queue.push(dependent);
      }
    }
  }
}
