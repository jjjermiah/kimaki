// --hide-sessions: every Kimaki session is a child of one hidden parent per
// project directory, so OpenCode's root lists skip it. /resume still finds it.

import fs from 'node:fs'
import path from 'node:path'
import type { DeterministicMatcher } from 'opencode-deterministic-provider'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { BotHandle } from './main.ts'
import {
  TEST_USER_ID,
  seedProjectChannel,
  startOpencodeTestServer,
  startTestBot,
  startTwin,
  tempDataDir,
  textParts,
  waitForFooter,
  warmUp,
  type OpencodeTestServer,
  type TestTwin,
} from './test/harness.ts'

const matchers: DeterministicMatcher[] = [
  { id: 'hidden-marker', priority: 500, when: { latestUserTextIncludes: 'hidden-marker' }, then: { parts: textParts('hidden answer') } },
]

let server: OpencodeTestServer
let twin: TestTwin
let bot: BotHandle
let dataDir: string
// The thread of the first test; the /resume test looks for its session.
let firstThreadId = ''

beforeAll(async () => {
  dataDir = tempDataDir()
  ;[server, twin] = await Promise.all([startOpencodeTestServer({ matchers }), startTwin()])
  await seedProjectChannel({ dataDir, channelId: twin.channelId, guildId: twin.discord.guildId, directory: server.projectDirectory })
  await warmUp({ server })
  bot = await startTestBot({ dataDir, twin, server, hideSessions: true })
})

afterAll(async () => {
  await bot?.stop()
  await twin?.stop()
  await server?.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function newThread(send: () => Promise<unknown>) {
  const { discord, channelId } = twin
  const before = new Set((await discord.channel(channelId).getThreads()).map((thread) => thread.id))
  await send()
  return discord.channel(channelId).waitForThread({ timeout: 8_000, predicate: (thread) => !before.has(thread.id) })
}

async function sendInProjectChannel(content: string) {
  const thread = await newThread(() => twin.discord.channel(twin.channelId).user(TEST_USER_ID).sendMessage({ content }))
  await waitForFooter({ discord: twin.discord, threadId: thread.id })
  return thread
}

// The root session of a thread and its hidden parent, read from OpenCode.
async function sessionOf(threadId: string) {
  const rootId = bot.store.getState().roots[threadId]
  if (!rootId) throw new Error(`thread ${threadId} has no root session`)
  const client = await server.client()
  const session = await client.session.get({ sessionID: rootId })
  return { rootId, parentId: session.parentID ?? null, session }
}

test('a thread session is a child of a hidden parent that the root list skips', async () => {
  const thread = await sendInProjectChannel('Hidden work hidden-marker')
  firstThreadId = thread.id
  expect(await twin.discord.thread(thread.id).text()).toMatchInlineSnapshot(`
    "--- from: user (tommy)
    Hidden work hidden-marker
    --- from: assistant (TestBot)
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    hidden answer
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)

  const { rootId, parentId } = await sessionOf(thread.id)
  if (!parentId) throw new Error('thread session has no hidden parent')
  const client = await server.client()
  const parent = await client.session.get({ sessionID: parentId })
  expect({
    titlePrefix: parent.title?.startsWith('kimaki: '),
    kimakiMetadata: parent.metadata?.['kimaki'] ?? null,
    parentDirectory: parent.location.directory === server.projectDirectory,
  }).toEqual({ titlePrefix: true, kimakiMetadata: null, parentDirectory: true })

  const roots = await client.session.list({ parentID: null, order: 'desc', limit: 100 })
  const rootIds = roots.data.map((listed) => listed.id)
  expect({ session: rootIds.includes(rootId), parent: rootIds.includes(parentId) }).toEqual({ session: false, parent: true })
})

test('/resume finds the Kimaki session but not the hidden parent', async () => {
  const { discord, channelId } = twin
  const { rootId } = await sessionOf(firstThreadId)
  const user = discord.channel(channelId).user(TEST_USER_ID)
  const choices = await user.autocomplete({ name: 'resume', options: [{ name: 'session', type: 3, value: 'Hidden' }], focused: 'session' })
  expect(choices.map((choice) => ({ ...choice, name: choice.name.replace(/\(.*\)/, '(DATE)') }))).toEqual([
    { name: 'Hidden work hidden-marker (DATE)', value: rootId },
  ])
  expect(await user.autocomplete({ name: 'resume', options: [{ name: 'session', type: 3, value: 'kimaki' }], focused: 'session' })).toEqual([])
})

test('a second thread reuses the directory parent; a deleted parent is recreated', async () => {
  const client = await server.client()
  const second = await sendInProjectChannel('Second hidden-marker')
  const third = await sendInProjectChannel('Third hidden-marker')
  const secondParent = (await sessionOf(second.id)).parentId
  const thirdParent = (await sessionOf(third.id)).parentId
  expect(thirdParent).toBe(secondParent)
  if (!secondParent) throw new Error('no parent')

  // Deleting the parent deletes its children too (OpenCode session.remove cascades).
  await client.session.remove({ sessionID: secondParent })
  const after = await sendInProjectChannel('After hidden-marker')
  expect(await twin.discord.thread(after.id).text()).toMatchInlineSnapshot(`
    "--- from: user (tommy)
    After hidden-marker
    --- from: assistant (TestBot)
    -# *using deterministic-provider/deterministic-v2 ⋅ build*
    hidden answer
    -# *project ⋅ main ⋅ Ns ⋅ N% ⋅ deterministic-v2*"
  `)
  const afterParent = (await sessionOf(after.id)).parentId
  expect({ recreated: afterParent !== null && afterParent !== secondParent }).toEqual({ recreated: true })
  const rows = await bot.db.query.session_parents.findMany({ where: { directory: server.projectDirectory } })
  expect(rows.map((row) => row.session_id)).toEqual([afterParent])
})
