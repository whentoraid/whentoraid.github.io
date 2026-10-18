import {
  listRaidOffers,
  listRaidStandby,
  offerRaidPlace,
  respondToRaidOffer,
  setRaidStandby,
  withdrawRaidOffer,
} from './raid-services.js'
import { supabase } from './remote/client.js'
import { remote } from './remote/sync.svelte.js'

/**
 * Online guilds: each loaded week's standby players and place offers. They live on the server
 * outside guild sync, so every change here reloads the week.
 */

export const standbyOnline = () => Boolean(remote.guildId && supabase)

/** Loaded weeks by guild and week: `{ standby, offers, error }`. */
export const standbyWeeks = $state({})
const weekKey = (week) => JSON.stringify([remote.guildId, week])
/** Requests in flight, so several raids in one week share one load. */
const loading = {}

export const standbyWeek = (week) => standbyWeeks[weekKey(week)] ?? null

/** `fresh` skips a load already in flight, which may have started before a change. */
export function loadStandbyWeek(week, { fresh = false } = {}) {
  const key = weekKey(week)
  if (loading[key] && !fresh) return loading[key]
  const request = Promise.all([
    listRaidStandby(supabase, remote.guildId, week),
    listRaidOffers(supabase, remote.guildId, week),
  ])
    .then(([standby, offers]) => {
      // A newer load supersedes this one.
      if (loading[key] !== request) return
      standbyWeeks[key] = { standby: standby ?? [], offers: offers ?? [], error: '' }
    })
    .catch((error) => {
      if (loading[key] !== request) return
      // Keep what was on screen; say why it may be out of date.
      const previous = standbyWeeks[key] ?? { standby: [], offers: [] }
      standbyWeeks[key] = { ...previous, error: error.message }
    })
    .finally(() => {
      if (loading[key] === request) delete loading[key]
    })
  loading[key] = request
  return request
}

async function thenReload(week, request) {
  try {
    return await request
  } finally {
    await loadStandbyWeek(week, { fresh: true })
  }
}

export const setStandby = (week, { raidId, on, characterId, untilMs }) =>
  thenReload(week, setRaidStandby(supabase, remote.guildId, { week, raidId, on, characterId, untilMs }))

export const offerPlace = (week, offer) =>
  thenReload(week, offerRaidPlace(supabase, remote.guildId, { week, ...offer }))

export const withdrawOffer = (week, offerId) =>
  thenReload(week, withdrawRaidOffer(supabase, remote.guildId, offerId))

export const answerOffer = (week, offerId, accept) =>
  thenReload(week, respondToRaidOffer(supabase, remote.guildId, offerId, accept))
