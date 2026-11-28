import type { VentureProvider } from '@shared/ventures'

/** The list of storefronts. Adding one later means registering one more provider here. */
export class VentureRegistry {
  private map = new Map<string, VentureProvider>()

  register(p: VentureProvider): void {
    if (this.map.has(p.id)) throw new Error(`Storefront "${p.id}" is already registered.`)
    this.map.set(p.id, p)
  }

  list(): Array<{ id: string; label: string }> {
    return [...this.map.values()].map((p) => ({ id: p.id, label: p.label }))
  }

  get(id: string): VentureProvider | undefined {
    return this.map.get(id)
  }
}
