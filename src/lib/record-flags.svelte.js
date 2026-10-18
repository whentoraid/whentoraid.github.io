import { flagRaidRecord, listRaidRecordFlags, resolveRaidRecordFlag } from './raid-services.js'
import { supabase } from './remote/client.js'
import { remote } from './remote/sync.svelte.js'

/**
 * M08, online guilds: corrections players asked for on their raid record. Officers load everyone's,
 * a player only their own (the server decides). Every change reloads the list.
 */

export const recordFlagsOnline = () => Boolean(remote.guildId && supabase)

/** The loaded guild's flags, newest first. */
export const recordFlags = $state({ guildId: null, rows: [], error: '' })

let loading = null

export function loadRecordFlags({ fresh = false } = {}) {
  const guildId = remote.guildId
  if (loading && !fresh) return loading
  const request = listRaidRecordFlags(supabase, guildId)
    .then((rows) => {
      if (loading !== request || guildId !== remote.guildId) return
      Object.assign(recordFlags, { guildId, rows: rows ?? [], error: '' })
    })
    .catch((error) => {
      if (loading !== request) return
      // Keep what was on screen; say why it may be out of date.
      recordFlags.error = error.message
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
    await loadRecordFlags({ fresh: true })
  }
}

export const flagRecord = (week, raidId, note) =>
  thenReload(flagRaidRecord(supabase, remote.guildId, week, raidId, note))

export const resolveFlag = (id, reply) =>
  thenReload(resolveRaidRecordFlag(supabase, remote.guildId, id, reply))
