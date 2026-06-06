

export interface IContext {
  _context: true
}

export class DependencyCycleError extends Error {
  constructor(public readonly cycle: Array<unknown>) { super(`Cycle detected`) }
}
export class SelfReferenceError extends DependencyCycleError {
  constructor(public readonly node: unknown) { super([node]) }
}