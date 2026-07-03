import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createResolver, DependencyCycleError, SelfReferenceError, ClientRule, Resolver, Descriptor } from '../src';


describe('Advanced Edge Cases', () => {
  let resolver: Resolver<any, any, any>;
  let rule: ClientRule<any, any, any>;
  describe('Concurrent Invalidation and Resolution', () => {

    it('should handle rapid invalidate/resolve cycles', async () => {
      const fetchResults = ['a', 'b', 'c', 'd'];
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(() => {
        return Promise.resolve({ value: fetchResults[callCount++] });
      });
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptors: Descriptor<any>[] = [];
      
      for (let i = 0; i < 4; i++) {
        if (i > 0) resolver.invalidateKey('test');
        descriptors.push(resolver.resolve({ key: 'test' }));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Only the last descriptor should be valid
      expect(descriptors[3].invalidated).toBe(false);
      expect(descriptors[3].res).toEqual({ value: 'd', built: true });
      expect(descriptors[0].invalidated).toBe(true);
    });

    it('should handle concurrent invalidate from multiple sources', async () => {
      let resolveFetches: Array<(value: any) => void> = [];
      const fetchMock = vi.fn().mockImplementation(() => 
        new Promise(resolve => { resolveFetches.push(resolve); })
      );
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const desc1 = resolver.resolve({ key: 'parent' });
      const desc2 = resolver.resolve({ key: 'child' });
      
      // Invalidate both simultaneously
      resolver.invalidateKey('parent');
      resolver.invalidateKey('child');
      
      const desc3 = resolver.resolve({ key: 'parent' });
      const desc4 = resolver.resolve({ key: 'child' });
      
      expect(desc1).not.toBe(desc3);
      expect(desc2).not.toBe(desc4);
      expect(desc1.invalidated).toBe(true);
      expect(desc2.invalidated).toBe(true);
    });
  });

  describe('Complex Dependency Scenarios', () => {
    it('should handle diamond dependency pattern', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'top') {
          const [left, right] = await Promise.all([
            resolver.resolve({ self, key: 'left' }).resPromise,
            resolver.resolve({ self, key: 'right' }).resPromise
          ]);
          return { left, right };
        }
        if (key === 'left' || key === 'right') {
          const bottom = await resolver.resolve({ self, key: 'bottom' }).resPromise;
          return { bottom };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const top = resolver.resolve({ key: 'top' });
      await top.resPromise;
      
      const left = resolver.resolve({ key: 'left' })
      
      const right = resolver.resolve({ key: 'right' })
      
      // Invalidate bottom - should invalidate left, right, and top
      resolver.invalidateKey('bottom');
      expect(top.invalidated).toBe(true);
      expect(left.invalidated).toBe(true);
      expect(right.invalidated).toBe(true);
    });

    it('should handle multiple parents sharing children with different depths', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'parent1') {
          const child = await resolver.resolve({ self, key: 'shared-child' }).resPromise;
          return { child, path: 'short' };
        }
        if (key === 'parent2') {
          const intermediate = await resolver.resolve({ self, key: 'intermediate' }).resPromise;
          const child = await resolver.resolve({ self, key: 'shared-child' }).resPromise;
          return { intermediate, child, path: 'long' };
        }
        if (key === 'intermediate') {
          return {};
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const parent1 = resolver.resolve({ key: 'parent1' });
      const parent2 = resolver.resolve({ key: 'parent2' });
      await Promise.all([parent1.resPromise, parent2.resPromise]);
      
      resolver.invalidateKey('shared-child');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(parent1.invalidated).toBe(true);
      expect(parent2.invalidated).toBe(true);
    });

    it('should handle parent re-resolution while children are pending', async () => {
      let resolveChild: (value: any) => void;
      const fetchMock = vi.fn().mockImplementation((key: string) => {
        if (key === 'child') {
          return new Promise(resolve => { resolveChild = resolve; });
        }
        return Promise.resolve({});
      });
      
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'parent') {
          const child = await resolver.resolve({ self, key: 'child' }).resPromise;
          return { child };
        }
        return {};
      });
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const parent1 = resolver.resolve({ key: 'parent' });
      expect(parent1.isPending).toBe(true);
      
      // Resolve parent again while child is still pending
      const parent2 = resolver.resolve({ key: 'parent' });
      expect(parent1).toBe(parent2); // Should be same descriptor
      
      await new Promise(resolve => setTimeout(resolve, 100));
      resolveChild!({ value: 'child-data' });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(parent1.res).toBeDefined();
      expect(parent1.isPending).toBe(false);
    });
  });

  describe('Memory Management', () => {
    it('should clean up weak references when no strong references exist', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'root') {
          const child1 = await resolver.resolve({ self, key: 'child1' }).resPromise;
          const child2 = await resolver.resolve({ self, key: 'child2' }).resPromise;
          return { child1, child2 };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      let root = await resolver.resolve({ key: 'root' }).resPromise;
      const rootRef = new WeakRef(root);
      
      // Get references but don't store them
      const { child1, child2 } = root;
      const childDesc = resolver.resolve({ key: 'child1' });
      await childDesc.resPromise;
      root = undefined as any;
      buildMock.mockClear();
      await forceGC();
      expect(rootRef.deref()).toBeUndefined();
      void child1;
      void child2;
    });

    it('should handle rapid create/destroy cycles', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key.startsWith('parent')) {
          const childNum = key.replace('parent', '');
          const child = await resolver.resolve({ self, key: `child${childNum}` }).resPromise;
          return { child };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      for (let i = 0; i < 10; i++) {
        const parent = await resolver.resolve({ key: `parent${i}` }).resPromise;
        // Don't keep reference to parent, allowing GC
      }
      
      await forceGC();
      
      // Should not crash or leak
      const newParent = await resolver.resolve({ key: 'parent0' }).resPromise;
      expect(newParent).toBeDefined();
    });

    it('should prevent collection of nodes in active dependency chain', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'root') {
          const child1 = await resolver.resolve({ self, key: 'level1-1' }).resPromise;
          const child2 = await resolver.resolve({ self, key: 'level1-2' }).resPromise;
          return { child1, child2 };
        }
        if (key.startsWith('level1')) {
          const child = await resolver.resolve({ self, key: `level2-${key.split('-')[1]}` }).resPromise;
          return { child };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const root = await resolver.resolve({ key: 'root' }).resPromise;
      const level2Nodes = [
        await resolver.resolve({ key: 'level2-1' }).resPromise,
        await resolver.resolve({ key: 'level2-2' }).resPromise
      ];
      
      const level2Refs = level2Nodes.map(node => new WeakRef(node));
      
      await forceGC();
      
      // Level 2 nodes should still be alive because root references them through the chain
      level2Refs.forEach(ref => {
        expect(ref.deref()).toBeDefined();
      });
      
      void root; // Keep root alive for the test
    });
  });

  describe('Error Propagation and Recovery', () => {
    it('should propagate errors through dependency chain', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'parent') {
          try {
            await resolver.resolve({ self, key: 'child' }).resPromise;
            return {};
          } catch (error) {
            return { error };
          }
        }
        if (key === 'child') {
          throw new Error('Child build failed');
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const parent = await resolver.resolve({ key: 'parent' }).resPromise;
      expect(parent.error).toBeDefined();
      expect(parent.error).toBeInstanceOf(Error);
    });

    it('should recover after error resolution', async () => {
      let shouldFail = true;
      const fetchMock = async () => {
        if (shouldFail) throw new Error('Temporary failure');
        return { value: 'success' };
      }
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const desc1 = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(desc1.error).toBeDefined();
      
      shouldFail = false;
      resolver.invalidateKey('test');
      
      const desc2 = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 100));
      await desc2.resPromise;
      expect(desc2.error).toBeUndefined();
      expect(desc2.res).toEqual({ value: 'success' });
    });

    it('should handle partial failures in complex graphs', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'root') {
          const [child1, child2, child3] = await Promise.allSettled([
            resolver.resolve({ self, key: 'child1' }).resPromise,
            resolver.resolve({ self, key: 'child2' }).resPromise,
            resolver.resolve({ self, key: 'child3' }).resPromise
          ]);
          return { child1, child2, child3 };
        }
        if (key === 'child2') {
          throw new Error('Child2 failed');
        }
        return { success: true };
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const root = await resolver.resolve({ key: 'root' }).resPromise;
      expect(root.child1.status).toBe('fulfilled');
      expect(root.child2.status).toBe('rejected');
      expect(root.child3.status).toBe('fulfilled');
    });
  });

  describe('Data vs Fetch Priority', () => {
    it('should prefer latest provided data including pending fetch', async () => {
      let resolveFetch1: (value: any) => void;
      let resolveFetch2: (value: any) => void;
      const fetchMock = vi.fn()
        .mockImplementationOnce(() => new Promise(resolve => { resolveFetch1 = resolve; }))
        .mockImplementationOnce(() => new Promise(resolve => { resolveFetch2 = resolve; }));
      
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const desc1 = resolver.resolve({ key: 'test' });
      
      // Provide data while fetch is pending
      const desc2 = resolver.resolve({ key: 'test', data: { value: 'data1' } });
      expect(desc1).toBe(desc2);
      
      resolveFetch1!({ value: 'fetch1' });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Last provided data should win
      expect(desc1.invalidated).toBe(true);
    });

    it('should handle provided data that matches fetch result', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ value: 'same', id: 1 });
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const desc1 = resolver.resolve({ key: 'test' });
      await desc1.resPromise;
      
      // Should not re-fetch on next resolve
      const desc2 = resolver.resolve({ key: 'test', data: { value: 'same', id: 1 } });
      await desc2.resPromise;
      expect(desc1).toBe(desc2);
      expect(fetchMock).toHaveBeenCalledTimes(1); // Data was provided, so fetch never called
    });
  });

  describe('Build Function Edge Cases', () => {
    it('should handle build that returns same reference', async () => {
      const shared = { value: 'shared' };
      const buildMock = vi.fn().mockReturnValue(shared);
      const fetchMock = vi.fn().mockResolvedValue({});
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const desc1 = resolver.resolve({ key: 'test1' });
      const desc2 = resolver.resolve({ key: 'test2' });
      
      await Promise.all([desc1.resPromise, desc2.resPromise]);
      
      expect(desc1.res).toBe(shared);
      expect(desc2.res).toBe(shared);
      expect(desc1.res).toBe(desc2.res);
    });

    it('should handle async build with delayed dependency resolution', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'main') {
          // Simulate work before resolving dependency
          await new Promise(resolve => setTimeout(resolve, 50));
          const dep = await resolver.resolve({ self, key: 'dep' }).resPromise;
          await new Promise(resolve => setTimeout(resolve, 50));
          return { dep };
        }
        return { value: 'dependency' };
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const main = await resolver.resolve({ key: 'main' }).resPromise;
      expect(main.dep).toBeDefined();
      expect(main.dep.value).toBe('dependency');
    });

    it('should handle build with conditional dependencies', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key, data }) => {
        if (key === 'conditional') {
          if (data?.includeDep) {
            const dep = await resolver.resolve({ self, key: 'dep' }).resPromise;
            return { dep, included: true };
          }
          return { included: false };
        }
        return { value: 'dep' };
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const withDep = await resolver.resolve({ 
        key: 'conditional', 
        data: { includeDep: true } 
      }).resPromise;
      expect(withDep.included).toBe(true);
      expect(withDep.dep).toBeDefined();
      
      const withoutDep = await resolver.resolve({ 
        key: 'conditional', 
        data: { includeDep: false } 
      }).resPromise;
      expect(withoutDep.included).toBe(false);
      expect(withoutDep.dep).toBeUndefined();
    });
  });

  describe('Subscription Edge Cases', () => {
    it('should handle multiple subscribers and selective unsubscription', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ value: 'first' })
        .mockResolvedValueOnce({ value: 'second' });
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const subscriber1 = vi.fn();
      const subscriber2 = vi.fn();
      const subscriber3 = vi.fn();
      
      const unsub1 = descriptor.onInvalidate(subscriber1);
      const unsub2 = descriptor.onInvalidate(subscriber2);
      descriptor.onInvalidate(subscriber3);
      
      unsub1();
      unsub2();
      
      resolver.invalidateKey('test');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(subscriber1).not.toHaveBeenCalled();
      expect(subscriber2).not.toHaveBeenCalled();
      expect(subscriber3).toHaveBeenCalled();
    });

    it('should handle subscriber that throws', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ value: 'first' })
        .mockResolvedValueOnce({ value: 'second' });
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const goodSubscriber = vi.fn();
      const badSubscriber = vi.fn().mockImplementation(() => {
        throw new Error('Subscriber error');
      });
      
      descriptor.onInvalidate(goodSubscriber);
      descriptor.onInvalidate(badSubscriber);
      
      // Should not throw
      expect(() => resolver.invalidateKey('test')).not.toThrow();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Good subscriber should still be called
      expect(goodSubscriber).toHaveBeenCalled();
    });

    it('should handle subscription to already invalidated descriptor', async () => {
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      const fetchMock = vi.fn().mockResolvedValue({ value: 'test' });
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      resolver.invalidateKey('test');
      
      const subscriber = vi.fn();
      descriptor.onInvalidate(subscriber);
      
      expect(subscriber).toHaveBeenCalled(); // Should call immediately since already invalidated
    });
  });

  describe('Self-Reference Prevention', () => {
    it('should detect indirect self-reference through intermediate nodes', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'start') {
          const a = await resolver.resolve({ self, key: 'a' }).resPromise;
          return { a };
        }
        if (key === 'a') {
          const b = await resolver.resolve({ self, key: 'b' }).resPromise;
          return { b };
        }
        if (key === 'b') {
          // This creates a reference back to 'start' through the build context
          const start = await resolver.resolve({ self, key: 'start' }).resPromise;
          return { start };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      await expect(async () => {
        await resolver.resolve({ key: 'start' }).resPromise;
      }).rejects.toThrow(DependencyCycleError);
    });

    it('should detect self-reference with parallel resolves', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'parallel') {
          // Try to resolve self in parallel with other work
          const results = await Promise.all([
            resolver.resolve({ self, key: 'parallel' }).resPromise,
            Promise.resolve({ other: 'work' })
          ]);
          return { results };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      await expect(async () => {
        await resolver.resolve({ key: 'parallel' }).resPromise;
      }).rejects.toThrow(SelfReferenceError);
    });
  });

  describe('Invalidation Keys with Special Values', () => {
    it('should handle symbol keys', async () => {
      const symKey = Symbol('test');
      const fetchMock = vi.fn().mockResolvedValue({ value: 'symbol-data' });
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      
      rule = { fetch: fetchMock, build: buildMock } as any;
      resolver = createResolver(rule);
      
      const descriptor = await resolver.resolve({ key: symKey } as any).resPromise;
      expect(descriptor.value).toBe('symbol-data');
      
      resolver.invalidateKey(symKey as any);
      
      const newDescriptor = resolver.resolve({ key: symKey } as any);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(newDescriptor).not.toBe(descriptor);
    });

    it('should handle object keys', async () => {
      const objKey = { id: 1, name: 'test' };
      const fetchMock = vi.fn().mockResolvedValue({ value: 'object-data' });
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      
      rule = { fetch: fetchMock, build: buildMock } as any;
      resolver = createResolver(rule);
      
      const descriptor = await resolver.resolve({ key: objKey } as any).resPromise;
      expect(descriptor.value).toBe('object-data');
      
      // Same object reference should be cached
      const descriptor2 = await resolver.resolve({ key: objKey } as any).resPromise;
      expect(descriptor2).toBe(descriptor);
      
      // Different object (but same value) should be cached
      const differentObj = { name: 'test', id: 1 };
      const descriptor3 = await resolver.resolve({ key: differentObj } as any).resPromise;
      expect(descriptor3).toBe(descriptor);
    });
  });
});

async function forceGC() {
    if (!global.gc) {
        throw new Error("Run with --expose-gc");
    }

    for (let i = 0; i < 20; i++) {
        global.gc();

        // давление на память
        let garbage = Array.from({ length: 100000 }, () => ({
            x: Math.random(),
        }));
        garbage = null as any;

        await new Promise(resolve => setImmediate(resolve));
    }

    global.gc();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setTimeout(resolve,1000));
}
