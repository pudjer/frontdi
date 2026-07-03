# frontdi

> **Deterministic dependency resolution with shared object identity, cascading invalidation, runtime cycle detection, and GC-aware lifecycle hooks**

`frontdi` is a lightweight dependency-resolution library for building **stable object graphs** from async data sources.

It gives you:

* ♻️ **Shared object instances by key**
* ⚡ **Weakly-cached descriptors**
* 🧠 **Automatic parent-child dependency graph tracking**
* 🔄 **Cascading invalidation**
* 🚫 **Runtime cycle detection with detailed error types**
* 🧩 **Composable async resolvers**
* 📦 **JSON-serializable keys**
* 🛠 `fetch()` + `build()` pipeline
* 🧪 Works with provided `data` without calling `fetch`

---

# Why it matters

The core idea of `frontdi`:

## **As long as an object is not invalidated — the exact same instance is returned everywhere**

If two parts of your app resolve:

```ts
userResolver.resolve({ key: 1 })
```

they receive the **same descriptor** and eventually the **same object reference**.

That means:

* identity consistency
* shared mutations
* memoization-friendly behavior
* stable references for UI/state systems
* no accidental duplicate entities

```ts
const aDesc = userResolver.resolve({ key: 1 })

const a = await aDesc.resPromise

const b = await userResolver.resolve({ key: 1 }).resPromise

console.log(a === b) // true
```

After invalidation:

```ts
userResolver.invalidateKey(1)

const c = await userResolver.resolve({ key: 1 }).resPromise

console.log(c === a) // false
```

This makes `frontdi` behave closer to an **identity map + dependency graph** than a simple async cache.

---

# Installation

```bash
npm i frontdi
```

---

# Quick Example

```ts
import { createResolver } from 'frontdi'

type Key = number

interface UserData {
  id: number
  username: string
  address: AddressData,
  companyId: number
}

class User {
  public invalidated: boolean = false
  constructor(
    public id: number,
    public username: string,
    public address: Address,
    public company: Company
  ) {}
}

const userResolver = createResolver<Key, UserData, User>({
  fetch: getUser,

  build: async ({ data, self, key }) => {
    // resolve dependencies by passing `self` as parent — no ctx needed
    
    const companyDesc = await companyResolver.resolve({
      key: data.companyId,
      self,
    })

    const addressDesc = await addressResolver.resolve({
      key,
      data: data.address,
      self,
    })

    // subscribe to invalidation events for cleanup
    

    const company = await companyDesc.resPromise
    const address = await addressDesc.resPromise

    const user = new User(
      data.id,
      data.username,
      address,
      company
    )
    
    const unsubInvalidate = self.onInvalidate(() => {
      user.invalidated = true
    })

    return user
  },
})

const userDesc = userResolver.resolve({ key: 1 })

//uses cached value
console.log(userDesc === userResolver.resolve({ key: 1 })) // true

// user depends on company (tracked automatically via parent-child)
companyResolver.invalidateKey(user.company.id)

const updated = await userResolver.resolve({ key: 1 }).resPromise

console.log(updated === user) // false
```

---

# Descriptor lifecycle

Each resolver produces a `Descriptor`:

```ts
export interface Descriptor<T extends object> {
  resPromise: Promise<T>;
  res: T | undefined;
  error: unknown;
  isPending: boolean;
  invalidatedPromise: Promise<T>;
  invalidated: boolean;
  onInvalidate: Subscribe;
  invalidate(): void;
}

type Subscribe = (subscriber: Subscriber) => Unsubscribe
```

---

## `descriptor.resPromise`

The underlying promise that resolves to the built object.

```ts
const user = await descriptor.resPromise
```

---

## `descriptor.res`

Synchronously access the resolved value, or `undefined` if still pending/error.

```ts
if (descriptor.isPending) {
  // wait for it...
} else {
  const user = descriptor.res!
}
```

---

## `descriptor.error`

Stores any error thrown during `fetch()` or `build()`. Access after resolution to inspect failures:

```ts
try {
  await descriptor.resPromise
} catch (err) {
  console.log(descriptor.error === err) // true
}
```

---

## `descriptor.isPending`

Whether the descriptor is still fetching/building. Useful for UI loading states or conditional logic.

```ts
if (!descriptor.isPending && descriptor.res !== undefined) {
  const user = descriptor.res
}
```

---

## `descriptor.invalidatedPromise`

A promise that resolves after the descriptor is AND invalidated AND built.

Useful for:

* subscriptions cleanup
* reactive systems
* explicit resource disposal
* dependency-driven rebuilds

```ts
const target = await descriptor.invalidatedPromise
console.log(target, 'was just invalidated')
```

---

## `descriptor.invalidated`

A boolean flag indicating whether the descriptor has been invalidated.

```ts
if (descriptor.invalidated) {
  // descriptor was invalidated, may need to re-resolve
}
```

---

## `descriptor.onInvalidate(subscriber)`

Subscribes to invalidation events via `Subscribe` — returns an unsubscribe function.

Useful for:

* cleanup on external changes (websockets, stores)
* reactive subscriptions tied to object lifecycle
* non-blocking side effects that don't need the full promise flow

```ts
const unsub = descriptor.onInvalidate(() => {
  console.log('descriptor invalidated')
})

// later...
unsub() // stop listening
```

