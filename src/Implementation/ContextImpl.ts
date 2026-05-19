import { DependencyCycleError, type IContext, SelfReferenceError } from "../CoreApiTypes/Common";
import { type DepsDescriptor } from "./DescriptorImpl";




export class ContextImpl implements IContext {
  readonly _context = true as const;
  private readonly _depscontext = true as const; //for type checking
  constructor(
    private node?: DepsDescriptor<object>
  ) {
  }

  copy(): ContextImpl {
    return new ContextImpl(this.node);
  }

  next(descriptor: DepsDescriptor<object>): void {
    this.assertNoCycle(descriptor);
    if (this.node) {
      this.node.addDependency(descriptor);
    }
    this.node = descriptor;
  }

  assertNoCycle(descriptor: DepsDescriptor<object>): void {
    if (!this.node) return;

    if (this.node === descriptor) {
      throw new SelfReferenceError(this.node.res);
    }

    const visited = new Set<DepsDescriptor<object>>();
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
