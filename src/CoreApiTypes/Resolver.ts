import type { IContext } from "./Common"


export type RefreshArgs<KEY, DATA> = {
  key: KEY
  data?: DATA
}
export type ResolveArgs<KEY, DATA> = { 
  ctx?: IContext
} & RefreshArgs<KEY, DATA>

export type Invalidate = ()=>void
export interface Descriptor<T> {
  res: Promise<T>
  invalidated: Promise<T>
  invalidate: Invalidate
  garbageCollected: Promise<void>,
}

export interface Resolver<KEY, DATA, T extends object> {
  invalidateKey(key: KEY): void;
  resolve(args: ResolveArgs<KEY, DATA>): Descriptor<T>;
}
