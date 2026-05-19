import { createResolver } from '../src';
import { describe, it, expect } from 'vitest';

/**
 * RUN WITH:
 *
 * node --expose-gc ./node_modules/vitest/vitest.mjs
 */

describe('frontdi memory semantics', () => {

  it('gc collects resolved object without invalidate()', async () => {
    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch: async (id) => ({ id }),
      build: ({ data }) => ({ id: data.id }),
    });

    let gced = false;

    let obj = await resolver.resolve({ key: 1 }).res;

    onGC(obj, () => {
      gced = true;
    });

    obj = null as any;

    await forceGC();

    expect(gced).toBe(true);
  });

  it('bad thing about invalidated promise', async () => {
    let invalidated = false;

    const resolver = createResolver<number, { id: number }, { id: number }>({
      fetch: async (id) => ({ id }),

      build: ({ data, self }) => {
        self.invalidated.then(() => {
          invalidated = true;
        });

        return { id: data.id };
      },
    });

    let obj = await resolver.resolve({ key: 1 }).res;

    onGC(obj, () => {});

    obj = null as any;

    await forceGC();

    resolver.refresh({ key: 1 });

    await tick();

    expect(invalidated).toBe(false);
  });

  it('dependency graph survives dependency value gc', async () => {
    let depGced = false;

    const depResolver = createResolver<
      number,
      { value: number },
      { value: number }
    >({
      fetch: async (id) => ({ value: id }),
      build: ({ data }) => ({ value: data.value }),
    });

    const rootResolver = createResolver<
      number,
      null,
      {}
    >({
      fetch: async () => null,

      build: async ({ ctx, self }) => {
        const dep = await depResolver.resolve({
          key: 1,
          ctx,
        }).res;

        return {};
      },
    });

    let depObj = await depResolver.resolve({ key: 1 }).res;

    const root = await rootResolver.resolve({ key: 1 }).res;


    onGC(depObj, () => {depGced = true});

    depObj = null as any;

    await forceGC();
    expect(depGced).toBe(false);

    depResolver.refresh({ key: 1 });

    await forceGC();
    expect(depGced).toBe(true);

    await tick();

  });

  it('root object gc while dependency remains strongly referenced', async () => {
    const depResolver = createResolver<
      number,
      { value: number },
      { value: number }
    >({
      fetch: async (id) => ({ value: id }),
      build: ({ data }) => ({ value: data.value }),
    });

    const rootResolver = createResolver<
      number,
      null,
      { depValue: number }
    >({
      fetch: async () => null,

      build: async ({ ctx }) => {
        const dep = await depResolver.resolve({
          key: 1,
          ctx,
        }).res;

        return {
          depValue: dep.value,
        };
      },
    });

    const dep = await depResolver.resolve({ key: 1 }).res;

    let root = await rootResolver.resolve({ key: 1 }).res;

    let rootGCed = false;

    onGC(root, () => {
      rootGCed = true;
    });

    root = null as any;

    await forceGC();

    expect(rootGCed).toBe(true);

    expect(dep.value).toBe(1);
  });

  it('invalidated promise does not retain object', async () => {
    const resolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,

      build: ({ data, self }) => {
        self.invalidated.then(() => {});

        return { value: data };
      },
    });

    let obj = await resolver.resolve({ key: 1 }).res;

    let gced = false;

    onGC(obj, () => {
      gced = true;
    });

    obj = null as any;

    await forceGC();

    expect(gced).toBe(true);
  });




  it('refresh creates fresh graph', async () => {
    const resolver = createResolver<
      number,
      number,
      { v: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({ v: data }),
    });

    const a = await resolver.resolve({ key: 1 }).res;

    await resolver.refresh({ key: 1 }).res;

    const b = await resolver.resolve({ key: 1 }).res;

    expect(a).not.toBe(b);
  });

  it('same key returns same descriptor', () => {
    const resolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({ value: data }),
    });

    const a = resolver.resolve({ key: 1 });
    const b = resolver.resolve({ key: 1 });

    expect(a).toBe(b);
  });

  it('same key returns same object instance', async () => {
    const resolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({ value: data }),
    });

    const a = await resolver.resolve({ key: 1 }).res;
    const b = await resolver.resolve({ key: 1 }).res;

    expect(a).toBe(b);
  });

  it('refresh invalidates previous object identity', async () => {
    const resolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({ value: data }),
    });

    const a = await resolver.resolve({ key: 1 }).res;

    await resolver.refresh({ key: 1 }).res;

    const b = await resolver.resolve({ key: 1 }).res;

    expect(a).not.toBe(b);
  });

  it('provided data skips fetch only for initial build', async () => {
    let fetches = 0;

    const resolver = createResolver<
      number,
      { value: number },
      { value: number }
    >({
      fetch: async (id) => {
        fetches++;
        return { value: id };
      },

      build: ({ data }) => ({
        value: data.value,
      }),
    });

    const a = await resolver.resolve({
      key: 1,
      data: { value: 123 },
    }).res;

    const b = await resolver.resolve({
      key: 1,
    }).res;

    expect(a).toBe(b);
    expect(fetches).toBe(0);
  });

  it('manual invalidate cascades to dependents', async () => {
    let rootInvalidated = false;

    const childResolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({ value: data }),
    });

    const rootResolver = createResolver<
      number,
      null,
      { child: number }
    >({
      fetch: async () => null,

      build: async ({ ctx, self }) => {
        const child = await childResolver.resolve({
          key: 1,
          ctx,
        }).res;

        self.invalidated.then(() => {
          rootInvalidated = true;
        });

        return {
          child: child.value,
        };
      },
    });

    await rootResolver.resolve({ key: 1 }).res;

    const childDesc = childResolver.resolve({ key: 1 });

    childDesc.invalidate();

    await tick();

    expect(rootInvalidated).toBe(true);
  });

  it('many transient resolves should gc cleanly', async () => {
    const resolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({ value: data }),
    });

    for (let i = 0; i < 5000; i++) {
      let obj = await resolver.resolve({
        key: i,
      }).res;

      obj = null as any;
    }

    await forceGC();

    expect(true).toBe(true);
  });


  it('object gets garbage collected without invalidate()', async () => {
    const resolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({ value: data }),
    });

    let desc = resolver.resolve({ key: 1 });
    let obj = await desc.res;

    const gcPromise = desc.garbageCollected;

    desc = null as any;
    obj = null as any;

    await forceGC();

    await gcPromise;
  });


  it('dependency graph survives dependency gc', async () => {
    let rootInvalidated = false;

    const depResolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({ value: data }),
    });

    const rootResolver = createResolver<
      number,
      null,
      { result: number }
    >({
      fetch: async () => null,

      build: async ({ ctx, self }) => {
        const dep = await depResolver.resolve({
          key: 1,
          ctx,
        }).res;

        self.invalidated.then(() => {
          rootInvalidated = true;
        });

        return {
          result: dep.value + 1,
        };
      },
    });

    let depDesc = depResolver.resolve({ key: 1 });
    let dep = await depDesc.res;

    const root = await rootResolver.resolve({ key: 1 }).res;

    dep = null as any;
    depDesc = null as any;
    
    await forceGC();
    
    depResolver.refresh({ key: 1 });
    
    await tick();

    expect(rootInvalidated).toBe(true);
  });

  it('root object can gc while dependency stays strongly reachable', async () => {
    const depResolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({ value: data }),
    });

    const rootResolver = createResolver<
      number,
      null,
      { dep: number }
    >({
      fetch: async () => null,

      build: async ({ ctx }) => {
        const dep = await depResolver.resolve({
          key: 1,
          ctx,
        }).res;

        return {
          dep: dep.value,
        };
      },
    });

    const dep = await depResolver.resolve({
      key: 1,
    }).res;

    let rootDesc = rootResolver.resolve({
      key: 1,
    });

    let root = await rootDesc.res;
    const gcPromise = rootDesc.garbageCollected;

    root = null as any;
    rootDesc = null as any;

    await forceGC();

    await gcPromise;


    expect(dep.value).toBe(1);
  });

  it('dependency strongly held does not retain parent', async () => {
    const childResolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({ value: data }),
    });

    const parentResolver = createResolver<
      number,
      null,
      { computed: number }
    >({
      fetch: async () => null,

      build: async ({ ctx }) => {
        const child = await childResolver.resolve({
          key: 1,
          ctx,
        }).res;

        return {
          computed: child.value * 2,
        };
      },
    });

    const child = await childResolver.resolve({
      key: 1,
    }).res;

    let parentDesc = parentResolver.resolve({
      key: 1,
    });

    let parent = await parentDesc.res;
    const gcPromise = parentDesc.garbageCollected;

    expect(child.value).toBe(1);

    parent = null as any;
    parentDesc = null as any;

    await forceGC();

    await gcPromise;

  });

  it('invalidated promise does not retain object', async () => {
    const resolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,

      build: ({ data, self }) => {
        self.invalidated.then(() => {});

        return {
          value: data,
        };
      },
    });

    let desc = resolver.resolve({ key: 1 });
    let obj = await desc.res;
    const gcPromise = desc.garbageCollected;

    obj = null as any;
    desc = null as any;

    await forceGC();

    await gcPromise;

  });


  it('many transient resolves do not accumulate permanently', async () => {
    const resolver = createResolver<
      number,
      number,
      { value: number }
    >({
      fetch: async (id) => id,
      build: ({ data }) => ({
        value: data,
      }),
    });

    const gcs = [];

    for (let i = 0; i < 2000; i++) {
      let desc = resolver.resolve({
        key: i,
      });
      const gcPromise = desc.garbageCollected;


      let obj = await desc.res;

      obj = null as any;
      desc = null as any;

      gcs.push(gcPromise);
    }

    await forceGC();

    await Promise.all(gcs);

    expect(true).toBe(true);
  });




});



const fr = new FinalizationRegistry<( ) => void>((cb) => cb());

function onGC(obj: object, cb: () => void) {
  fr.register(obj, cb);
}

async function forceGC() {
  if (!global.gc) {
    throw new Error(
      'Run node with --expose-gc'
    );
  }

  for (let i = 0; i < 20; i++) {
    global.gc();

    const garbage = new Array(1e6)
      .fill(0)
      .map(() => ({}));

    await tick();
  }
}

async function tick() {
  await new Promise((r) => setTimeout(r, 0));
}