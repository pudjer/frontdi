import type { Descriptor } from "./Descriptor";

type KeyArgs<KEY> = { key: KEY, self?: Descriptor<object> }
type DataArgs<DATA> = { data: DATA }
export type ResolveArgs<KEY, DATA> = KeyArgs<KEY> & (DataArgs<DATA> | {})


export interface Resolver<KEY, DATA, T extends object> {
  invalidateKey(key: KEY): void;
  resolve(args: ResolveArgs<KEY, DATA>): Descriptor<T>;
}