/** Presentation only: these preferences never change a check-in, identity, or shared route. */
const OPTIONS = { editor: ['grid', 'ranges'], section: ['times', 'characters'] }
const PREFIX = 'whentoraid-availability-view:'

export function availabilityPreferenceScope(state, remote) {
  return JSON.stringify(
    remote.guildId
      ? ['online', remote.guildId, remote.memberId]
      : ['browser', state.guild.name, state.currentMemberId],
  )
}

export function readAvailabilityPreferences(scope, defaults) {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFIX + scope) ?? '{}')
    return Object.fromEntries(
      Object.entries(OPTIONS).map(([key, values]) => [
        key,
        values.includes(saved?.[key]) ? saved[key] : defaults[key],
      ]),
    )
  } catch {
    return { ...defaults }
  }
}

export function saveAvailabilityPreference(scope, key, value) {
  if (!Object.hasOwn(OPTIONS, key) || !OPTIONS[key].includes(value)) return
  const preferences = readAvailabilityPreferences(scope, {})
  try {
    localStorage.setItem(PREFIX + scope, JSON.stringify({ ...preferences, [key]: value }))
  } catch {
    // The selected view still works when browser storage is blocked or full.
  }
}
