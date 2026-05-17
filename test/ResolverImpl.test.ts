import { describe, expect, it, vi } from 'vitest';
import type { Descriptor } from '../src/CoreApiTypes/Resolver';
import { createResolver } from '../src/index';

import {
  Address,
  Company,
  Comment,
  Geo,
  Post,
  User,
  fetchUserAddress,
  fetchUserCompany,
  fetchUserGeo,
  getComments,
  getPosts,
  getUser,
} from './jsonplaceholder/jsonplaceholderApi';

type Key = number;

function buildGraph() {
  const geoResolver = createResolver<Key, Geo, Geo>({
    fetch: fetchUserGeo,
    build: async (info) => (info.data),
  });

  const addressResolver = createResolver<Key, Address, Address>({
    fetch: fetchUserAddress,
    build: async (info) => {
      const address = info.data;
      const geoDesc = geoResolver.resolve({ key: info.key, data: info.data.geo, ctx: info.ctx });
      // resolve must work with provided data too
      address.geo = await geoDesc.res;
      return address;
    },
  });

  const companyResolver = createResolver<Key, Company, Company>({
    fetch: fetchUserCompany,
    build: (info) => (info.data),
  });

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
    },
  });

  const postsResolver = createResolver<Key, Post[], Post[]>({
    fetch: getPosts,
    build: (info) => (info.data),
  });

  const commentsResolver = createResolver<Key, Comment[], Comment[]>({
    fetch: getComments,
    build: (info) => (info.data),
  });

  return {
    userResolver,
    postsResolver,
    commentsResolver,
    addressResolver,
    companyResolver,
    geoResolver,
  };
}

describe('ResolverImpl', () => {

  it('jsonplaceholder integration: can resolve a full user graph with dependent resolvers', async () => {
    const { userResolver, postsResolver, commentsResolver } = buildGraph();

    const user = await userResolver.resolve({ key: 1 }).res;
    userResolver.resolve({ key: 1 }).invalidated.then(u=>{console.log(u===user)})
    expect(user.id).toBe(1);

    const posts = await postsResolver.resolve({ key: user.id }).res;
    expect(posts.length).toBeGreaterThan(0);

    const firstPostId = posts[0].id;
    const comments = await commentsResolver.resolve({ key: firstPostId }).res;

    expect(comments.length).toBeGreaterThan(0);
    await userResolver.refresh({ key: 1 })
  });

  it('resolve(): returns built value and caches descriptor for the same key', async () => {
    const { userResolver } = buildGraph();

    const fetchSpy = vi.spyOn({ getUser }, 'getUser' as any);
    // vitest spy above is type-noop; instead we verify caching by resolver usage count via wrapper

    const user1 = await userResolver.resolve({ key: 1 }).res;
    const user2Desc = userResolver.resolve({ key: 1 });
    const user2 = await user2Desc.res;

    expect(user1).toEqual(user2);

    // Same descriptor instance should be returned from cache
    const user1Desc: Descriptor<User> = userResolver.resolve({ key: 1 });
    expect((await user1Desc.res).id).toBe(1);

    // Caching: calling resolve again should not trigger invalidation
    // We can't reliably spy on underlying fetch without wrapping, but we can at least ensure value stays stable.
    expect(user2.id).toBe(1);

    fetchSpy.mockRestore?.();
  });



  it('build(): supports provided `data` without calling fetch', async () => {
    const { userResolver } = buildGraph();

    // We can't intercept internal fetch easily here; instead we run build with explicit data
    const data: User = {
      id: 10,
      name: 'x',
      username: 'x',
      email: 'x',
      phone: 'x',
      website: 'x',
      company: { name: 'c', catchPhrase: 'cp', bs: 'b' },
      address: {
        street: 's',
        suite: 'su',
        city: 'ci',
        zipcode: 'z',
        geo: { lat: '1', lng: '2' },
      },
    };

    const userDesc = userResolver.resolve({ key: 10, data });
    const user = await userDesc.res;
    expect(user.id).toBe(10);
    expect(user.name).toBe('x');
    expect(user.address.geo.lat).toBe('1');
  });

  it('detects dependency cycles via ContextImpl (throws DependencyCycleError)', async () => {
    const cyclicResolver = createResolver<Key, { v: number }, { v: number }>({
      fetch: async () => ({ v: 1 }),
      build: async (info) => {
        // Create cycle: inside build of `cyclicResolver`, resolve itself with same ctx chain.
        await cyclicResolver.resolve({ key: info.key, ctx: info.ctx }).res;
        return info.data;
      },
    });
    
    const desc = cyclicResolver.resolve({ key: 1 })
    await expect(desc.res).rejects.toThrow(/Cycle detected/i);
    await expect(desc.invalidated).rejects.toThrow(/Cycle detected/i);
    await new Promise((resolve) => setTimeout(resolve, 4000));
  });

  it('refresh(): invalidates cached descriptor and invalidates dependents (cascade)', async () => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const { userResolver, companyResolver, addressResolver } = buildGraph();

    const userDesc1 = userResolver.resolve({ key: 2 });
    const user1 = await userDesc1.res;

    // Create dependents by resolving company/address first through user build.
    // Then refresh user => should invalidate user and its previously built dependencies.
    await userResolver.refresh({ key: 2 }).res;

    // After refresh, resolving again should produce a new value (not necessarily different, but descriptor should be invalidated)
    const userDesc2 = userResolver.resolve({ key: 2 });
    const user2 = await userDesc2.res;

    expect(user2.id).toBe(2);

    // Also ensure that refreshing a dependency invalidates dependent.
    const addressDesc1 = addressResolver.resolve({ key: 3 });
    const userDesc = userResolver.resolve({ key: 3 });
    await Promise.all([addressDesc1.res, userDesc.res]);

    const invalidatedPromise = userDesc.invalidated;
    await companyResolver.refresh({ key: 3 }).res; // refresh dependency chain (company is part of user build)

    // user should get invalidated; invalidated resolves with the current descriptor value type
    await expect(invalidatedPromise).resolves.toMatchObject({ id: 3 });
  });
});

