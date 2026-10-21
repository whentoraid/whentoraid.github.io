import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { app } from '../lib/app.svelte.js'
import { createSeedState, SEED_WEEK } from '../lib/seed.js'
import Home from './Home.svelte'
import { announcedRaids, raidAnswer } from '../lib/raid-answers.js'
import { templateFromRanges } from '../lib/availability-template.js'
import { localRaidResponses, saveLocalRaidResponse } from '../lib/raid-services.js'
import { remote } from '../lib/remote/sync.svelte.js'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse('2026-09-28T12:00:00Z'))
  app.data = createSeedState()
  const start = Date.parse('2026-10-02T23:30:00Z')
  app.data.weeks[SEED_WEEK].plans['raid-20'] = {
    start: start + 60000,
    team: [],
    published: {
      start,
      end: start + 3 * 3600000,
      publishedAt: 1000,
      team: [{ memberId: 'm0', characterId: 'c0a', role: 'Tank' }],
    },
  }
})

afterEach(() => vi.useRealTimers())

test('shows the current member’s published assignment and opens its week and raid', async () => {
  render(Home)
  const next = screen.getByRole('region', { name: 'Next raid assignment' })
  expect(within(next).getByText('Stoneguard')).toBeTruthy()
  expect(within(next).getByText('Tank')).toBeTruthy()
  expect(screen.getByText('You’re ready for planning')).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Getting ready to raid' })).toBeNull()
  await fireEvent.click(within(next).getByRole('button', { name: 'View published roster' }))
  expect(app.view).toBe('planner')
  expect(app.plannerIntent).toBe('published')
  expect(app.data.currentWeek).toBe(SEED_WEEK)
  expect(app.data.currentRaidId).toBe('raid-20')
})

test('another player is not shown someone else’s assignment', () => {
  app.data = { ...app.data, currentMemberId: 'm1' }
  render(Home)
  expect(screen.queryByRole('region', { name: 'Next raid assignment' })).toBeNull()
  expect(screen.getByRole('region', { name: 'Answer this week’s raids' })).toBeTruthy()
  expect(screen.queryByText('YOUR CHARACTER')).toBeNull()
  expect(screen.getByRole('button', { name: 'View published roster' })).toBeTruthy()
})

test('a newly joined player is guided to add a character and check in', async () => {
  app.data = {
    ...app.data,
    currentMemberId: 'new-player',
    members: [...app.data.members, { id: 'new-player', name: 'Nova', discordId: '' }],
  }
  render(Home)
  expect(screen.getByRole('heading', { name: 'Get ready for raid planning' })).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Add character' }))
  expect(app.view).toBe('characters')
})

test('a rostered player confirms their place, then reports a late problem with a note', async () => {
  render(Home)
  const next = screen.getByRole('region', { name: 'Next raid assignment' })
  await fireEvent.click(within(next).getByRole('button', { name: 'Tentative' }))
  expect(await within(next).findByText(/You’re tentative/)).toBeTruthy()
  expect(localRaidResponses('browser', SEED_WEEK, 'raid-20')[0].status).toBe('tentative')
  await fireEvent.click(within(next).getByRole('button', { name: 'I’ll be there' }))
  expect(await within(next).findByText('You confirmed you’ll be there.')).toBeTruthy()
  expect(within(next).queryByRole('button', { name: 'I’ll be there' })).toBeNull()

  await fireEvent.click(within(next).getByRole('button', { name: 'I can’t make it' }))
  await fireEvent.input(within(next).getByLabelText(/What’s changed/), { target: { value: 'Working late' } })
  await fireEvent.click(within(next).getByRole('button', { name: 'Tell the officers' }))
  expect(await within(next).findByText(/can’t make it: “Working late”/)).toBeTruthy()
  const [saved] = localRaidResponses('browser', SEED_WEEK, 'raid-20')
  expect(saved).toMatchObject({
    member_id: 'm0',
    status: 'unavailable',
    note: 'Working late',
    publication: '1000',
  })
})

test('a response given before the raid time changed is not shown as current', async () => {
  const published = app.data.weeks[SEED_WEEK].plans['raid-20'].published
  const earlier = { ...published, start: published.start - 3600000, end: published.end - 3600000 }
  saveLocalRaidResponse('browser', SEED_WEEK, 'raid-20', 'm0', earlier, 'unavailable', 'Old')
  render(Home)
  const next = screen.getByRole('region', { name: 'Next raid assignment' })
  expect(await within(next).findByRole('button', { name: 'I’ll be there' })).toBeTruthy()
  expect(within(next).queryByText(/Old/)).toBeNull()
})

test('an officer’s My raids stays about their own raids and links to the officer dashboard', async () => {
  render(Home)
  expect(screen.queryByRole('region', { name: 'Officer dashboard' })).toBeNull()
  const jump = screen.getByRole('navigation', { name: 'On this page' })
  await fireEvent.click(within(jump).getByRole('button', { name: /Open officer dashboard/ }))
  expect(app.view).toBe('officer')
})

