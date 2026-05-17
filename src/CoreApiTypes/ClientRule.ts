import type { IContext } from "./Common"
import type { Descriptor } from "./Resolver"


export interface BuildInfo<KEY, DATA, T extends object> {
  key: KEY
  data: DATA
  ctx: IContext
  self: Descriptor<T>
}
export interface ClientRule<KEY, DATA, T extends object> {
  fetch: (key: KEY) => Promise<DATA> | DATA
  build: (info: BuildInfo<KEY, DATA, T>) => Promise<T> | T
}
