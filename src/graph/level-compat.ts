/**
 * Compatibility layer between abstract-level (promise-based) and
 * LevelGraph (callback-based).
 *
 * abstract-level (used by ClassicLevel and MemoryLevel) returns promises
 * from all async methods. LevelGraph v4 expects callback-based APIs
 * (specifically via level-ws and level-read-stream). This module wraps
 * an abstract-level instance with a Proxy that detects trailing callback
 * arguments and converts promise resolution/rejection into callback
 * invocations.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLevel = any;

const CALLBACK_METHODS = new Set([
  'batch', 'get', 'put', 'del', 'close', 'open',
]);

/**
 * Wraps an abstract-level database so that methods accepting an optional
 * trailing callback will invoke it when the underlying promise settles.
 */
export function wrapForCallbacks(db: AnyLevel): AnyLevel {
  return new Proxy(db, {
    get(target: AnyLevel, prop: string | symbol, receiver: AnyLevel) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== 'function') return original;

      const name = typeof prop === 'string' ? prop : '';

      if (CALLBACK_METHODS.has(name)) {
        return function callbackWrapper(this: AnyLevel, ...args: unknown[]) {
          const lastArg = args[args.length - 1];
          if (typeof lastArg === 'function') {
            const cb = lastArg as (err: Error | null, val?: unknown) => void;
            const realArgs = args.slice(0, -1);
            const result = original.apply(target, realArgs);
            if (result && typeof result.then === 'function') {
              result.then(
                (val: unknown) => cb(null, val),
                (err: Error) => cb(err),
              );
              return undefined;
            }
            return result;
          }
          return original.apply(target, args);
        };
      }

      // Bind all other methods to the target so `this` is correct
      return original.bind(target);
    },
  });
}
