import assert from 'node:assert/strict'
import test from 'node:test'

import { emptyGroup } from '../lib/model.js'
import {
  focusRole,
  focusRoles,
  isDirect,
  noteFocusImportance,
  pruneMembers,
  recordFocus,
} from '../lib/focus.js'

const CONFIG = {
  focusWindow: 10,
  focusTtlSec: 3600,
  focusActive: 2,
  focusBuffer: 2,
  focusTurnWeight: 0.5,
  focusImportantMult: 5,
  memberTtlSec: 1000,
  maxGroupMembersStored: 10,
}

test('focus ranks by weighted importance, then turns, then name', () => {
  const group = emptyGroup('g1', '测试群', 0)
  recordFocus(group, { uid: 'a', name: 'A', importance: 1, at: 1000 }, CONFIG, 1000)
  recordFocus(group, { uid: 'b', name: 'B', importance: 1, at: 1000 }, CONFIG, 1000)
  recordFocus(group, { uid: 'b', name: 'B', importance: 1, at: 1001 }, CONFIG, 1001)
  recordFocus(group, { uid: 'c', name: 'C', importance: 3, at: 1002 }, CONFIG, 1002)
  recordFocus(group, { uid: 'd', name: 'D', importance: 1, at: 1003 }, CONFIG, 1003)
  recordFocus(group, { uid: 'e', name: 'E', importance: 1, at: 1004 }, CONFIG, 1004)

  const roles = focusRoles(group, CONFIG, 1004)
  assert.deepEqual(roles.active.map((row) => row.uid), ['c', 'b'])
  assert.deepEqual(roles.buffer.map((row) => row.uid), ['a', 'd'])
  assert.equal(focusRole(group, 'e', CONFIG, 1004), '')
})

test('focus expires old entries and caps the window', () => {
  const config = { ...CONFIG, focusWindow: 5 }
  const group = emptyGroup('g1', '测试群', 0)
  recordFocus(group, { uid: 'old', name: '旧人', importance: 3, at: 1 }, config, 1)
  for (let i = 0; i < 8; i += 1) {
    recordFocus(group, { uid: `u${i}`, name: `成员${i}`, importance: 1, at: 5000 + i }, config, 5000 + i)
  }
  assert.equal(group.focus.length, config.focusWindow)
  assert.equal(focusRole(group, 'old', config, 5000), '')
})

test('importance backfill lifts a speaker without inventing entries', () => {
  const group = emptyGroup('g1', '测试群', 0)
  recordFocus(group, { uid: 'a', name: '阿川', importance: 1, at: 1000 }, CONFIG, 1000)
  assert.equal(noteFocusImportance(group, 'a', 3, CONFIG, 1000), true)
  assert.equal(group.focus[0].imp, 3)
  assert.equal(noteFocusImportance(group, 'missing', 3, CONFIG, 1000), false)
})

test('direct detection accepts @ and the configured agent name', () => {
  assert.equal(isDirect('@角色 你看', '角色'), true)
  assert.equal(isDirect('角色，你看', '角色'), true)
  assert.equal(isDirect('今天天气不错', '角色'), false)
  assert.equal(isDirect('这个角色不错', '角色'), false)
  assert.equal(isDirect('没有名字', ''), false)
  assert.equal(isDirect('随便', '', true), true)
})

test('member pruning keeps promoted and focused members, drops stale ones', () => {
  const group = emptyGroup('g1', '测试群', 0)
  group.members = {
    promoted: { name: '旧友', style: '熟', lastSeen: 1, promoted: true },
    focused: { name: '焦点', style: '', lastSeen: 1, promoted: false },
    stale: { name: '路人', style: '', lastSeen: 1, promoted: false },
  }
  group.focus = [{ uid: 'focused', name: '焦点', imp: 1, at: 10_000_000 }]
  const dropped = pruneMembers(group, CONFIG, 10_000_000)
  assert.equal(dropped, 1)
  assert.ok(group.members.promoted)
  assert.ok(group.members.focused)
  assert.equal(group.members.stale, undefined)
})
