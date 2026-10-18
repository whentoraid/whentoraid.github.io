// Joining guilds from Discord: anyone in a server the WhenToRaid bot was added to becomes a player of
// the guilds linked to it, and an officer if they hold one of the guild's officer roles. The app
// asks Discord with the bot token at sign-in; bot buttons and /raid use the member Discord signed
// into the interaction. join_from_discord in supabase/migrations decides what changes.

const API = 'https://discord.com/api/v10'

/** The name a member shows in a server: nickname, then display name, then username. */
export function discordName(member) {
  return member?.nick || member?.user?.global_name || member?.user?.username || ''
}

/** join_from_discord arguments for the member who sent a Discord interaction, or null outside a server. */
export function interactionJoinArgs(interaction) {
  const member = interaction?.member
  const server = interaction?.guild_id
  if (typeof server !== 'string' || typeof member?.user?.id !== 'string') return null
  return {
    p_server_id: server,
    p_discord_id: member.user.id,
    p_name: discordName(member),
    p_role_ids: Array.isArray(member.roles) ? member.roles : [],
  }
}

/** The player's membership in one server, or null when they (or the bot) are not in it. */
async function serverMember(server, discordId, botToken, fetchFn) {
  const response = await fetchFn(`${API}/guilds/${server}/members/${discordId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  })
  // 404: not in that server. 403: the bot was removed from it.
  if (response.status === 404 || response.status === 403) return null
  if (!response.ok) throw new Error(`Discord returned ${response.status} for server ${server}.`)
  return response.json()
}

/**
 * Join the player to the guilds of every linked server they are in. A server that fails is logged
 * and skipped, so it cannot keep the player out of the others.
 * @param {{ discordId: string, servers: string[], botToken: string,
 *   rpc: (name: string, args: object) => Promise<{ guildIds?: string[] }>,
 *   fetchFn?: typeof fetch, log?: (message: string) => void }} options
 * @returns {Promise<string[]>} ids of guilds that gained the player or made them an officer
 */
export async function joinLinkedServers({
  discordId,
  servers,
  botToken,
  rpc,
  fetchFn = fetch,
  log = () => {},
}) {
  const results = await Promise.allSettled(
    [...new Set(servers)].map(async (server) => {
      const member = await serverMember(server, discordId, botToken, fetchFn)
      if (!member) return []
      const result = await rpc('join_from_discord', {
        p_server_id: server,
        p_discord_id: discordId,
        p_name: discordName(member),
        p_role_ids: Array.isArray(member.roles) ? member.roles : [],
      })
      return result?.guildIds ?? []
    }),
  )
  for (const result of results)
    if (result.status === 'rejected') log(`join failed: ${result.reason?.message}`)
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
}
