/** Lossless Discord list pagination. Never cut a player's name or replace entries with "N more". */
export function listFields(name, items, { inline = false, joiner = '\n' } = {}) {
  const values = []
  let value = ''
  for (const item of items) {
    if (item.length > 1024) throw new Error('A roster entry exceeds the Discord field limit.')
    if (value && value.length + joiner.length + item.length > 1024) {
      values.push(value)
      value = ''
    }
    value += (value ? joiner : '') + item
  }
  values.push(value || 'None')
  return values.map((text, index) => ({ name: index ? `${name} (continued)` : name, value: text, inline }))
}

const BLANK = '​'
const ROW_BREAK = { name: BLANK, value: BLANK, inline: false }

/**
 * Lists two to a row (Tanks | Healers, Melee | Ranged). Discord gives a pair of inline fields half the
 * width each; a blank full-width field ends the row. Continuations stay under their own column, and an
 * odd list out keeps the full width.
 */
export function columnFields(sections) {
  const fields = []
  for (let i = 0; i < sections.length; i += 2) {
    const row = sections.slice(i, i + 2)
    if (row.length === 1) {
      fields.push(...listFields(row[0].name, row[0].items, row[0].options))
      continue
    }
    const [left, right] = row.map(({ name, items, options }) =>
      listFields(name, items, { ...options, inline: true }),
    )
    const blank = { name: BLANK, value: BLANK, inline: true }
    for (let line = 0; line < Math.max(left.length, right.length); line++) {
      if (fields.length) fields.push(ROW_BREAK)
      fields.push(left[line] ?? blank, right[line] ?? blank)
    }
  }
  return fields
}

/** Leave room for a title, description, footer and author within Discord's 6000-character limit. */
export function fieldPages(fields, budget = 4600) {
  const pages = [[]]
  let used = 0
  for (const field of fields) {
    const size = field.name.length + field.value.length
    if (size > budget) throw new Error('A roster field exceeds the Discord page limit.')
    if (used + size > budget || pages.at(-1).length === 25) {
      pages.push([])
      used = 0
    }
    pages.at(-1).push(field)
    used += size
  }
  return pages
}
