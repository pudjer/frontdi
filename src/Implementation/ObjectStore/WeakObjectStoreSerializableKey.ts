import { serialize } from "../utils";
import { WeakMapReverse } from "../WeakDataStructures/WeakMapReverse";
import type { WeakObjectStore } from "./WeakObjectStore";
export interface KeySerializer<KEY, SRLZD> {
	serialize(key: KEY): SRLZD
}

export class WeakObjectStoreSerializableKey<KEY, T extends object> implements WeakObjectStore<KEY, T> {
	private readonly weakMapReverse = new WeakMapReverse<string, T>()

	get(key: KEY): T | undefined {
		const serializedKey = serialize(key)
		return this.weakMapReverse.get(serializedKey)
	}
	set(key: KEY, value: T): void {
		const serializedKey = serialize(key)
		if (this.weakMapReverse.has(serializedKey)) throw new Error("Key already exists")
		this.weakMapReverse.set(serializedKey, value)
	}
	delete(key: KEY): void {
		const serializedKey = serialize(key)
		this.weakMapReverse.delete(serializedKey)
	}
}

