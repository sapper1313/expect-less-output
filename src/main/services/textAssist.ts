/** Future hook for a local LLM (Ollama or LM Studio). Only the `none` provider exists today. */
export interface TextAssistProvider {
  readonly id: string
  readonly available: boolean
  suggestTitle(input: { brand: string; context: string }): Promise<string[]>
  suggestCaption(input: { brand: string; title: string }): Promise<string[]>
  suggestHashtags(input: { brand: string; title: string }): Promise<string[]>
}

export const noneProvider: TextAssistProvider = {
  id: 'none',
  available: false,
  async suggestTitle() {
    return []
  },
  async suggestCaption() {
    return []
  },
  async suggestHashtags() {
    return []
  },
}