test('the On this page bar jumps to and focuses each part of the page', async () => {
  render(Home)
  const jump = screen.getByRole('navigation', { name: 'On this page' })
  await fireEvent.click(within(jump).getByRole('button', { name: 'Availability' }))
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'This week’s check-in' }))
  await fireEvent.click(within(jump).getByRole('button', { name: 'Month' }))
  expect(document.activeElement.id).toBe('home-month')
})

test('the confirmation includes the assigned character and does not duplicate a signup', () => {
  render(Home)
  const next = screen.getByRole('region', { name: 'Next raid assignment' })
  const answer = within(next).getByRole('button', { name: 'I’ll be there' })
  const character = within(next).getByText('YOUR CHARACTER')
  expect(character.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Answer this week’s raids' })).toBeNull()
})

test('a player answers a raid in one tap, and only that raid changes', async () => {
  app.data = { ...app.data, currentMemberId: 'm1' }
  render(Home)
  const quick = screen.getByRole('region', { name: 'Answer this week’s raids' })
  const group = within(quick).getByRole('group', { name: /Your answer for/ })
  await fireEvent.click(within(group).getByRole('button', { name: 'Can’t make it' }))
  const [raid] = announcedRaids(app.data, SEED_WEEK)
  expect(raidAnswer(app.data, SEED_WEEK, 'm1', raid)).toBe('out')
  expect(within(group).getByRole('button', { name: 'Can’t make it' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
})

test('a usual schedule due for review is confirmed from Home in one tap', async () => {
  app.data.templates = {
    m0: { ...templateFromRanges(SEED_WEEK, [], app.data.guild), confirmedAt: '2026-07-01' },
  }
  render(Home)
  const review = screen.getByRole('group', { name: 'Review your usual schedule' })
  expect(within(review).getByText(/You last confirmed it Jul 1/)).toBeTruthy()
  await fireEvent.click(within(review).getByRole('button', { name: 'Still right' }))
  expect(app.data.templates.m0.confirmedAt).toBe('2026-09-28')
  expect(screen.queryByRole('group', { name: 'Review your usual schedule' })).toBeNull()
})

test('an online player with a first assignment can open the calendar link from their raid', async () => {
  Object.assign(remote, { guildId: 'guild-1', memberId: 'm0', officer: false })
  try {
    render(Home)
    const next = screen.getByRole('region', { name: 'Next raid assignment' })
    const summary = screen.getByText('Calendar link', { selector: 'summary' })
    expect(summary.closest('details').open).toBe(false)
    await fireEvent.click(within(next).getByRole('button', { name: /Follow your raids in your calendar/ }))
    expect(summary.closest('details').open).toBe(true)
    expect(document.activeElement).toBe(summary)
  } finally {
    Object.assign(remote, { guildId: null, memberId: null, officer: false })
  }
})

test('before a first assignment the calendar link waits behind a disclosure', () => {
  Object.assign(remote, { guildId: 'guild-1', memberId: 'm1', officer: false })
  app.data = { ...app.data, currentMemberId: 'm1' }
  try {
    render(Home)
    expect(screen.queryByRole('button', { name: /Follow your raids in your calendar/ })).toBeNull()
    const summary = screen.getByText('Calendar link', { selector: 'summary' })
    expect(summary.closest('details').open).toBe(false)
  } finally {
    Object.assign(remote, { guildId: null, memberId: null, officer: false })
  }
})

test('a rostered player confirms directly on their assignment without an inbox duplicate', async () => {
  render(Home)
  expect(screen.queryByText('Confirm your place in 20-player Raid')).toBeNull()
  const next = screen.getByRole('region', { name: 'Next raid assignment' })
  await fireEvent.click(within(next).getByRole('button', { name: 'I’ll be there' }))
  await within(next).findByText('You confirmed you’ll be there.')
  await vi.waitFor(() => expect(screen.queryByText('Confirm your place in 20-player Raid')).toBeNull())
})

test('a player sees their recent raids and how sitting out is counted', async () => {
  const start = Date.parse('2026-09-21T23:30:00Z')
  const previous = '2026-09-21'
  app.data = {
    ...app.data,
    weeks: {
      ...app.data.weeks,
      [previous]: {
        checkins: {},
        plans: {
          'raid-20': {
            start,
            team: [{ memberId: 'm0', characterId: 'c0a', role: 'Tank' }],
            attendance: { m0: 'attended' },
          },
        },
      },
    },
  }
  render(Home)
  const record = screen.getByText('Your recent raids').closest('details')
  expect(within(record).getByText('Played')).toBeTruthy()
  expect(within(record).getByText(/doesn’t measure skill or effort/)).toBeTruthy()
  expect(within(record).getAllByText(/no sit-outs in the 4 weeks before this one/)).toHaveLength(3)
})
