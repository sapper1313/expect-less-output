import type {
  Account,
  AppEvent,
  AppInfo,
  Brand,
  BrandDefaults,
  BrandSlot,
  HashtagSet,
  LogEntry,
  LogFilter,
  MediaInspection,
  Platform,
  Post,
  PostFilter,
  PostInput,
  PostUpdate,
  SchedulerStatus,
  SecretStatus,
  Settings,
} from './types'

export interface Api {
  app: {
    info(): Promise<AppInfo>
    quit(): Promise<void>
    openMediaRoot(): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    pickMediaRoot(): Promise<string | null>
  }
  secrets: {
    status(keys: string[]): Promise<SecretStatus[]>
    set(key: string, value: string): Promise<void>
    remove(key: string): Promise<void>
  }
  brands: {
    list(includeArchived?: boolean): Promise<Brand[]>
    create(name: string, color: string): Promise<Brand>
    update(id: number, patch: { name?: string; color?: string }): Promise<Brand>
    archive(id: number, archived: boolean): Promise<void>
    getSlots(brandId: number): Promise<BrandSlot[]>
    setSlots(
      brandId: number,
      slots: Array<Pick<BrandSlot, 'dayType' | 'timeLocal' | 'enabled'>>,
    ): Promise<BrandSlot[]>
    getDefaults(brandId: number): Promise<BrandDefaults>
    setDefaults(defaults: BrandDefaults): Promise<BrandDefaults>
  }
  hashtags: {
    list(brandId?: number | null): Promise<HashtagSet[]>
    save(set: Omit<HashtagSet, 'id'> & { id?: number }): Promise<HashtagSet>
    remove(id: number): Promise<void>
  }
  accounts: {
    list(brandId?: number): Promise<Account[]>
  }
  media: {
    pickVideos(multiple: boolean): Promise<string[]>
    inspect(path: string): Promise<MediaInspection>
  }
  slots: {
    next(brandId: number, count: number, fromUtc?: string): Promise<string[]>
    countOnDay(brandId: number, dayIso: string): Promise<number>
  }
  posts: {
    list(filter?: PostFilter): Promise<Post[]>
    get(id: number): Promise<Post | null>
    create(input: PostInput): Promise<Post>
    createMany(inputs: PostInput[]): Promise<Post[]>
    update(id: number, patch: PostUpdate): Promise<Post>
    reschedule(ids: number[], scheduledAtUtc: string): Promise<void>
    cancel(ids: number[]): Promise<void>
    remove(ids: number[], alsoDeleteFile: boolean): Promise<void>
    retryTarget(targetId: number): Promise<void>
    postNow(id: number): Promise<void>
  }
  log: {
    list(filter?: LogFilter): Promise<LogEntry[]>
  }
  scheduler: {
    status(): Promise<SchedulerStatus>
    pause(): Promise<void>
    resume(): Promise<void>
    simulateFailure(platform: Platform | null, kind?: 'transient' | 'permanent'): Promise<void>
  }
  textAssist: {
    available(): Promise<boolean>
  }
}

export type EloBridge = {
  invoke(name: string, ...args: unknown[]): Promise<unknown>
  on(callback: (event: AppEvent) => void): () => void
  pathForFile(file: File): string
}
