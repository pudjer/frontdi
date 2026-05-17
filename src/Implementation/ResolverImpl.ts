import { ClientRule } from "../CoreApiTypes/ClientRule";
import { IContext } from "../CoreApiTypes/Common";
import { Descriptor, FreshArgs, Invalidate, NecessaryArgs, Resolver } from "../CoreApiTypes/Resolver";
import { WeakObjectStore } from "./ObjectStore/WeakObjectStore";
import { WeakObjectStoreSerializableKey } from "./ObjectStore/WeakObjectStoreSerializableKey";
import { IterableWeakSet } from "./WeakDataStructures/WeakSetIterable";


class DescriptorImpl<T> implements Descriptor<T>{
  constructor(
    public readonly invalidate: Invalidate,
    public readonly res: Promise<T>,
    public readonly invalidated: Promise<T>,  
  ){}
}



export class DepsContext implements IContext{
  readonly _context = true as const;
  private readonly _depscontext = true as const //for type checking
  private readonly visited: IterableWeakSet<DescriptorImpl<unknown>>

  constructor(
    visited?: IterableWeakSet<DescriptorImpl<unknown>>,
  ){
    this.visited = new IterableWeakSet(visited)
  }

  copyWithVisited(): DepsContext {
    return new DepsContext(this.visited)
  }

  handleNode(descriptor: DescriptorImpl<unknown>): void {
    this.assertNoCycle(descriptor)
    this.visited.add(descriptor)
  }

  assertNoCycle(descriptor: DescriptorImpl<unknown>): void {
    if(this.visited.has(descriptor)) throw new Error("cycle detected")
  }
}



export class RuleWrapper<KEY, T extends object, DATA> implements Resolver<KEY, T, DATA> {
  private _gcFixMap = new WeakMap<object, DescriptorImpl<T>>() //keep reference to descriptor if object is alive
  constructor(
    private rule: ClientRule<KEY, T, DATA>,
    private cache: WeakObjectStore<KEY, DescriptorImpl<T>> = new WeakObjectStoreSerializableKey<KEY, DescriptorImpl<T>>()
  ) {}


  maybeOld = (args: NecessaryArgs<KEY>): DescriptorImpl<T> => {
    const { key, ctx } = args
    if(!this.typeCheckContext(ctx)) throw new Error("invalid context")
    const descriptor = this.cache.get(key)

    const newCtx = ctx.copyWithVisited()
    const res = descriptor || this.build({...args, ctx: newCtx})
    newCtx.handleNode(res)

    return res
  }

  fresh = (args: FreshArgs<KEY, DATA>): DescriptorImpl<T> => {
    const { key, ctx } = args
    if(!this.typeCheckContext(ctx)) throw new Error("invalid context")
    const descriptor = this.cache.get(key)

    if(descriptor) {
      ctx.assertNoCycle(descriptor)
      descriptor.invalidate()
    }

    const newCtx = ctx.copyWithVisited()
    const res = this.build({...args, ctx: newCtx})
    newCtx.handleNode(res)

    return res
  }

  private typeCheckContext(ctx: IContext): ctx is DepsContext{
    return "_depscontext" in ctx
  }




  private build(args: FreshArgs<KEY, DATA>): DescriptorImpl<T> {
    const { key, data, ctx } = args;

    const { promise: invalidated, resolve: resolveInvalidated, reject: rejectInvalidated } = promiseWithResolvers<T>()
    const { promise: target, resolve: resolveTarget, reject: rejectTarget } = promiseWithResolvers<T>()


    let alreadyInvalidated = false
    const invalidate: Invalidate = () => {
      if(alreadyInvalidated) return
      alreadyInvalidated = true

      target.then(resolveInvalidated).catch(rejectInvalidated)

      if(this.cache.get(key) === descriptor){
        this.cache.delete(key)
      }
    }

    const descriptor = new DescriptorImpl(invalidate, target, invalidated)

    const resolveTargetAndBind = (target: T) => {
      this._gcFixMap.set(target, descriptor)
      resolveTarget(target)
    }

    const rejectTargetAndInvalidate = (reason: unknown) => {
      rejectTarget(reason)
      descriptor.invalidate()
    }

    if("data" in args){
      Promise.resolve()
      .then(() => this.rule.build({ key, data: data!, ctx, self: descriptor }))
      .then(resolveTargetAndBind)
      .catch(rejectTargetAndInvalidate)
    }else{
      Promise.resolve()
      .then(() => this.rule.fetch(key))
      .then(fetched => this.rule.build({ key, data: fetched, ctx, self: descriptor }))
      .then(resolveTargetAndBind)
      .catch(rejectTargetAndInvalidate)
    }

    this.cache.set(key, descriptor)
    return descriptor
  }
}










function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  
  return { promise, resolve, reject };
}