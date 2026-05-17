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
}

export interface Resolver<KEY, DATA, T extends object> {
  refresh(args: RefreshArgs<KEY, DATA>): Descriptor<T>;
  resolve(args: ResolveArgs<KEY, DATA>): Descriptor<T>;
}
