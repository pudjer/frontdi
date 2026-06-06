import type { Data } from "./ClientRule"
import type { IContext } from "./Common"


type KeyArgs<KEY> = { key: KEY }
type DataArgs<DATA extends Data> = { data: DATA }
export type RefreshArgs<KEY, DATA extends Data> = KeyArgs<KEY> & (DataArgs<DATA> | {})

export type ResolveArgs<KEY, DATA extends Data> = { 
  ctx?: IContext
} & RefreshArgs<KEY, DATA>

type Unsubscribe = () => void
type Subscriber = () => void
export type Subscribe = (subscriber: Subscriber) => Unsubscribe

export type Invalidate = () => void
export interface Descriptor<T> {
  resPromise: Promise<T>
  onInvalidate: Subscribe
  invalidate: Invalidate
  garbageCollected: Promise<void>,
}

export interface Resolver<KEY, DATA extends Data, T extends object> {
  invalidateKey(key: KEY): void;
  resolve(args: ResolveArgs<KEY, DATA>): Descriptor<T>;
}
