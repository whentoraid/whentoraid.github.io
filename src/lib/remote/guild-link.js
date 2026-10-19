/**
 * Whether the address names an online guild, as the links in Discord posts and replies do
 * (`?guild=<id>`). Such a link is never meant for the guild saved in this browser.
 * @param {string} [search]
 */
export function hasGuildLink(search = globalThis.location?.search ?? '') {
  return /[?&]guild=[0-9a-f-]{36}(?:&|$)/i.test(search)
}
