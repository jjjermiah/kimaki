import { describe, expect, test } from 'vitest'

import {
  accessLevel,
  hasRestrictedRules,
  isPlainPrompt,
  isRestrictedChannel,
  mayUseChannel,
  RESTRICTED_SESSION_RULES,
  roleGrantedChannel,
} from './channel-access.ts'
import type { Route } from './routes.ts'

describe('accessLevel', () => {
  const base = { allowAllUsers: false, ownerOrAdmin: false, roleNames: [] as string[] }

  test('plain member has no access', () => {
    expect(accessLevel(base)).toBe('none')
    expect(accessLevel({ ...base, roleNames: ['everyone-else', 'member'] })).toBe('none')
  })

  test('owner, administrator, manage server, role kimaki, or allow-all are full', () => {
    expect(accessLevel({ ...base, ownerOrAdmin: true })).toBe('full')
    expect(accessLevel({ ...base, allowAllUsers: true })).toBe('full')
    expect(accessLevel({ ...base, roleNames: ['Kimaki'] })).toBe('full')
    expect(accessLevel({ ...base, roleNames: ['KIMAKI'] })).toBe('full')
  })

  test('a kimaki-<channel> role alone is restricted', () => {
    expect(accessLevel({ ...base, roleNames: ['kimaki-jellyfin'] })).toBe('restricted')
    expect(accessLevel({ ...base, roleNames: ['Kimaki-Jellyfin'] })).toBe('restricted')
  })

  test('full access beats a channel role', () => {
    expect(accessLevel({ ...base, ownerOrAdmin: true, roleNames: ['kimaki-jellyfin'] })).toBe('full')
    expect(accessLevel({ ...base, roleNames: ['kimaki-jellyfin', 'kimaki'] })).toBe('full')
  })

  test('no-kimaki denies everyone, even with allow-all or a channel role', () => {
    expect(accessLevel({ ...base, allowAllUsers: true, roleNames: ['No-Kimaki'] })).toBe('none')
    expect(accessLevel({ ...base, ownerOrAdmin: true, roleNames: ['no-kimaki'] })).toBe('none')
    expect(accessLevel({ ...base, roleNames: ['kimaki-jellyfin', 'no-kimaki'] })).toBe('none')
  })

  test('a bare kimaki- prefix grants no channel', () => {
    expect(roleGrantedChannel('kimaki-')).toBe(null)
    expect(accessLevel({ ...base, roleNames: ['kimaki-'] })).toBe('none')
  })
})

describe('channel roles', () => {
  test('roleGrantedChannel lowercases the channel part', () => {
    expect(roleGrantedChannel('kimaki-Jellyfin')).toBe('jellyfin')
    expect(roleGrantedChannel('Member')).toBe(null)
  })

  test('mayUseChannel matches the channel name case-insensitively', () => {
    expect(mayUseChannel({ roleNames: ['kimaki-jellyfin'], channelName: 'jellyfin' })).toBe(true)
    expect(mayUseChannel({ roleNames: ['kimaki-jellyfin'], channelName: 'Jellyfin' })).toBe(true)
    expect(mayUseChannel({ roleNames: ['KIMAKI-JELLYFIN'], channelName: 'jellyfin' })).toBe(true)
  })

  test('mayUseChannel refuses other channels and other roles', () => {
    expect(mayUseChannel({ roleNames: ['kimaki-jellyfin'], channelName: 'project' })).toBe(false)
    expect(mayUseChannel({ roleNames: ['kimaki'], channelName: 'kimaki' })).toBe(false)
    expect(mayUseChannel({ roleNames: [], channelName: 'jellyfin' })).toBe(false)
  })

  test('a channel is restricted when the guild has a role naming it', () => {
    const guildRoleNames = ['@everyone', 'kimaki', 'kimaki-jellyfin']
    expect(isRestrictedChannel({ guildRoleNames, channelName: 'jellyfin' })).toBe(true)
    expect(isRestrictedChannel({ guildRoleNames, channelName: 'JELLYFIN' })).toBe(true)
    expect(isRestrictedChannel({ guildRoleNames, channelName: 'project' })).toBe(false)
    expect(isRestrictedChannel({ guildRoleNames: ['kimaki'], channelName: 'kimaki' })).toBe(false)
  })
})

describe('isPlainPrompt', () => {
  const plain: Route[] = [
    { kind: 'steer', text: 'hi' },
    { kind: 'queue', text: 'hi' },
    { kind: 'btw', text: 'hi' },
    { kind: 'new-session', text: 'hi' },
  ]
  test.each(plain)('$kind is plain', (route) => {
    expect(isPlainPrompt(route)).toBe(true)
  })

  const refused: Route[] = [
    { kind: 'shell', command: 'ls' },
    { kind: 'command', name: 'agent', arguments: '', queue: false },
    { kind: 'skill', id: 'kimaki-debug', arguments: '' },
  ]
  test.each(refused)('$kind is refused', (route) => {
    expect(isPlainPrompt(route)).toBe(false)
  })
})

describe('restricted session rules', () => {
  test('deny shell, edit, external_directory and subagent', () => {
    expect(RESTRICTED_SESSION_RULES).toEqual([
      { action: 'shell', resource: '*', effect: 'deny' },
      { action: 'edit', resource: '*', effect: 'deny' },
      { action: 'external_directory', resource: '*', effect: 'deny' },
      { action: 'subagent', resource: '*', effect: 'deny' },
    ])
  })

  test('hasRestrictedRules needs every rule, and ignores extra ones', () => {
    expect(hasRestrictedRules(RESTRICTED_SESSION_RULES)).toBe(true)
    expect(hasRestrictedRules([{ action: 'question', resource: '*', effect: 'deny' }, ...RESTRICTED_SESSION_RULES])).toBe(true)
    expect(hasRestrictedRules([])).toBe(false)
    expect(hasRestrictedRules(RESTRICTED_SESSION_RULES.slice(1))).toBe(false)
    // Same action with another effect does not count.
    expect(hasRestrictedRules([{ action: 'shell', resource: '*', effect: 'allow' }, ...RESTRICTED_SESSION_RULES.slice(1)])).toBe(false)
  })
})
