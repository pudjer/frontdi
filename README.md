# frontdi

> **Deterministic dependency resolution with shared object identity, cascading invalidation, and runtime cycle detection**

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
const a = await a.res;
const b = await userResolver.resolve({ key: 1 }).res;

console.log(a === b); // true
```

After invalidation:

```ts
await userResolver.refresh({ key: 1 }).res;

const c = await userResolver.resolve({ key: 1 }).res; //always invalidates previous value on key
//or
aDesc.invalidate() //invalidates only this descriptor if it is an actual descriptor

console.log(c === a); // false
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
import { createResolver } from 'frontdi';

type Key = number;

interface UserData {
  id: number;
  username: string;
  address: AddressData;
}

class User{
  constructor(
    public id: number,
    public username: string,
    public address: Address,
    public company: Company
  ){}
}

const userResolver = createResolver<Key, UserData, User>({
  fetch: getUser,

  build: async ({ data: user, ctx, key, self }) => {
    // resolve dependencies using the SAME ctx

    const company = companyResolver.resolve({
      key,
      ctx, //just always pass it if you can
    });

    const address = addressResolver.resolve({
      key,
      data: user.address, // data is only used when creating a new descriptor.
      ctx,                // If the descriptor already exists in cache for the same key, cached state wins and provided data is ignored.    
    });

    user.company = await company.res;
    user.address = await address.res;

    self.invalidated.then(() => { // resolves strictly after build + invalidation; do not await self.invalidated/self.res inside build (deadlock)
      // cleanup logic
      // subscriptions
      // dispose resources
    });

    return user;
  },
});

const user = await userResolver.resolve({ key: 1 }).res;

const same = await userResolver.resolve({ key: 1 }).res;

console.log(user === same); // true

userResolver.refresh({ key: 1 });

const updated = await userResolver.resolve({ key: 1 }).res;

console.log(updated === user); // false
```

---

# Resolver lifecycle

Each resolver produces a **Descriptor**:

```ts
type Descriptor<T> = {
  res: Promise<T>;
  invalidated: Promise<T>;
  invalidate(): void;
}
```

## `descriptor.res`

Resolves to the built object.

---

## `descriptor.invalidated`

Resolves AFTER the descriptor is invalidated.

Useful for:

* cleanup
* unsubscribing
* cache disposal
* reactive systems
* lifecycle hooks

```ts
descriptor.invalidated.then((value) => {
  console.log('invalidated', value);
});
```

---

## `descriptor.invalidate()`

Manually invalidates the descriptor and cascades invalidation to dependents.

```ts
descriptor.invalidate();
```

---

# Key system

## Keys can be ANY JSON-serializable object

Examples:

```ts
type Key = number;

type Key = {
  left: number;
  right: number;
};

type Key = {
  userId: number;
  filters: {
    active: boolean;
    page: number;
  };
};
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
const tags = [...inputTags].sort();

resolver.resolve({
  key: { tags }
});
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
  fetch: (key: KEY) => Promise<DATA> | DATA;

  build: (
    info: BuildInfo<KEY, DATA, T>
  ) => Promise<T> | T;
};
```

---

# `resolve(args)`

```ts
resolve(args: ResolveArgs<KEY, DATA>): Descriptor<T>
```

```ts
type ResolveArgs<KEY, DATA> = {
  key: KEY;
  data?: DATA;
  ctx?: IContext;
};
```

---

## Behavior

### With `data`

```ts
resolver.resolve({
  key,
  data
});
```

* `fetch()` is skipped
* `build()` runs using provided data

---

### Without `data`

```ts
resolver.resolve({
  key
});
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
const user = userResolver.resolve({ key, ctx });

const posts = postsResolver.resolve({ key, ctx });
```

Dependencies are recorded during `build()`.

This enables:

* cascading invalidation
* cycle detection
* dependency-aware refreshes

---

# Cascading invalidation

If:

```txt
User -> Company -> Address
```

and `Company` is invalidated:

```ts
companyResolver.refresh({ key });
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
await resolver.resolve(...).res;
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
const d1 = resolver.resolve({ key: 1 });
const d2 = resolver.resolve({ key: 1 });

console.log(d1 === d2); // true
```

---

# Refresh

## `refresh(args)`

```ts
refresh(args: RefreshArgs<KEY, DATA>): Descriptor<T>
```

```ts
type RefreshArgs<KEY, DATA> = {
  key: KEY;
  data?: DATA;
};
```

Behavior:

* invalidates cached descriptor by key
* removes it from cache
* cascades invalidation to dependents
* creates a new build context internally

```ts
await resolver.refresh({ key }).res;
```

---

# Best practices

## Always pass `ctx` inside `build()`

```ts
childResolver.resolve({
  key,
  ctx,
});
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
