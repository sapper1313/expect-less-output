import type { Api } from '@shared/api'

function group(name: string) {
  return new Proxy(
    {},
    {
      get:
        (_t, fn) =>
        (...args: unknown[]) =>
          window.elo.invoke(`${name}.${String(fn)}`, ...args),
    },
  )
}

/** Typed access to every main-process service. Example: await api.brands.list() */
export const api = new Proxy({} as Api, {
  get: (_t, name) => group(String(name)),
})
