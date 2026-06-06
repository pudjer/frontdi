import type { IContext } from "./Common"
import type { Descriptor } from "./Resolver"

interface EquatableObject {
  equals(other: this): boolean
}
export type Data = undefined | null | number | string | boolean | bigint | symbol | EquatableObject | object

export interface BuildInfo<KEY, DATA extends Data, T extends object> {
  key: KEY
  data: DATA
  ctx: IContext
  self: Descriptor<T>
}
export interface ClientRule<KEY, DATA extends Data, T extends object> {
  fetch: (key: KEY) => Promise<DATA> | DATA
  build: (info: BuildInfo<KEY, DATA, T>) => Promise<T> | T
}
