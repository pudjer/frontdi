# frontdi

**Dependency resolution library** with:


- ✅ Weakly-cached shared objects by Rule - Key
- ✅ `fetch()` + `build()` rule based
- ✅ Cascading cache invalidation for dependent resolvers
- ✅ Runtime cycle detection
- ✅ Support for resolving from provided `data` (no `fetch`)

---

## What it is

You define a *resolver rule* (how to `fetch` data and/or how to `build` a final value). Then you create a resolver instance via `createResolver(...)`.

A resolver returns a **Descriptor**:

- `descriptor.res: Promise<T>` — the built value
- `descriptor.invalidated: Promise<T>` — resolves after the descriptor is invalidated(after build)
- `descriptor.invalidate()` — manually invalidates the descriptor and cascades to dependents

Resolvers track dependencies during `build()` using a `ctx` context object. When you call `refresh()`, the cached descriptor is invalidated and dependents are invalidated as well.

---

## Install

```bash
npm i frontdi
```

---

## Quick start

```ts
import { createResolver } from 'frontdi';

type Key = number;
//type Key = {left: number, right: number}
//type Key = {parent: {child: ...}}

export interface User {
  id: number;
  username: string;
  address: Address;
  company: Company;
}
//class ComplexEntity{ constructor(...) }


const userResolver = createResolver<Key, User, User>({
  fetch: getUser,
  build: async ({data: user, ctx, key, self: {invalidated}}) => {
    //do not await values from self

    const company = companyResolver.resolve({ key: key, data: user.company, ctx });
    user.company = await company.res;

    const address = addressResolver.resolve({ key: key, data: user.address, ctx });
    user.address = await address.res;

    invalidated.then(() => {
      //resolvse strictly after build
      //some cleanup
    });


    return user;
    // return new User(company, address, ...)
  },
});

const user = await userResolver.resolve({ key: 1 }).res;
userResolver.resolve({ key: 1 }).invalidated.then(u=>{console.log(u===user)})
const same = await userResolver.resolve({ key: 1 }).res;
console.log(user===same)
const desc = userResolver.refresh({ key: 1 })
desc.invalidated.then(u=>{console.log(u!==user)})
const notSame = await userResolver.resolve({ key: 1 }).res;
console.log(notSame!==same)
desc.invalidate()
```

---

## API

### `createResolver(rule)`

```ts
function createResolver<KEY, DATA, T extends object>(
  rule: ClientRule<KEY, DATA, T>
): Resolver<KEY, DATA, T>
```

Where `ClientRule` is:

```ts
type ClientRule<KEY, DATA, T extends object> = {
  fetch: (key: KEY) => Promise<DATA> | DATA;
  build: (info: BuildInfo<KEY, DATA, T>) => Promise<T> | T;
};
```

### `resolver.resolve(args)`

```ts
resolve(args: ResolveArgs<KEY, DATA>): Descriptor<T>
```

`ResolveArgs`:

```ts
type ResolveArgs<KEY, DATA> = { ctx?: IContext } & { key: KEY; data?: DATA };
```

Behavior:

- If `args.data` is provided → `build()` runs using that data and **`fetch()` is not called**.
- Otherwise → `fetch(key)` runs, then `build()`.
- If you use it inside other `build()` you need to pass ctx from arguments of your build to parameters of resolve.

### `resolver.refresh({ key })`

```ts
refresh(args: RefreshArgs<KEY, DATA>): Descriptor<T>
```

`RefreshArgs`:

```ts
type RefreshArgs<KEY, DATA> = { key: KEY; data?: DATA };
```

Behavior:

- Invalidates value of descriptor and deletes it from cache if it is an actual value
- Cascades invalidation to dependents
- You should not use it inside your `build()`

> Note: `refresh()` creates a new build context internally.

---

## Dependency graph & cycle detection

During `build()`, you may call other resolvers using the same `ctx`. This library uses that context to record dependencies.

It detects:

1. **Self-reference**: resolving the same descriptor while it is being built
2. **Dependency cycles**: A depends on B, B depends on A

In those cases, `resolve(...).res` rejects with an error containing `Cycle detected`.

---

## Example: composing a graph (based on tests)

The tests in `test/ResolverImpl.test.ts` build a small graph:

- `geoResolver` builds `Geo`
- `addressResolver` resolves `geo` inside `build()`
- `companyResolver` builds `Company`
- `userResolver` resolves `company` + `address` inside `build()`
- `postsResolver` builds `Post[]`
- `commentsResolver` builds `Comment[]`

Key idea: **pass through `ctx`** when resolving dependencies.

---

## Testing notes (from `ResolverImpl` test)

### 1) Integration: full graph resolution

`test/jsonplaceholder/jsonplaceholderApi.ts` is used as a realistic external data source.

### 2) Caching: same key returns the same descriptor

The resolver caches descriptors by key in a weak object store. Repeated `resolve({ key })` returns the cached descriptor instance.

### 3) `build()` supports provided `data`

If you call:

```ts
resolver.resolve({ key, data })
```

`fetch(key)` is skipped and `build()` runs with the provided `data`.

### 4) Cycle detection

The test creates a resolver whose `build()` resolves itself using the same context chain; it must throw with `Cycle detected`.

### 5) Cascade invalidation with `refresh() and desc.invalidate()`

`refresh({ key })` and `resolve/refresh({ key }).invalidate()` invalidates that node and all recorded dependents.
You can subscribe on desc.invalidated promise or await it outside of build

---

## TypeScript tips

- `T extends object` is required by the current design because descriptors are tracked via object references.
- Prefer passing `ctx` when composing resolvers to ensure dependency tracking.

---

## License

MIT

