export type JsonPrimitive = string | number | boolean | null;
export type JsonKey = JsonPrimitive | { [key: string]: JsonKey } | JsonKey[];
