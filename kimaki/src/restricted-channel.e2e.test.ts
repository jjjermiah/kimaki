// Restricted channels: a member with role `kimaki-project` chats in #project only.
// Their sessions get the restricted deny rules; `!` shell and `/` commands are refused.

import fs from 'node:fs'
import type { DeterministicMatcher } from 'opencode-deterministic-provider'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { RESTRICTED_SESSION_RULES } from './channel-access.ts'
import type { BotHandle } from './main.ts'
import {
  OTHER_USER_ID,
  seedProjectChannel,
  startOpencodeTestServer,
  startTestBot,
  startTwin,
  tempDataDir,
  textParts,
  waitFor,
  waitForBotMessageContaining,
  waitForFooter,
  warmUp,
  type OpencodeTestServer,
  type TestTwin,
} from './test/harness.ts'

const RESTRICTED_ROLE_ID = '300000000000000001'

const matchers: DeterministicMatcher[] = [
  { id: 'restricted-marker', priority: 50, when: { latestUserTextIncludes: 'restricted-marker' }, then: { parts: textParts('restricted ok') } },
]

let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle
let dataDir: string

beforeAll(async () => {
  dataDir = tempDataDir()
  ;[server, twin] = await Promise.all([startOpencodeTestServer({ matchers }), startTwin()])
  await seedProjectChannel({
    dataDir,
    channelId: twin.channelId,
    guildId: twin.discord.guildId,
    directory: server.projectDirectory,
  })
  // The role exists before the bot logs in, so its guild cache has it.
  await twin.discord.prisma.role.create({
    data: { id: RESTRICTED_ROLE_ID, guildId: twin.discord.guildId, name: 'kimaki-project', permissions: '0', position: 1 },
  })
  await twin.discord.prisma.guildMember.update({
    where: { guildId_userId: { guildId: twin.discord.guildId, userId: OTHER_USER_ID } },
    data: { roles: JSON.stringify([RESTRICTED_ROLE_ID]) },
  })
  await warmUp({ server })
  bot = await startTestBot({ dataDir, twin, server })
})

afterAll(async () => {
  await bot?.stop()
  await twin?.stop()
  await server?.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

// Plain message in the channel: a new thread with a session.
async function startRestrictedThread(content: string) {
  const { discord, channelId } = twin
  const before = new Set((await discord.channel(channelId).getThreads()).map((thread) => thread.id))
  await discord.channel(channelId).user(OTHER_USER_ID).sendMessage({ content })
  const thread = await discord.channel(channelId).waitForThread({
    timeout: 8_000,
    predicate: (candidate) => !before.has(candidate.id),
  })
  return thread
}

test('restricted member gets a session in their channel with the restricted rules', async () => {
  const thread = await startRestrictedThread('Hello restricted-marker')
  await waitForFooter({ discord: twin.discord, threadId: thread.id, count: 1 })
  const sessionId = bot.store.getState().roots[thread.id]!
  const info = await (await server.client()).session.get({ sessionID: sessionId })
  expect(info.permissions).toEqual(expect.arrayContaining([...RESTRICTED_SESSION_RULES]))
  expect(await twin.discord.thread(thread.id).text()).toMatchInlineSnapshot(`
    "--- from: user (stranger)
    Hello restricted-marker
    --- from: assistant (TestBot)
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    restricted ok
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)
})

test('restricted member: ! shell in their thread is refused and nothing runs', async () => {
  const thread = await startRestrictedThread('Shell check restricted-marker')
  await waitForFooter({ discord: twin.discord, threadId: thread.id, count: 1 })
  await twin.discord.thread(thread.id).user(OTHER_USER_ID).sendMessage({ content: '!echo shell-probe' })
  await waitForBotMessageContaining({ discord: twin.discord, threadId: thread.id, text: 'Restricted:' })
  expect(await twin.discord.thread(thread.id).text()).toMatchInlineSnapshot(`
    "--- from: user (stranger)
    Shell check restricted-marker
    --- from: assistant (TestBot)
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    restricted ok
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*
    --- from: user (stranger)
    !echo shell-probe
    --- from: assistant (TestBot)
    Restricted: only plain messages here. No \`!\` shell, \`/\` commands or voice."
  `)
})

test('restricted member: ! shell in the channel starts no thread', async () => {
  const { discord, channelId } = twin
  const before = new Set((await discord.channel(channelId).getThreads()).map((thread) => thread.id))
  await discord.channel(channelId).user(OTHER_USER_ID).sendMessage({ content: '!echo channel-probe' })
  await waitFor({
    label: 'refusal in the channel',
    check: async () => (await discord.channel(channelId).text()).includes('Restricted:') || undefined,
  })
  const after = (await discord.channel(channelId).getThreads()).map((thread) => thread.id)
  expect(after.filter((id) => !before.has(id))).toEqual([])
})
