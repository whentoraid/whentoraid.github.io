import { slotWindow } from './grid.js'
import { normalize } from './intervals.js'
import { addDays, daysBetween, wallTime, zonedTimeToUtc } from './time.js'

/** Select exact UTC boundaries instead of interpreting ambiguous local wall-clock input. */
export function dayBoundaries(weekIso, day, grid) {
  return [
    ...new Set(
      Array.from(
        { length: grid.slotsPerDay + 1 },
        (_, slot) => slotWindow(weekIso, day, slot, 0, grid).start,
      ),
    ),
  ].sort((a, b) => a - b)
}

export function rangesForDay(ranges, boundaries) {
  const start = boundaries[0]
  const end = boundaries.at(-1)
  return normalize(
    ranges.map((range) => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) })),
  )
}

export function rangeFromSelection(boundaries, start, end) {
  start = Number(start)
  end = Number(end)
  return boundaries.includes(start) && boundaries.includes(end) && end > start ? { start, end } : null
}

/** The editable guild windows, grouped by the actual calendar date in the viewer's chosen zone. */
export function availabilityDays(weekIso, grid, zone = grid.timezone) {
  const windows = normalize(
    Array.from({ length: 7 }, (_, day) => {
      const boundaries = dayBoundaries(weekIso, day, grid)
      return { start: boundaries[0], end: boundaries.at(-1) }
    }),
  )
  const byDate = new Map()
  for (const window of windows) {
    let start = window.start
    while (start < window.end) {
      const dateIso = wallTime(start, zone).dateIso
      const midnight = zonedTimeToUtc(addDays(dateIso, 1), 0, zone)
      const end = Math.min(window.end, midnight)
      if (end <= start) break
      const pieces = byDate.get(dateIso) ?? []
      pieces.push({ start, end })
      byDate.set(dateIso, pieces)
      start = end
    }
  }
  return [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateIso, windows]) => {
      const boundaries = [
        ...new Set(
          windows.flatMap(({ start, end }) => {
            const values = []
            for (let instant = start; instant < end; instant += 30 * 60000) values.push(instant)
            return [...values, end]
          }),
        ),
      ].sort((a, b) => a - b)
      return { dateIso, windows, boundaries }
    })
}

export function rangesInWindows(ranges, windows) {
  return normalize(
    windows.flatMap((window) =>
      ranges.map((range) => ({
        start: Math.max(window.start, range.start),
        end: Math.min(window.end, range.end),
      })),
    ),
  )
}

/** Copy displayed local times while preserving the target's actual editable windows. */
export function copyLocalDay(ranges, from, to, zone) {
  const moved = rangesInWindows(ranges, from.windows).map(({ start, end }) => {
    const move = (instant) => {
      const wall = wallTime(instant, zone)
      return zonedTimeToUtc(to.dateIso, daysBetween(from.dateIso, wall.dateIso) * 1440 + wall.minutes, zone)
    }
    return { start: move(start), end: move(end) }
  })
  return rangesInWindows(moved, to.windows)
}

/** Copy guild wall-clock times, including overnight ranges, without shifting them across DST. */
export function copyRangesToDay(ranges, weekIso, fromDay, toDay, grid) {
  const sourceDate = addDays(weekIso, fromDay)
  const targetDate = addDays(weekIso, toDay)
  const move = (instant) => {
    const wall = wallTime(instant, grid.timezone)
    return zonedTimeToUtc(
      targetDate,
      daysBetween(sourceDate, wall.dateIso) * 1440 + wall.minutes,
      grid.timezone,
    )
  }
  const source = rangesForDay(ranges, dayBoundaries(weekIso, fromDay, grid))
  return rangesForDay(
    source.map(({ start, end }) => ({ start: move(start), end: move(end) })),
    dayBoundaries(weekIso, toDay, grid),
  )
}
