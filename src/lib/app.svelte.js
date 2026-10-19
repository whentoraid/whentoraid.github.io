import { pruneOldWeeks, setCurrentWeek } from './model.js'
import { parseHash } from './route.js'
import { loadSaved } from './storage.js'
import { mondayOf, todayIso } from './time.js'
import { setCurrentRaid, DEFAULT_RAID_ID } from './raids.js'

/** The saved guild with stale check-ins pruned, moved to the week named in the URL, if any. */
function initialData(saved, route) {
  if (!saved) return null
  const pruned = pruneOldWeeks(saved, mondayOf(todayIso(saved.guild.timezone)))
  const selected = setCurrentRaid(pruned, route.raid ?? (route.week ? DEFAULT_RAID_ID : pruned.currentRaidId))
  return route.week ? setCurrentWeek(selected, route.week) : selected
}

const saved = loadSaved()
const route = parseHash(globalThis.location?.hash)

/**
 * Shared app state. `data` is replaced, never mutated in place: every change goes
 * through a pure function in lib/ and the result is assigned back.
 * `data` is null until a guild is set up (or the demo guild is loaded); App shows setup then.
 * `unreadable` holds saved text that could not be loaded, so setup can offer it for download.
 */
export const app = $state({
  /** @type {import('./model.js').AppState | null} */
  data: initialData(saved.state, route),
  /** Temporarily show owner setup while keeping a sample guild available for return. */
  showSetup: false,
  view: route.view,
  /**
   * One-time navigation intent, never saved with guild data: 'published' from a personal assignment or
   * roster link, or an officer-dashboard issue's tool (see PlannerIntent in officer-dashboard.js).
   * @type {'published' | import('./officer-dashboard.js').PlannerIntent | null}
   */
  plannerIntent: route.published ? 'published' : null,
  /** The dashboard row an officer left from, so the planner can lead back to it. */
  /** @type {string | null} */
  returnTo: null,
  /** The dashboard row to bring into view on return; Home clears it once shown. */
  /** @type {string | null} */
  dashboardFocus: null,
  /** @type {string | null} */
  unreadable: saved.unreadable,
})
