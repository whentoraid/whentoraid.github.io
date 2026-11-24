import { checkinsClosed } from './checkins.js'
import { announcedRaids } from './raid-answers.js'
import { addDays, mondayOf, todayIso } from './time.js'

const PREFIX = 'whentoraid-raider-tutorial:'

/** Keep tutorial progress private to this browser, guild and member. */
export function readTutorial(scope) {
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + scope))
    if (['active', 'paused', 'complete'].includes(value?.status) && [0, 1, 2].includes(value.step))
      return value
  } catch {
    // The tutorial works without browser storage.
  }
  return { status: 'new', step: 0 }
}

export function saveTutorial(scope, status, step) {
  try {
    localStorage.setItem(PREFIX + scope, JSON.stringify({ status, step }))
  } catch {
    // Saved characters and answers use the app's normal save path independently.
  }
}

/** Direct raid answers remain open after the weekly deadline. Otherwise start in an open week. */
export function tutorialWeek(state, now = Date.now()) {
  const week = mondayOf(todayIso(state.guild.timezone, now))
  if (announcedRaids(state, week).some((item) => item.start > now)) return week
  return checkinsClosed(state, week, now) ? addDays(week, 7) : week
}