---

## `descriptor.invalidate()`

Marks the descriptor as stale. Triggers cascading invalidation to dependents and fires all subscribers.

Important:

`invalidate()` is intended for cases where the underlying object became outdated because of external mutations or side effects.

Examples:

* websocket updates
* manual object mutation
* external store changes
* server-side updates
* invalidated subscriptions

---

# Resolver API

```ts
export interface Resolver<KEY, DATA, T extends object> {
  invalidateKey(key: KEY): void;
  resolve(args: ResolveArgs<KEY, DATA>): Descriptor<T>;
}

type ResolveArgs<KEY, DATA> = KeyArgs<KEY> & (DataArgs<DATA> | {})

type KeyArgs<KEY> = { key: KEY, self?: Descriptor<object> }
type DataArgs<DATA> = { data: DATA }
```

---

# Key system

## Keys can be ANY JSON-serializable object

Examples:

```ts
type Key = number
```

```ts
type Key = {
  left: number
  right: number
}
```

```ts
type Key = {
  userId: number
  filters: {
    active: boolean
    page: number
  }
}
```

Internally, keys are normalized deterministically.

That means:

```ts
{ a: 1, b: 2 }
```

and

```ts
{ b: 2, a: 1 }
```

produce the same cache identity.

---

## Important recommendation for arrays

If array order is NOT semantically important:

```ts
['b', 'a']
```

vs

```ts
['a', 'b']
```

should ideally be sorted before resolving.

Example:

```ts
const tags = [...inputTags].sort()

resolver.resolve({ key: { tags } })
```

Otherwise they are treated as different keys.

---

# API

## `createResolver(rule)`

```ts
function createResolver<KEY, DATA, T extends object>(
  rule: ClientRule<KEY, DATA, T>
): Resolver<KEY, DATA, T>
```

---

## Rule definition

```ts
type ClientRule<KEY, DATA, T extends object> = {
  fetch: (key: KEY) => Promise<DATA> | DATA

  build: (info: BuildInfo<KEY, DATA, T>) => Promise<T> | T
}

interface BuildInfo<KEY, DATA, T extends object> {
  key: KEY
  data: DATA
  self: Descriptor<T> // the descriptor being built — pass as parent to children
}
```

`BuildInfo` dependency tracking is done purely through `self`.

---

# `resolve(args)`

```ts
resolve(
  args: ResolveArgs<KEY, DATA>
): Descriptor<T>
```

## Behavior with dependencies (parent-child tracking)

Passing `self` links child descriptors under the current one. Dependencies are tracked automatically.

```ts
const userDesc = resolver.resolve({ key }) // parent descriptor

// inside build(), pass self as parent:
childResolver.resolve({ 
  key, 
  self // ← tracks dependency graph automatically
})
```

---

## Behavior with `data` (skip fetch)

```ts
resolver.resolve({
  key,
  data
})
```

* `fetch()` is skipped
* `build()` runs using provided data

---

## Behavior without `data`

```ts
resolver.resolve({
  key
})
```

Flow:

```txt
fetch(key)
   ↓
build(...)
   ↓
cached descriptor
```
---

# Cascading invalidation

If the dependency graph looks like:

```txt
User -> Company -> Address
```

and `Company` is invalidated:

```ts
companyResolver.invalidateKey(key)
```

then dependent `User` descriptors are automatically invalidated as well. This guarantees graph consistency across all levels of nesting.

---

# Cycle detection

`frontdi` detects cycles at resolve time and throws typed errors instead of crashing with unhelpful stack traces:

## Self-reference

```txt
A -> A
```

Throws `SelfReferenceError`:

```ts
try {
  await resolver.resolve({ key, self }).resPromise
} catch (err) {
  if (err instanceof SelfReferenceError) {
    console.log(err.node) // the node that references itself
  }
}
```

## Dependency cycles

```txt
A -> B -> A
```

Throws `DependencyCycleError`:

```ts
try {
  await resolver.resolve({ key, self }).resPromise
} catch (err) {
  if (err instanceof DependencyCycleError) {
    console.log(err.cycle) // array of nodes forming the cycle
  }
}
```

---

# Cache semantics

## Cached by resolver + normalized key

Repeated calls:

```ts
resolver.resolve({ key })
```

return the **SAME descriptor instance** until invalidation.

```ts
const d1 = resolver.resolve({ key: 1 })
const d2 = resolver.resolve({ key: 1 })

console.log(d1 === d2) // true
```

---

# Invalidating by key

## `invalidateKey(key)`

```ts
resolver.invalidateKey(key)
```

Behavior:

* invalidates cached descriptor by key
* removes it from cache
* cascades invalidation to all dependents (children and descendants)
* next `resolve()` rebuilds fresh state

Example:

```ts
userResolver.invalidateKey(1)
```

---

# Best practices

## Pass `self` as parent in children resolves

Inside `build()`, pass the descriptor's own reference (`self`) to child resolvers so dependencies are tracked automatically.

```ts
childResolver.resolve({ key, self }) // ← always include this
```

## Prefer deterministic keys

Good:

```ts
{ page: 1, sort: 'desc' }
```

Better with arrays:

```ts
{ tags: [...tags].sort() }
```

