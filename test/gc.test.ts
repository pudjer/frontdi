import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createResolver, DependencyCycleError, SelfReferenceError, ClientRule, Resolver, Descriptor } from '../src';
// Helper to convert ordered JSON stringify for comparison

describe('Resolver', () => {
  let resolver: Resolver<string, any, any>;
  let rule: ClientRule<string, any, any>;
  

  describe('Basic Resolution', () => {
    it('should resolve with fetch when no data provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ value: 'test' });
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: 'test' });
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(fetchMock).toHaveBeenCalledWith('test');
      expect(buildMock).toHaveBeenCalled();
      expect(descriptor.res).toEqual({ value: 'test', built: true });
      expect(descriptor.isPending).toBe(false);
      expect(descriptor.error).toBeUndefined();
    });

    it('should resolve with provided data skipping fetch', async () => {
      const fetchMock = vi.fn();
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: 'test', data: { value: 'provided' } });
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(fetchMock).not.toHaveBeenCalled();
      expect(buildMock).toHaveBeenCalled();
      expect(descriptor.res).toEqual({ value: 'provided', built: true });
    });

    it('should return cached descriptor when resolving same key', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ value: 'test' });
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const desc1 = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Second resolve should return cached descriptor without calling fetch/build
      const desc2 = resolver.resolve({ key: 'test' });
      
      expect(desc1).toBe(desc2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(buildMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Data Change Invalidation', () => {
    it('should invalidate and create new descriptor when data changes', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ value: 'first' })
        .mockResolvedValueOnce({ value: 'second' });
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const desc1 = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Invalidate key to force new fetch
      resolver.invalidateKey('test');
      
      const desc2 = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(desc1).not.toBe(desc2);
      expect(desc1.res).toEqual({ value: 'first', built: true });
      expect(desc2.res).toEqual({ value: 'second', built: true });
    });

    it('should handle pending fetch with provided data', async () => {
      const fetchMock = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ value: 'fetch' }), 100))
      );
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      // Start fetch
      const desc1 = resolver.resolve({ key: 'test' });
      expect(desc1.isPending).toBe(true);
      
      // Immediately provide data - should use provided data but keep same descriptor
      const desc2 = resolver.resolve({ key: 'test', data: { value: 'provided' } });
      expect(desc1).toBe(desc2);
      expect(desc2.isPending).toBe(true);
      

      // Complete pending fetch
      await new Promise(resolve => setTimeout(resolve, 400));

      const desc3 = resolver.resolve({ key: 'test' })
      await desc3.resPromise;
      
      // Provided data should win, fetch result ignored
      expect(desc3.res).toEqual({ value: 'fetch', built: true });
      expect(desc3).not.toBe(desc2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(buildMock).toHaveBeenCalledTimes(2);
    });

    it('should invalidate when data differs from fetch result', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ value: 'fetch' });
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      // First resolve with fetch
      const desc1 = resolver.resolve({ key: 'test' });
      await desc1.resPromise;
      
      // Then resolve with different data - should create new descriptor
      const desc2 = resolver.resolve({ key: 'test', data: { value: 'provided' } });
      await desc2.resPromise;

      expect(desc1).not.toBe(desc2);
      expect(desc1.res).toEqual({ value: 'fetch', built: true });
      expect(desc2.res).toEqual({ value: 'provided', built: true });
    });
  });

  describe('Dependency Tracking with self', () => {
    it('should track child dependencies via self in build', async () => {
      const fetchMock = vi.fn().mockResolvedValue({});
      const buildMock = vi.fn().mockImplementation(({ self, data, key }) => {
        if (key === 'parent') {
          // Pass self to resolve for dependency tracking
          const child = resolver.resolve({ self, key: 'child' });
          return { child };
        }
        return {};
      });
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const parent = await resolver.resolve({ key: 'parent' }).resPromise;
      
      // Parent should have strong reference to child
      expect(parent.child).toBeDefined();
    });

    it('should invalidate parent when child invalidates', async () => {
      let parentDescriptor: Descriptor<any>;
      
      const fetchMock = vi.fn().mockResolvedValue({});
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'parent') {
          parentDescriptor = self;
          // Pass self to resolve for dependency tracking
          const child = await resolver.resolve({ self, key: 'child' });
          return { child };
        }
        return {};
      });
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const parent = resolver.resolve({ key: 'parent' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Child should be cached
      const child = resolver.resolve({ key: 'child' });
      
      // Invalidate child
      resolver.invalidateKey('child');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Parent should be invalidated
      expect(parent.invalidated).toBe(true);
    });

    it('should propagate invalidation through dependency chain', async () => {
      const buildMock = vi.fn().mockImplementation( async ({ self, key }) => {
        if (key === 'grandparent') {
          const parent = await resolver.resolve({ self, key: 'parent' }).resPromise;
          return { parent };
        }
        if (key === 'parent') {
          const child = await resolver.resolve({ self, key: 'child' }).resPromise;
          return { child };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const grandparent = resolver.resolve({ key: 'grandparent' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Invalidate child
      resolver.invalidateKey('child');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // All ancestors should be invalidated
      expect(grandparent.invalidated).toBe(true);
    });

    it('should not call fetch/build on subsequent resolves of same key', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ value: 'test' });
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      // First resolve
      const desc1 = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Second resolve should return cached
      const desc2 = resolver.resolve({ key: 'test' });
      expect(desc1).toBe(desc2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(buildMock).toHaveBeenCalledTimes(1);
      
      // Invalidate
      resolver.invalidateKey('test');
      
      // Third resolve should call fetch/build again
      const desc3 = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(desc1).not.toBe(desc3);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(buildMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Garbage Collection', () => {
    it('should collect parent when no external references exist', async () => {
      const fetchMock = vi.fn().mockResolvedValue({});
      const buildMock = vi.fn().mockImplementation(({ self }) => ({a: 1}));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      let parent = await resolver.resolve({ key: 'parent' }).resPromise;

      const parentRef = new WeakRef(parent);
      parent = undefined as any;
      fetchMock.mockClear();
      buildMock.mockClear();
      await forceGC();
      expect(parentRef.deref()).toBeUndefined();
    });

    it('should keep child alive while parent exists', async () => {
      const buildMock = vi.fn().mockImplementation( async ({ self, key }) => {
        if (key === 'parent') {
          const child = await resolver.resolve({ self, key: 'child' }).resPromise;
          return {};
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const parent = await resolver.resolve({ key: 'parent' }).resPromise;
      
      // Get child reference
      let child = await resolver.resolve({ key: 'child' }).resPromise;
      const childRef = new WeakRef(child);
      child = undefined as any;
      // Try to collect child
      buildMock.mockClear();
      await forceGC();
      
      // Child should still be alive because parent references it strongly
      expect(childRef.deref()).toBeDefined();
      void parent;
    });

    it('should collect child when all parents are collected', async () => {
      const buildMock = vi.fn().mockImplementation( async ({ self, key }) => {
        if (key === 'parent1' || key === 'parent2') {
          const child = await resolver.resolve({ self, key: 'child' }).resPromise;
          return { child };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      let parent1 = await resolver.resolve({ key: 'parent1' }).resPromise;
      let parent2 = await resolver.resolve({ key: 'parent2' }).resPromise;
      
      let child = await resolver.resolve({ key: 'child' }).resPromise;
      const childRef = new WeakRef(child);
      child = undefined as any;

      // Remove external references to parents
      parent1 = undefined as any;
      parent2 = undefined as any;
      buildMock.mockClear();
      
      await forceGC();
      
      // Child should be collected since all parents are gone
      expect(childRef.deref()).toBeUndefined();
    });

    it('should keep child alive if at least one parent references it', async () => {
      const buildMock = vi.fn().mockImplementation( async ({ self, key }) => {
        if (key === 'parent1' || key === 'parent2') {
          const child = await resolver.resolve({ self, key: 'child' }).resPromise;
          return { };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      let parent1 = resolver.resolve({ key: 'parent1' });
      let parent2 = resolver.resolve({ key: 'parent2' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const child = resolver.resolve({ key: 'child' });
      const childRef = new WeakRef(child);
      
      // Remove only one parent
      parent2 = undefined as any;
      buildMock.mockClear();
      
      await forceGC();
      
      // Child should still be alive because parent1 still references it
      expect(childRef.deref()).toBeDefined();
    });

    it('should collect parents', async () => {
      
      rule = { fetch: ()=>undefined, build: async ({ self, key }) => {
        if (key === 'parent1' || key === 'parent2') {
          const child = await resolver.resolve({ self, key: 'child' }).resPromise;
          return { child, isParentGad: "parent-strongly-referenced" };
        }
        return {};
      } };
      resolver = createResolver(rule);
      
      let parent1 = await resolver.resolve({ key: 'parent1' }).resPromise;
      let parent2 = await resolver.resolve({ key: 'parent2' }).resPromise;
      const parent1Ref = new WeakRef(parent1);
      const parent2Ref = new WeakRef(parent2);
      const child = await resolver.resolve({ key: 'child' }).resPromise;

      parent1 = undefined as any;
      parent2 = undefined as any;

      
      await forceGC();
      // Child should be collected since all parents are gone
      expect(parent1Ref.deref()).toBeUndefined();
      expect(parent2Ref.deref()).toBeUndefined();
      void child;
    });
  });

  describe('Cycle Detection', () => {
    it('should detect self-reference', async () => {
      const buildMock = vi.fn().mockImplementation( async ({ self, key }) => {
        if (key === 'self') {
          // This should trigger SelfReferenceError
          const selfRef = await resolver.resolve({ self, key: 'self' }).resPromise;
          return { self: selfRef };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      // For async functions that throw
      await expect(async () => {
        await resolver.resolve({ key: 'self' }).resPromise;
      }).rejects.toThrow(SelfReferenceError);
    });

    it('should detect dependency cycles', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        if (key === 'a') {
          const b = await resolver.resolve({ self, key: 'b' }).resPromise;
          return { b };
        }
        if (key === 'b') {
          const c = await resolver.resolve({ self, key: 'c' }).resPromise;
          return { c };
        }
        if (key === 'c') {
          const a = await resolver.resolve({ self, key: 'a' }).resPromise;
          return { a };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      await expect(async () => {
        await resolver.resolve({ key: 'a' }).resPromise;
      }).rejects.toThrow(DependencyCycleError);
    });
  });

  describe('Error Handling', () => {
    it('should store fetch errors in descriptor', async () => {
      const error = new Error('Fetch failed');
      const fetchMock = vi.fn().mockRejectedValue(error);
      const buildMock = vi.fn();
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(descriptor.error).toBe(error);
      expect(descriptor.isPending).toBe(false);
      expect(descriptor.res).toBeUndefined();
      expect(fetchMock).toHaveBeenCalled();
      expect(buildMock).not.toHaveBeenCalled();
    });

    it('should store build errors in descriptor', async () => {
      const error = new Error('Build failed');
      const buildMock = vi.fn().mockImplementation(() => {
        throw error;
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(descriptor.error).toBe(error);
      expect(descriptor.isPending).toBe(false);
      expect(descriptor.res).toBeUndefined();
    });
  });

  describe('Subscription and Invalidation', () => {
    it('should call onInvalidate when descriptor becomes invalid', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ value: 'first' })
        .mockResolvedValueOnce({ value: 'second' });
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const subscriber = vi.fn();
      descriptor.onInvalidate(subscriber);
      
      // Invalidate to trigger
      resolver.invalidateKey('test');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(subscriber).toHaveBeenCalled();
    });

    it('should allow unsubscribe', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ value: 'first' })
        .mockResolvedValueOnce({ value: 'second' });
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const subscriber = vi.fn();
      const unsubscribe = descriptor.onInvalidate(subscriber);
      
      unsubscribe();
      
      resolver.invalidateKey('test');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(subscriber).not.toHaveBeenCalled();
    });

    it('should call onInvalidate when child invalidates', async () => {
      const buildMock = vi.fn().mockImplementation( async ({ self, key }) => {
        if (key === 'parent') {
          const child = await resolver.resolve({ self, key: 'child' }).resPromise;
          return { child };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const parent = resolver.resolve({ key: 'parent' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const subscriber = vi.fn();
      parent.onInvalidate(subscriber);
      
      // Invalidate child
      resolver.invalidateKey('child');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(subscriber).toHaveBeenCalled();
    });
  });

  describe('Concurrent Resolution', () => {
    it('should handle concurrent resolves for same key', async () => {
      let resolveFetch: (value: any) => void;
      const fetchMock = vi.fn().mockImplementation(() => 
        new Promise(resolve => {
          resolveFetch = resolve;
        })
      );
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const desc1 = resolver.resolve({ key: 'test' });
      const desc2 = resolver.resolve({ key: 'test' });
      
      // Should return the same descriptor
      expect(desc1).toBe(desc2);
      expect(desc1.isPending).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      
      resolveFetch!({ value: 'result' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(desc1.res).toEqual({ value: 'result', built: true });
      expect(desc1.isPending).toBe(false);
      expect(buildMock).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent resolves with data provided after fetch started', async () => {
      let resolveFetch: (value: any) => void;
      const fetchMock = vi.fn().mockImplementation(() => 
        new Promise(resolve => {
          resolveFetch = resolve;
        })
      );
      const buildMock = vi.fn().mockImplementation(({ data }) => ({ ...data, built: true }));
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const desc1 = resolver.resolve({ key: 'test' });
      expect(desc1.isPending).toBe(true);
      
      // Provide data while fetch is pending
      const desc2 = resolver.resolve({ key: 'test', data: { value: 'provided' } });
      expect(desc1).toBe(desc2);
      expect(desc1.isPending).toBe(true);
      
      resolveFetch!({ value: 'fetch' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Provided data should win
      expect(desc1.res).toEqual({ value: 'provided', built: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(buildMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined keys', async () => {
      const fetchMock = vi.fn().mockResolvedValue({});
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: null as any });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(fetchMock).toHaveBeenCalledWith(null);
      expect(descriptor.res).toBeDefined();
    });

    it('should handle circular references in data', async () => {
      const circular: any = {};
      circular.self = circular;
      
      const fetchMock = vi.fn().mockResolvedValue(circular);
      const buildMock = vi.fn().mockImplementation(({ data }) => data);
      
      rule = { fetch: fetchMock, build: buildMock };
      resolver = createResolver(rule);
      
      const descriptor = resolver.resolve({ key: 'test' });
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(descriptor.res).toBe(circular);
      expect(descriptor.res.self).toBe(circular);
    });

    it('should handle deeply nested dependencies', async () => {
      const buildMock = vi.fn().mockImplementation(async ({ self, key }) => {
        const depth = parseInt(key.split('-')[1]);
        if (depth < 11) {
          const child = await resolver.resolve({ self, key: `child-${depth + 1}` }).resPromise;
          return { child };
        }
        return {};
      });
      
      rule = { fetch: vi.fn().mockResolvedValue({}), build: buildMock };
      resolver = createResolver(rule);
      
      const root = resolver.resolve({ key: 'child-0' });
      await root.resPromise;
      
      expect(root.res).toBeDefined();
      
      // Invalidate deepest child
      resolver.invalidateKey('child-10');
      // Root should be invalidated
      expect(root.invalidated).toBe(true);
    });
  });
});

// Helper functions
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
