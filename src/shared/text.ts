/** "my_cool-video.final.mp4" becomes "My Cool Video Final". */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  return base
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export function applyCaptionTemplate(
  template: string,
  vars: { title: string; hashtags: string; brand: string },
): string {
  return template
    .replaceAll('{title}', vars.title)
    .replaceAll('{hashtags}', vars.hashtags)
    .replaceAll('{brand}', vars.brand)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function sanitizeFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Brand'
}
