import { DependencyCycleError, type IContext, SelfReferenceError } from "../CoreApiTypes/Common";
import { DescriptorImpl } from "./DescriptorImpl";




export class ContextImpl implements IContext {
  readonly _context = true as const;
  private readonly _depscontext = true as const; //for type checking
  constructor(
    private node?: DescriptorImpl<unknown>
  ) {
  }

  copy(): ContextImpl {
    return new ContextImpl(this.node);
  }

  next(descriptor: DescriptorImpl<unknown>): void {
    this.assertNoCycle(descriptor);
    if (this.node) {
      this.node.addDependency(descriptor);
    }
    this.node = descriptor;
  }

  assertNoCycle(descriptor: DescriptorImpl<unknown>): void {
    if (!this.node) return;

    if (this.node === descriptor) {
      throw new SelfReferenceError(this.node.res);
    }

    const visited = new Set<DescriptorImpl<unknown>>();
    const queue = [this.node];

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const dependent of current.dependents) {
        if (dependent === descriptor) {
          throw new DependencyCycleError([current.res, descriptor.res]);
        }
        queue.push(dependent);
      }
    }
  }
}
