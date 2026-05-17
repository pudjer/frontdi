import { IContext } from "./Common"
import { Descriptor } from "./Resolver"


export interface BuildInfo<KEY, T extends object, DATA> {
  key: KEY
  data: DATA
  ctx: IContext
  self: Descriptor<T>
}
export interface ClientRule<KEY, T extends object, DATA> {
  fetch: (key: KEY) => Promise<DATA>
  build: (info: BuildInfo<KEY, T, DATA>) => Promise<T>
}
