import { WeakMapReverse } from "../WeakDataStructures/WeakMapReverse";
import type { WeakObjectStore } from "./WeakObjectStore";
export interface KeySerializer<KEY, SRLZD> {
	serialize(key: KEY): SRLZD
}

export class OrderedJSONKeySerializer<KEY> implements KeySerializer<KEY, string> {
	serialize(obj: KEY): string {
			const allKeys = new Set();
			JSON.stringify(obj, (key, value) => (allKeys.add(key), value));
			return JSON.stringify(obj, Array.from(allKeys).sort() as (string | number)[]);
	}
}



export class WeakObjectStoreSerializableKey<KEY, T extends object> implements WeakObjectStore<KEY, T> {
	private readonly weakMapReverse = new WeakMapReverse<string, T>()
	constructor(
		private readonly keySerializer: KeySerializer<KEY, string> = new OrderedJSONKeySerializer<KEY>()
	){}

	get(key: KEY): T | undefined {
		const serializedKey = this.keySerializer.serialize(key)
		return this.weakMapReverse.get(serializedKey)
	}
	set(key: KEY, value: T): void {
		const serializedKey = this.keySerializer.serialize(key)
		if (this.weakMapReverse.has(serializedKey)) throw new Error("Key already exists")
		this.weakMapReverse.set(serializedKey, value)
	}
	delete(key: KEY): void {
		const serializedKey = this.keySerializer.serialize(key)
		this.weakMapReverse.delete(serializedKey)
	}
}

