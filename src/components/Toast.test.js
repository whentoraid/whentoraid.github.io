import { fireEvent, render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { tick } from 'svelte'
import Toast from './Toast.svelte'
import { dismissToast, showToast, toast } from '../lib/toast.svelte.js'
import { UNDO_TOAST_MS } from '../lib/constants.js'

beforeEach(() => {
  vi.useFakeTimers()
  dismissToast()
})
afterEach(() => {
  cleanup()
  dismissToast()
  vi.useRealTimers()
})

test('Undo stays available while hovered or focused and resumes only after both leave', async () => {
  const undo = vi.fn()
  showToast('Availability updated.', { label: 'Undo', run: undo })
  const { container } = render(Toast)
  const notice = container.querySelector('#toast')
  const button = screen.getByRole('button', { name: 'Undo' })
  vi.advanceTimersByTime(UNDO_TOAST_MS - 100)
  await fireEvent.pointerEnter(notice)
  await fireEvent.focusIn(button)
  vi.advanceTimersByTime(UNDO_TOAST_MS * 2)
  await tick()
  expect(toast.visible).toBe(true)
  await fireEvent.pointerLeave(notice)
  vi.advanceTimersByTime(UNDO_TOAST_MS)
  expect(toast.visible).toBe(true)
  await fireEvent.focusOut(button, { relatedTarget: document.body })
  vi.advanceTimersByTime(99)
  expect(toast.visible).toBe(true)
  vi.advanceTimersByTime(1)
  expect(toast.visible).toBe(false)
  expect(undo).not.toHaveBeenCalled()
})

test('dismissing does not run Undo, and the next notification gets its own timer', async () => {
  const undo = vi.fn()
  showToast('Updated.', { label: 'Undo', run: undo })
  const { container } = render(Toast)
  await fireEvent.pointerEnter(container.querySelector('#toast'))
  await fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
  expect(undo).not.toHaveBeenCalled()
  expect(toast.visible).toBe(false)
  showToast('Another edit.', { label: 'Undo', run: undo })
  vi.advanceTimersByTime(UNDO_TOAST_MS)
  expect(toast.visible).toBe(false)
})

test('Undo still runs once while the notification is paused', async () => {
  const undo = vi.fn()
  showToast('Updated.', { label: 'Undo', run: undo })
  render(Toast)
  await fireEvent.focusIn(screen.getByRole('button', { name: 'Undo' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  vi.advanceTimersByTime(UNDO_TOAST_MS * 2)
  expect(undo).toHaveBeenCalledTimes(1)
  expect(toast.visible).toBe(false)
})
