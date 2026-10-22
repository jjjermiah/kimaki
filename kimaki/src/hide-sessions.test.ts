// Unit tests for the hidden parent decision: a parent OpenCode no longer has is recreated.
// The end-to-end flow is in hide-sessions.e2e.test.ts.

import { describe, expect, test } from 'vitest'

import { OpenCodeError } from './errors.ts'
import { isMissingSession } from './sessions.ts'

// The client throws the declared error body as the Error itself.
function failedWith(body: Record<string, unknown>) {
  const cause = Object.assign(new Error(String(body['message'])), body)
  return new OpenCodeError({ operation: 'get hidden parent session', cause })
}

describe('isMissingSession', () => {
  test('a SessionNotFoundError for the parent means it was deleted', () => {
    const error = failedWith({ _tag: 'SessionNotFoundError', sessionID: 'ses_parent', message: 'Session not found: ses_parent' })
    expect(isMissingSession(error, 'ses_parent')).toBe(true)
  })

  test('the same error for another session, another error, or a transport failure is not a deleted parent', () => {
    expect(isMissingSession(failedWith({ _tag: 'SessionNotFoundError', sessionID: 'ses_other', message: 'x' }), 'ses_parent')).toBe(false)
    expect(isMissingSession(failedWith({ _tag: 'UnknownError', message: 'Unexpected server error' }), 'ses_parent')).toBe(false)
    expect(isMissingSession(new OpenCodeError({ operation: 'get', cause: new Error('fetch failed') }), 'ses_parent')).toBe(false)
  })
})
