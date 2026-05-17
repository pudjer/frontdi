import { IContext } from "./Common"

export interface NecessaryArgs<KEY> {
  ctx: IContext
  key: KEY
}
export type FreshArgs<KEY, DATA> = NecessaryArgs<KEY> & { data?: DATA }

export type Invalidate = ()=>void
export interface Descriptor<T> {
  res: Promise<T>
  invalidated: Promise<T>
  invalidate: Invalidate
}

export interface Resolver<KEY, T extends object, DATA> {
  fresh(args: FreshArgs<KEY, DATA>): Descriptor<T>; //invokes invalidate(), then builds
  maybeOld(args: NecessaryArgs<KEY>): Descriptor<T>;
}
