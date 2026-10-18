import { app } from './app.svelte.js'
import { charactersOf } from './model.js'
import { showToast } from './toast.svelte.js'

/** A player who just joined starts with their first character, then availability, however they joined. */
export function welcomeNewMember(guildName) {
  const hasCharacter = Boolean(app.data) && charactersOf(app.data, app.data.currentMemberId).length > 0
  app.view = hasCharacter ? 'availability' : 'characters'
  showToast(
    `Welcome to ${guildName}! ${hasCharacter ? 'Your characters are ready. Set your availability next.' : 'Add your first character, then set your availability.'}`,
  )
}
