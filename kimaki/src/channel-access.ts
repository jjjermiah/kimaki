// Who may use Kimaki where. Pure: callers read Discord members, roles and
// channels and pass plain names in. See the README "Restricted channels".
//
//   full        owner, Administrator, Manage Server, role "kimaki", or --allow-all-users
//   restricted  no full access, but a role "kimaki-<channel name>" (case-insensitive)
//   none        everyone else. Role "no-kimaki" always gives none.
//
// A restricted member chats only in the channel named by the role, and in its
// threads. Every session created in a restricted channel gets RESTRICTED_SESSION_RULES,
// so the agent cannot run commands, edit files outside plain prompts, or spawn subagents.

import type { Route } from './routes.ts'

export type AccessLevel = 'full' | 'restricted' | 'none'

export type PermissionRule = { readonly action: string; readonly resource: string; readonly effect: 'allow' | 'deny' | 'ask' }

const RESTRICTED_ROLE_PREFIX = 'kimaki-'

// The channel name a role grants (lowercase), or null for any other role.
export function roleGrantedChannel(roleName: string): string | null {
  const name = roleName.toLowerCase()
  if (!name.startsWith(RESTRICTED_ROLE_PREFIX)) return null
  return name.slice(RESTRICTED_ROLE_PREFIX.length) || null
}

export function accessLevel({
  allowAllUsers,
  ownerOrAdmin,
  roleNames,
}: {
  allowAllUsers: boolean
  ownerOrAdmin: boolean
  roleNames: readonly string[]
}): AccessLevel {
  const names = roleNames.map((name) => name.toLowerCase())
  if (names.includes('no-kimaki')) return 'none'
  if (allowAllUsers || ownerOrAdmin || names.includes('kimaki')) return 'full'
  return names.some((name) => roleGrantedChannel(name) !== null) ? 'restricted' : 'none'
}

// A restricted member may use a channel only with a role naming it.
export function mayUseChannel({ roleNames, channelName }: { roleNames: readonly string[]; channelName: string }): boolean {
  const channel = channelName.toLowerCase()
  return roleNames.some((name) => roleGrantedChannel(name) === channel)
}

// A channel is restricted when the guild has a role naming it.
export function isRestrictedChannel({ guildRoleNames, channelName }: { guildRoleNames: readonly string[]; channelName: string }): boolean {
  return mayUseChannel({ roleNames: guildRoleNames, channelName })
}

// Plain prompts only. Shell (`!`), commands (`/x`) and skills are full-access routes.
export function isPlainPrompt(route: Route): boolean {
  return route.kind === 'steer' || route.kind === 'queue' || route.kind === 'btw' || route.kind === 'new-session'
}

// OpenCode permission keys. `shell` covers the agent's shell tool; `edit` covers
// edit, write and patch; `external_directory` blocks paths outside the project;
// `subagent` blocks child sessions. Kimaki's `!` shell does not go through these
// (OpenCode's session.shell is not permission-checked), so `!` is refused in the bot.
// Session rules come after user rules, so `--permission shell:allow` cannot re-open them.
export const RESTRICTED_SESSION_RULES: readonly PermissionRule[] = [
  { action: 'shell', resource: '*', effect: 'deny' },
  { action: 'edit', resource: '*', effect: 'deny' },
  { action: 'external_directory', resource: '*', effect: 'deny' },
  { action: 'subagent', resource: '*', effect: 'deny' },
]

// True when a session carries every restricted deny rule (the thread may take restricted members).
export function hasRestrictedRules(rules: readonly PermissionRule[]): boolean {
  return RESTRICTED_SESSION_RULES.every((wanted) =>
    rules.some((rule) => rule.action === wanted.action && rule.resource === wanted.resource && rule.effect === wanted.effect),
  )
}
