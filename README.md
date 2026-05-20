# frontdi

> **Deterministic dependency resolution with shared object identity, cascading invalidation, runtime cycle detection, and GC-aware lifecycle hooks**

`frontdi` is a lightweight dependency-resolution library for building **stable object graphs** from async data sources.

It gives you:

* ♻️ **Shared object instances by key**
* ⚡ **Weakly-cached descriptors**
* 🧠 **Automatic dependency graph tracking**
* 🔄 **Cascading invalidation**
* 🚫 **Runtime cycle detection**
* 🧩 **Composable async resolvers**
* 📦 **JSON-serializable keys**
* 🛠 `fetch()` + `build()` pipeline
* 🧪 Works with provided `data` without calling `fetch`
* 🗑 **Garbage-collection lifecycle hooks**

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

const a = await aDesc.res

const b = await userResolver.resolve({ key: 1 }).res

console.log(a === b) // true
```

After invalidation:

```ts
userResolver.invalidateKey(1)

const c = await userResolver.resolve({ key: 1 }).res

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

  build: async ({ data, ctx, key, self }) => {
    // resolve dependencies using the SAME ctx

    const company = await companyResolver.resolve({
      key: data.companyId,
      ctx,
    }).res

    const address = await addressResolver.resolve({
      key,
      data: data.address,
      ctx,
    }).res

    const user = new User(
      data.id,
      data.username,
      address,
      company
    )

    const ref = new WeakRef(user)
    const unsubscribe = someSource.subscribe(user.id, (changes)=>{
      const user = ref.deref() // avoid strong refs to result/self/context
      if(user){
        //
      }
    })

    self.invalidated.then((u) => {
      unsubscribe()
      u.invalidated = true
    })

    self.garbageCollected.then(() => {
      unsubscribe()
      // triggered when descriptor becomes unreachable
      // cleanup may happen via invalidation OR GC
      //🚫user.invalidated = true; avoid strong refs to result/self/context
    })

    return user
  },
})

const user = await userResolver.resolve({ key: 1 }).res

const same = await userResolver.resolve({ key: 1 }).res

//uses cached value
console.log(user === same) // true

// user depends on company
companyResolver.invalidateKey(user.company.id)

const updated = await userResolver.resolve({ key: 1 }).res

console.log(updated === user) // false
```

---

# Resolver lifecycle

Each resolver produces a `Descriptor`:

```ts
export interface Descriptor<T> {
  res: Promise<T>
  invalidated: Promise<T>
  invalidate: Invalidate
  garbageCollected: Promise<void>
}
```

---

## `descriptor.res`

Resolves to the built object.

```ts
const user = await descriptor.res
```

---

## `descriptor.invalidated`

Resolves after the descriptor is invalidated.

Useful for:

* subscriptions
* reactive systems
* explicit resource disposal
* dependency-driven rebuilds

```ts
descriptor.invalidated.then((target) => {
  console.log(target, 'descriptor invalidated')
})
```

---

## `descriptor.garbageCollected`

Resolves when the descriptor is garbage collected.

Useful for:

* weak-resource cleanup
* cache-adjacent systems
* diagnostics
* non-critical disposal logic

```ts
descriptor.garbageCollected.then(() => {
  console.log('descriptor collected')
})
```

---

## `descriptor.invalidate()`

Marks the descriptor as stale.

Important:

`resolver.invalidate(key)` is intended for cases where the underlying object became outdated because of external mutations or side effects.
`descriptor.invalidate()` does not invalidate key always.

Examples:

* websocket updates
* manual object mutation
* external store changes
* server-side updates
* invalidated subscriptions

It is **NOT required** for garbage collection.

If nothing references the descriptor anymore, it may still be collected naturally by the GC.

---

# Resolver API

```ts
export interface Resolver<KEY, DATA, T extends object> {
  invalidateKey(key: KEY): void

  resolve(
    args: ResolveArgs<KEY, DATA>
  ): Descriptor<T>
}
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

resolver.resolve({
  key: { tags }
})
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

  build: (
    info: BuildInfo<KEY, DATA, T>
  ) => Promise<T> | T
}
```

---

# `resolve(args)`

```ts
resolve(
  args: ResolveArgs<KEY, DATA>
): Descriptor<T>
```

```ts
type ResolveArgs<KEY, DATA> = {
  key: KEY
  data?: DATA
  ctx?: IContext
}
```

---

## Behavior

### With `data`

```ts
resolver.resolve({
  key,
  data
})
```

* `fetch()` is skipped
* `build()` runs using provided data

---

### Without `data`

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

# Dependency tracking

Resolvers automatically build a dependency graph through shared `ctx`.

```ts
const user = userResolver.resolve({ key, ctx })

const posts = postsResolver.resolve({ key, ctx })
```

Dependencies are recorded during `build()`.

This enables:

* cascading invalidation
* cycle detection
* dependency-aware rebuilds

---

# Cascading invalidation

If:

```txt
User -> Company -> Address
```

and `Company` is invalidated:

```ts
companyResolver.invalidateKey(key)
```

then dependent `User` descriptors are invalidated automatically.

This guarantees graph consistency.

---

# Cycle detection

`frontdi` detects:

## Self-reference

```txt
A -> A
```

## Dependency cycles

```txt
A -> B -> A
```

In those cases:

```ts
await resolver.resolve(...).res
```

rejects with:

```txt
Cycle detected
```

---

# Cache semantics

## Cached by resolver + normalized key

Repeated calls:

```ts
resolver.resolve({ key })
```

return the SAME descriptor instance until invalidation.

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
* cascades invalidation to dependents
* next `resolve()` rebuilds fresh state

Example:

```ts
userResolver.invalidateKey(1)
```

---

# Best practices

## Always pass `ctx` inside `build()`

```ts
childResolver.resolve({
  key,
  ctx,
})
```

Without shared context, dependency tracking will not work.

---

## Prefer deterministic keys

Good:

```ts
{
  page: 1,
  sort: 'desc'
}
```

Better with arrays:

```ts
{
  tags: [...tags].sort()
}
```

---

## Use invalidation only for stale state

`invalidate()` and `invalidateKey()` are for rebuilding stale objects after external changes.

They are not lifecycle requirements for cleanup or memory release.

Garbage collection works independently.

---

# Example architecture

```txt
User
 ├── Company
 ├── Address
 │     └── Geo
 └── Posts
       └── Comments
```

Each resolver composes others using shared `ctx`.

`frontdi` tracks the graph automatically.

---

# Use cases

Perfect for:

* frontend entity graphs
* normalized async stores
* SDK clients
* reactive state systems
* GraphQL-like composition
* client-side repositories
* dependency-aware caches
* identity-mapped data layers

---

# TypeScript notes

```ts
T extends object
```

is required because descriptors track object references internally.

---

# License

MIT
