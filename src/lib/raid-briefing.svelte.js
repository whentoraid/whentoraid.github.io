import { getRaidBriefings, setRaidBriefing, setRaidWeekNote } from './raid-services.js'
import { supabase } from './remote/client.js'
import { remote } from './remote/sync.svelte.js'

/**
 * M15, online guilds: every raid profile's raid-day briefing and the current week notes. Officers
 * write them; every member reads them. Every change reloads.
 */

export const briefingsOnline = () => Boolean(remote.guildId && supabase)

/** @type {{ guildId: string | null, data: import('./raid-briefing.js').Briefings, error: string }} */
export const briefings = $state({ guildId: null, data: { raids: {}, notes: [] }, error: '' })

let loading = null

export function loadBriefings({ fresh = false } = {}) {
  const guildId = remote.guildId
  if (loading && !fresh) return loading
  const request = getRaidBriefings(supabase, guildId)
    .then((data) => {
      if (loading !== request || guildId !== remote.guildId) return
      Object.assign(briefings, { guildId, data: data ?? { raids: {}, notes: [] }, error: '' })
    })
    .catch((error) => {
      if (loading !== request) return
      // Keep what was on screen; say why it may be out of date.
      briefings.error = error.message
    })
    .finally(() => {
      if (loading === request) loading = null
    })
  loading = request
  return request
}

async function thenReload(request) {
  try {
    return await request
  } finally {
    await loadBriefings({ fresh: true })
  }
}

export const saveBriefing = (raidId, briefing) =>
  thenReload(setRaidBriefing(supabase, remote.guildId, raidId, briefing))

export const saveWeekNote = (weekIso, raidId, note) =>
  thenReload(setRaidWeekNote(supabase, remote.guildId, weekIso, raidId, note))
