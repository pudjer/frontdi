import type { Descriptor } from "./Descriptor"
import type { JsonKey } from "./JsonKey"


export interface BuildInfo<KEY extends JsonKey, DATA, T extends object> {
  key: KEY
  data: DATA
  self: Descriptor<T>
}
export interface ClientRule<KEY extends JsonKey, DATA, T extends object> {
  fetch: (key: KEY) => Promise<DATA> | DATA
  build: (info: BuildInfo<KEY, DATA, T>) => Promise<T> | T
}
