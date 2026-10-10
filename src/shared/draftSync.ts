/**
 * Decides what an edit form shows after fresh data arrives. The app reloads data in the background all the time,
 * so typing must survive a reload of the same record, but switching to another record must show that record.
 */
export interface DraftMemory {
  id: number | null
  json: string
}

export function nextDraft<T>(prev: DraftMemory, id: number | null, fresh: T | null, current: T | null): { draft: T | null; memory: DraftMemory } {
  const memory: DraftMemory = { id, json: fresh ? JSON.stringify(fresh) : '' }
  const untouched = !current || JSON.stringify(current) === prev.json
  return { draft: prev.id !== id || untouched ? fresh : current, memory }
}
