import { type ClientRule } from "../CoreApiTypes/ClientRule";
import type { Descriptor } from "../CoreApiTypes/Descriptor";
import type { JsonKey } from "../CoreApiTypes/JsonKey";
import { type ResolveArgs, type Resolver } from "../CoreApiTypes/Resolver";
import { DescriptorImpl } from "./DescriptorImpl";
import { type WeakObjectStore } from "./ObjectStore/WeakObjectStore";
import { WeakObjectStoreSerializableKey } from "./ObjectStore/WeakObjectStoreSerializableKey";



export class ResolverImpl<KEY extends JsonKey, DATA, T extends object> implements Resolver<KEY, DATA, T> {
  constructor(
    private rule: ClientRule<KEY, DATA, T>,
    private cache: WeakObjectStore<KEY, DescriptorImpl<T, DATA>> = new WeakObjectStoreSerializableKey<KEY, DescriptorImpl<T, DATA>>()
  ) {}


  private typeCheckParent(parent: Descriptor<object>): parent is DescriptorImpl<object, unknown> {
    return parent instanceof DescriptorImpl
  }


  resolve = (args: ResolveArgs<KEY, DATA>): DescriptorImpl<T, DATA> => {
    const { key, self: parent } = args

    if(parent){
      if(!this.typeCheckParent(parent)) throw new Error("invalid parent")
    }
    const cached = this.cache.get(key)


    let self: DescriptorImpl<T, DATA>
    const build = (fetchedData: DATA) => Promise.resolve().then(() => this.rule.build({data: fetchedData, self, key}))

    if(cached){
      if("data" in args){
        cached.onData(args.data)
        if(cached.invalidated){
          self = new DescriptorImpl<T, DATA>(build)
          self.onData(args.data)
        }else{
          self = cached
        }
      }else{
        self = cached
      }

    }else{

      self = new DescriptorImpl<T, DATA>(build);

      if("data" in args){
        self.onData(args.data)
      }else{
        self.fetchData(()=>Promise.resolve(this.rule.fetch(key)))
      }
    }
    

    if(self !== cached){
      self.onInvalidate(() => {
        const cached = this.cache.get(key)
        if(cached === self) this.cache.delete(key)
      })
      this.cache.set(key, self)
    }
    parent?.addChild(self)
    
    return self
  }

  invalidateKey = (key: KEY): void => {
    const descriptor = this.cache.get(key)
    if(descriptor) {
      descriptor.invalidate()
    }
  }

}

