/**
 * M15: the raid-day briefing's shared rules. The database enforces the same voice-link pattern
 * (20261101120000_raid_briefings.sql): https only, and no characters that would break a Discord
 * masked link or an HTML attribute.
 */
const VOICE_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[^\s<>"()[\]]*)?$/
export const VOICE_URL_MAX = 300

/** A voice link that is safe to show, with the host it opens; null for anything else. */
export function safeVoiceLink(url) {
  const href = String(url ?? '').trim()
  if (!href || href.length > VOICE_URL_MAX || !VOICE_URL.test(href)) return null
  return { href, host: new URL(href).hostname.replace(/^www\./, '') }
}
