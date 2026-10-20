import { app } from './app.svelte.js'
import {
  discordChannel,
  hasDiscordChannel,
  loadDiscordChannel,
  postKey,
  rememberPost,
} from './discord-channel.svelte.js'
import {
  delivery,
  deliveryKey,
  queueAndSend,
  refreshDelivery,
  sendQueued,
  usesServerDelivery,
  watchDelivery,
} from './discord-delivery.svelte.js'
import { deleteFromWebhook, postToWebhook } from './discord-webhook.js'
import { canManage } from './remote/sync.svelte.js'
import { rosterDiscord, rosterMentions, splitForDiscord } from './roster-export.js'
import { showToast } from './toast.svelte.js'

/** A queued or sending post is checked again until it settles (the scheduler may send it). */
const DELIVERY_POLL_MS = 15_000

/**
 * The published roster of the raid on screen in the guild's Discord channel: posting, updating,
 * withdrawing and deleting it. Online guilds queue the work on the server; a browser-only guild
 * posts with the webhook. Call while a component initialises: it watches the raid's delivery.
 * @param {() => { week: string, raidId: string, published: object | undefined, cancelled: boolean,
 *   players: object[] }} current the raid on screen
 * @param {{ officersOnly: () => boolean }} options `officersOnly` refuses (and says so) for players
 */
export function createRosterDiscord(current, { officersOnly }) {
  let posting = $state(false)
  const key = $derived(postKey(current().week, current().raidId))
  const postedIds = $derived(discordChannel.posts[key] ?? [])
  /** Only the raid on screen: a slow reload for another raid never shows here. */
  const shownDelivery = $derived(
    delivery.key === deliveryKey(current().week, current().raidId) ? delivery.latest : null,
  )

  $effect(() => {
    if (canManage()) void loadDiscordChannel()
  })
  $effect(() => {
    if (canManage() && usesServerDelivery() && hasDiscordChannel())
      void watchDelivery(current().week, current().raidId)
  })
  $effect(() => {
    const status = shownDelivery?.status
    if (status !== 'pending' && status !== 'sending') return
    const { week, raidId } = current()
    const timer = setInterval(() => void refreshDelivery(week, raidId), DELIVERY_POLL_MS)
    return () => clearInterval(timer)
  })

  async function serverAction(run) {
    posting = true
    try {
      const message = await run()
      if (message) showToast(message)
    } finally {
      posting = false
    }
  }

  /**
   * Keep a roster already in Discord in step with what was just saved. Online, the save itself
   * queued the edit on the server, so this only asks the worker to send it now.
   */
  async function follow(browserPost) {
    if (!usesServerDelivery()) return browserPost()
    const { week, raidId } = current()
    await serverAction(() => sendQueued(week, raidId))
  }

  /** Post the published roster to the guild's Discord channel, or update the earlier post. */
  async function post() {
    const { week, raidId, published, cancelled, players } = current()
    if (officersOnly() || !published || posting) return
    if (usesServerDelivery()) return serverAction(() => queueAndSend(week, raidId, 'post'))
    const postedKey = key
    const confirmed = { ...published, locked: [], saved: true, cancelled }
    const mentions = discordChannel.mentionPlayers
      ? rosterMentions(app.data, confirmed)
      : { ids: [], line: '' }
    const text = [rosterDiscord(app.data, confirmed, players), mentions.line].filter(Boolean).join('\n\n')
    const previousIds = discordChannel.posts[postedKey] ?? []
    posting = true
    try {
      const ids = await postToWebhook(discordChannel.webhookUrl, splitForDiscord(text), {
        previousIds,
        mentionIds: mentions.ids,
      })
      await rememberPost(postedKey, ids)
      showToast(previousIds.length ? 'Discord post updated.' : 'Roster posted to Discord.')
    } catch (error) {
      showToast(error.message)
    } finally {
      posting = false
    }
  }

  async function remove() {
    if (officersOnly() || posting) return
    const { week, raidId } = current()
    if (usesServerDelivery()) return serverAction(() => queueAndSend(week, raidId, 'delete'))
    const postedKey = key
    posting = true
    try {
      await deleteFromWebhook(discordChannel.webhookUrl, discordChannel.posts[postedKey] ?? [])
      await rememberPost(postedKey, [])
      showToast('Discord post deleted.')
    } catch (error) {
      showToast(error.message)
    } finally {
      posting = false
    }
  }

  async function withdraw() {
    if (posting) return
    posting = true
    try {
      const ids = await postToWebhook(
        discordChannel.webhookUrl,
        [
          '**ROSTER WITHDRAWN**\nThe officers are revising this raid. Check WhenToRaid for the next published roster.',
        ],
        { previousIds: discordChannel.posts[key] ?? [] },
      )
      await rememberPost(key, ids)
      showToast('Discord post updated: roster withdrawn.')
    } catch (error) {
      showToast(error.message)
    } finally {
      posting = false
    }
  }

  return {
    get posting() {
      return posting
    },
    get postedIds() {
      return postedIds
    },
    get delivery() {
      return shownDelivery
    },
    serverAction,
    follow,
    post,
    remove,
    withdraw,
  }
}
