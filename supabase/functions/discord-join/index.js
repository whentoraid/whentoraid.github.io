// Joining guilds from the app: at sign-in, the player's Discord account is looked up in every server
// the WhenToRaid bot was added to, and they join the guilds linked to the servers they are in.
// Any signed-in player may call it; it only ever adds the caller. Needs DISCORD_BOT_TOKEN.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { joinLinkedServers } from '../_shared/discord-join.js'
import { serverErrorReporter } from '../_shared/report-error.js'

const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})
const log = serverErrorReporter(admin, 'discord-join')
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

/** The caller's Discord user ID, checked with their own JWT, or null. */
async function callerDiscordId(request) {
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return null
  const asUser = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  })
  const { data, error } = await asUser.rpc('my_discord_id')
  return !error && typeof data === 'string' ? data : null
}

async function rpc(name, args) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const discordId = await callerDiscordId(request)
  if (!discordId) return json({ error: 'Sign in with Discord first.' }, 401)
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN') ?? ''
  if (!botToken)
    return json({ error: 'The Discord bot is not ready. Ask the guild owner to check the connection.' }, 503)
  const { data, error } = await admin.from('guild_discord_servers').select('server_id')
  if (error) {
    console.error('discord-join failed:', error.message)
    return json({ error: 'Your Discord servers could not be checked. Try again shortly.' }, 503)
  }
  let failed = false
  const guildIds = await joinLinkedServers({
    discordId,
    servers: data.map((row) => row.server_id),
    botToken,
    rpc,
    log: (message) => {
      failed = true
      log(message)
    },
  })
  if (failed && !guildIds.length)
    return json({ error: 'Discord could not check every connected server. Try again shortly.' }, 503)
  return json({ guildIds })
})
