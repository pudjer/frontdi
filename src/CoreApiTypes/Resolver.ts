import type { Descriptor } from "./Descriptor";
import type { JsonKey } from "./JsonKey";

type KeyArgs<KEY extends JsonKey> = { key: KEY, self?: Descriptor<object> }
type DataArgs<DATA> = { data: DATA }
export type ResolveArgs<KEY extends JsonKey, DATA> = KeyArgs<KEY> & (DataArgs<DATA> | {})


export interface Resolver<KEY extends JsonKey, DATA, T extends object> {
  invalidateKey(key: KEY): void;
  resolve(args: ResolveArgs<KEY, DATA>): Descriptor<T>;
}