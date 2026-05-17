import type { ClientRule } from "./CoreApiTypes/ClientRule";
import type { Resolver } from "./CoreApiTypes/Resolver";
import { ResolverImpl } from "./Implementation/ResolverImpl";
export type * from "./CoreApiTypes/Resolver";
export type * from "./CoreApiTypes/ClientRule";

function createResolver<KEY, DATA, T extends object>(rule: ClientRule<KEY, DATA, T>): Resolver<KEY, DATA, T> {
  return new ResolverImpl(rule);
}

export { createResolver }