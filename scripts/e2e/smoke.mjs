import { launch, shot, nav, invoke } from './lib.mjs'

const { app, page, data } = await launch()
console.log('data dir', data)
await page.waitForTimeout(1500)
await shot(page, '01-calendar-empty')
const brands = await invoke(page, 'brands.list')
console.log('brands:', brands.map((b) => b.name).join(' | '))
for (const [label, name] of [
  ['Brands', '02-brands'],
  ['New Post', '03-newpost'],
  ['Bulk Upload', '04-bulk'],
  ['Queue', '05-queue'],
  ['Settings', '06-settings'],
  ['Activity Log', '07-activity'],
  ['Connections', '08-connections'],
]) {
  await nav(page, label)
  await shot(page, name)
}
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await app.close()
console.log('page errors:', errors)
