import type { ClientRule } from "./CoreApiTypes/ClientRule";
import type { JsonKey } from "./CoreApiTypes/JsonKey";
import type { Resolver } from "./CoreApiTypes/Resolver";
import { ResolverImpl } from "./Implementation/ResolverImpl";
export * from "./CoreApiTypes/Resolver";
export * from "./CoreApiTypes/ClientRule";
export * from "./CoreApiTypes/Descriptor";
export * from "./CoreApiTypes/JsonKey";

function createResolver<KEY extends JsonKey, DATA, T extends object>(rule: ClientRule<KEY, DATA, T>): Resolver<KEY, DATA, T> {
  return new ResolverImpl(rule);
}

export { createResolver }