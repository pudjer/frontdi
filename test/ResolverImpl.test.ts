// frontdi.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createResolver } from 'frontdi';

describe('frontdi', () => {
  it('returns same descriptor for same key', () => {
    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch: async (id) => ({ id }),
      build: ({ data }) => ({ id: data.id }),
    });

    const d1 = resolver.resolve({ key: 1 });
    const d2 = resolver.resolve({ key: 1 });

    expect(d1).toBe(d2);
  });

  it('returns same object instance for same key', async () => {
    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch: async (id) => ({ id }),
      build: ({ data }) => ({ id: data.id }),
    });

    const a = await resolver.resolve({ key: 1 }).res;
    const b = await resolver.resolve({ key: 1 }).res;

    expect(a).toBe(b);
  });

  it('refresh creates new instance', async () => {
    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch: async (id) => ({ id }),
      build: ({ data }) => ({ id: data.id }),
    });

    const a = await resolver.resolve({ key: 1 }).res;

    await resolver.refresh({ key: 1 }).res;

    const b = await resolver.resolve({ key: 1 }).res;

    expect(a).not.toBe(b);
  });

  it('invalidate() creates new instance', async () => {
    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch: async (id) => ({ id }),
      build: ({ data }) => ({ id: data.id }),
    });

    const desc = resolver.resolve({ key: 1 });

    const a = await desc.res;

    desc.invalidate();

    const b = await resolver.resolve({ key: 1 }).res;

    expect(a).not.toBe(b);
  });

  it('uses provided data without fetch()', async () => {
    const fetch = vi.fn();

    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch,
      build: ({ data }) => ({ id: data.id }),
    });

    const obj = await resolver.resolve({
      key: 1,
      data: { id: 123 },
    }).res;

    expect(fetch).not.toHaveBeenCalled();
    expect(obj.id).toBe(123);
  });

  it('calls fetch() when data not provided', async () => {
    const fetch = vi.fn(async (id: number) => ({ id }));

    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch,
      build: ({ data }) => ({ id: data.id }),
    });

    await resolver.resolve({ key: 1 }).res;

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(1);
  });

  it('normalizes object keys deterministically', () => {
    const resolver = createResolver<
      { a: number; b: number },
      { ok: true },
      { ok: true }
    >({
      fetch: async () => ({ ok: true }),
      build: ({ data }) => ({ ok: data.ok }),
    });

    const d1 = resolver.resolve({
      key: { a: 1, b: 2 },
    });

    const d2 = resolver.resolve({
      key: { b: 2, a: 1 },
    });

    expect(d1).toBe(d2);
  });

  it('does NOT normalize array order', () => {
    const resolver = createResolver<string[], {}, {}>({
      fetch: async () => ({}),
      build: () => ({}),
    });

    const d1 = resolver.resolve({
      key: ['a', 'b'],
    });

    const d2 = resolver.resolve({
      key: ['b', 'a'],
    });

    expect(d1).not.toBe(d2);
  });

  it('cascades invalidation to dependents', async () => {
    const companyResolver = createResolver<
      number,
      { id: number },
      { id: number }
    >({
      fetch: async (id) => ({ id }),
      build: ({ data }) => ({ id: data.id }),
    });

    const userResolver = createResolver<
      number,
      { id: number },
      { id: number; company: { id: number } }
    >({
      fetch: async (id) => ({ id }),
      build: async ({ data, ctx }) => {
        const company = await companyResolver.resolve({
          key: data.id,
          ctx,
        }).res;

        return {
          id: data.id,
          company,
        };
      },
    });

    const user1 = await userResolver.resolve({ key: 1 }).res;

    await companyResolver.refresh({ key: 1 }).res;

    const user2 = await userResolver.resolve({ key: 1 }).res;

    expect(user1).not.toBe(user2);
    expect(user1.company).not.toBe(user2.company);
  });

  it('resolves invalidated promise after invalidation', async () => {
    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch: async (id) => ({ id }),
      build: ({ data }) => ({ id: data.id }),
    });

    const desc = resolver.resolve({ key: 1 });

    const invalidated = vi.fn();

    desc.invalidated.then(invalidated);

    await desc.res;

    desc.invalidate();

    await new Promise((resolve) => setImmediate(resolve));

    expect(invalidated).toHaveBeenCalledTimes(1);
  });

  it('detects self-cycle', async () => {
    const resolver = createResolver<number, {}, {}>({
      fetch: async () => ({}),

      build: async ({ ctx }) => {
        await resolver.resolve({
          key: 1,
          ctx,
        }).res;

        return {};
      },
    });

    const desc = resolver.resolve({ key: 1 });
    await expect(desc.res).rejects.toThrow(/cycle/i);
    await expect(desc.invalidated).rejects.toThrow(/cycle/i);
  });

  it('detects dependency cycles', async () => {
    const resolverA = createResolver<number, {}, {}>({
      fetch: async () => ({}),

      build: async ({ ctx }) => {
        await resolverB.resolve({
          key: 1,
          ctx,
        }).res;

        return {};
      },
    });

    const resolverB = createResolver<number, {}, {}>({
      fetch: async () => ({}),

      build: async ({ ctx }) => {
        await resolverA.resolve({
          key: 1,
          ctx,
        }).res;

        return {};
      },
    });

    const desc = resolverA.resolve({ key: 1 });
    const desc2 = resolverB.resolve({ key: 1 });
    await expect(desc.res).rejects.toThrow(/cycle/i);
    await expect(desc.invalidated).rejects.toThrow(/cycle/i);

    await expect(desc2.res).rejects.toThrow(/cycle/i);
    await expect(desc2.invalidated).rejects.toThrow(/cycle/i);
  });

  it('does not rebuild while cached', async () => {
    const build = vi.fn(({ data }) => ({
      id: data.id,
    }));

    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch: async (id) => ({ id }),
      build,
    });

    await resolver.resolve({ key: 1 }).res;
    await resolver.resolve({ key: 1 }).res;
    await resolver.resolve({ key: 1 }).res;

    expect(build).toHaveBeenCalledTimes(1);
  });

  it('rebuilds after refresh', async () => {
    const build = vi.fn(({ data }) => ({
      id: data.id,
    }));

    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch: async (id) => ({ id }),
      build,
    });

    await resolver.resolve({ key: 1 }).res;

    await resolver.refresh({ key: 1 }).res;

    await resolver.resolve({ key: 1 }).res;

    expect(build).toHaveBeenCalledTimes(2);
  });

  it('shares nested dependency instances', async () => {
    const addressResolver = createResolver<
      number,
      { id: number },
      { id: number }
    >({
      fetch: async (id) => ({ id }),
      build: ({ data }) => ({ id: data.id }),
    });

    const userResolver = createResolver<
      number,
      { id: number },
      { address: { id: number } }
    >({
      fetch: async (id) => ({ id }),

      build: async ({ data, ctx }) => {
        const address = await addressResolver.resolve({
          key: data.id,
          ctx,
        }).res;

        return { address };
      },
    });

    const u1 = await userResolver.resolve({ key: 1 }).res;
    const u2 = await userResolver.resolve({ key: 1 }).res;

    expect(u1.address).toBe(u2.address);
  });
});