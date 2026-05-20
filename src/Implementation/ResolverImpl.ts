import { type ClientRule } from "../CoreApiTypes/ClientRule";
import { type IContext } from "../CoreApiTypes/Common";
import { type RefreshArgs, type ResolveArgs, type Resolver } from "../CoreApiTypes/Resolver";
import { ContextImpl } from "./ContextImpl";
import { createDescriptor, type DepsDescriptor } from "./DescriptorImpl";
import { type WeakObjectStore } from "./ObjectStore/WeakObjectStore";
import { WeakObjectStoreSerializableKey } from "./ObjectStore/WeakObjectStoreSerializableKey";
import { promiseWithResolvers } from "./utils";



export class ResolverImpl<KEY, DATA, T extends object> implements Resolver<KEY, DATA, T> {
  constructor(
    private rule: ClientRule<KEY, DATA, T>,
    private cache: WeakObjectStore<KEY, DepsDescriptor<T>> = new WeakObjectStoreSerializableKey<KEY, DepsDescriptor<T>>()
  ) {}


  resolve = (args: ResolveArgs<KEY, DATA>): DepsDescriptor<T> => {
    const { key, ctx: mbCtx } = args
    const ctx = mbCtx || new ContextImpl()
    if(!this.typeCheckContext(ctx)) throw new Error("invalid context")
    const descriptor = this.cache.get(key)

    const newCtx = ctx.copy()
    const res = descriptor || this.build({...args, ctx: newCtx})
    newCtx.next(res)

    return res
  }

  invalidateKey = (key: KEY): void => {
    const descriptor = this.cache.get(key)
    if(descriptor) {
      descriptor.invalidate()
    }
  }

  private typeCheckContext(ctx: IContext): ctx is ContextImpl{
    return "_depscontext" in ctx
  }


  private readonly refs = new WeakMap<object, object>()
  private makeRef(obj1: object, obj2: object){ this.refs.set(obj1, obj2); this.refs.set(obj2, obj1) }

  private build(args: ResolveArgs<KEY, DATA> & { ctx: ContextImpl }): DepsDescriptor<T> {
    const { key, data, ctx } = args;

    const { promise: target, resolve: resolveTarget, reject: rejectTarget } = promiseWithResolvers<T>()


    const descriptor = createDescriptor(target, () => {
      const cached = this.cache.get(key)
      if(cached === descriptor) this.cache.delete(key)
    })
 


    const resolveTargetAndBind = (target: T) => {
      this.makeRef(target, descriptor)
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

