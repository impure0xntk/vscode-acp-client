/**
 * Mutable reference container for breaking circular constructor dependencies.
 * Modules accept Ref<T> instead of T, and the orchestrator updates the
 * reference after all modules are constructed — no `as any` needed.
 */
export class Ref<T> {
  constructor(public value: T) {}
}
