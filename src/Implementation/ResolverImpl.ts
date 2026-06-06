import { type ClientRule, type Data } from "../CoreApiTypes/ClientRule";
import { type IContext } from "../CoreApiTypes/Common";
import { type ResolveArgs, type Resolver } from "../CoreApiTypes/Resolver";
import { ContextImpl } from "./DepsTracking/ContextImpl";
import { DescriptorImpl } from "./DescriptorImpl";
import { type WeakObjectStore } from "./ObjectStore/WeakObjectStore";
import { WeakObjectStoreSerializableKey } from "./ObjectStore/WeakObjectStoreSerializableKey";



export class ResolverImpl<KEY, DATA extends Data, T extends object> implements Resolver<KEY, DATA, T> {
  constructor(
    private rule: ClientRule<KEY, DATA, T>,
    private cache: WeakObjectStore<KEY, DescriptorImpl<T, DATA>> = new WeakObjectStoreSerializableKey<KEY, DescriptorImpl<T, DATA>>()
  ) {}


  private typeCheckContext(ctx: IContext): ctx is ContextImpl{
    return "_depscontext" in ctx
  }


  resolve = (args: ResolveArgs<KEY, DATA>): DescriptorImpl<T, DATA> => {
    const { key, ctx: mbCtx } = args
    const ctx = mbCtx || new ContextImpl()
    if(!this.typeCheckContext(ctx)) throw new Error("invalid context")
    const cached = this.cache.get(key)


    let desc: DescriptorImpl<T, DATA>
    const newCtx = ctx.copy()
    const build = (data: DATA) => Promise.resolve().then(() => this.rule.build({data, self: desc, ctx: newCtx, key}))

    if(cached){

      desc = cached
      if("data" in args){
        desc = cached.onData(args.data)
      }

    }else{

      desc = new DescriptorImpl<T, DATA>(build);

      if("data" in args){
        desc = desc.onData(args.data)
      }else{
        desc.fetchData(()=>Promise.resolve(this.rule.fetch(args.key)))
      }

      this.cache.set(key, desc)
      desc.onInvalidate(() => {
        const cached = this.cache.get(key)
        if(cached === desc) this.cache.delete(key)
      })
    }

    newCtx.next(desc.graph)
    return desc
  }

  invalidateKey = (key: KEY): void => {
    const descriptor = this.cache.get(key)
    if(descriptor) {
      descriptor.invalidate()
    }
  }

}

