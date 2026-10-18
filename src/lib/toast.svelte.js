import { TOAST_MS, UNDO_TOAST_MS } from './constants.js'
import { app } from './app.svelte.js'

/** `action` is an optional button shown beside the message, such as Undo. */
export const toast = $state({ message: '', visible: false, action: null })

let hideTimer
let remaining = 0
let scheduledAt = 0
// Timer bookkeeping deliberately stays non-reactive: showing a toast from an effect must not
// make that effect subscribe to hover/focus changes.
const pauses = { pointer: false, focus: false }
const isPaused = () => pauses.pointer || pauses.focus

export function dismissToast() {
  clearTimeout(hideTimer)
  pauses.pointer = pauses.focus = false
  remaining = 0
  toast.visible = false
  toast.action = null
}

function scheduleHide() {
  scheduledAt = Date.now()
  hideTimer = setTimeout(dismissToast, remaining)
}

/** Hover and focus are independent: leaving one must not end the other pause. */
export function pauseToast(reason) {
  if (!toast.visible || !Object.hasOwn(pauses, reason) || pauses[reason]) return
  if (!isPaused()) {
    remaining = Math.max(0, remaining - (Date.now() - scheduledAt))
    clearTimeout(hideTimer)
  }
  pauses[reason] = true
}

export function resumeToast(reason) {
  if (!Object.hasOwn(pauses, reason) || !pauses[reason]) return
  pauses[reason] = false
  if (isPaused() || !toast.visible) return
  scheduleHide()
}

/** @param {{ label: string, run: () => void } | null} [action] */
export function showToast(message, action = null) {
  toast.message = message
  toast.visible = true
  toast.action = action
  clearTimeout(hideTimer)
  remaining = action ? UNDO_TOAST_MS : TOAST_MS
  if (!isPaused()) scheduleHide()
}

/** Run the toast's action once, then close the toast. */
export function runToastAction() {
  const action = toast.action
  dismissToast()
  action?.run()
}

/**
 * Show `message` with an Undo button that puts back `previous`, the app data from before a
 * destructive change. Call it right after the change, so `app.data` is the changed state. Data is
 * replaced, never mutated, so both are complete snapshots; Undo refuses once anything else has
 * changed (another edit, another tab), because restoring `previous` would silently discard it.
 */
export function offerUndo(message, previous) {
  const after = app.data
  showToast(message, {
    label: 'Undo',
    run: () => {
      if (app.data !== after) {
        showToast('Can’t undo: there have been other changes since.')
        return
      }
      app.data = previous
      showToast('Undone.')
    },
  })
}
