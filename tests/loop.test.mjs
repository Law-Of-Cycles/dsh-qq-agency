// 闭环测试：假 OneBot 服务器 + 假 agent，验证
//   心跳 → 采样 → 内心 → 让它开口（followup）→ 它这一轮说完 → 真的发到 QQ
// 跑：node tests/loop.test.mjs

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let 过 = 0
const 测 = async (名, fn) => {
  try {
    await fn()
    过 += 1
    console.log(`  ✓ ${名}`)
  } catch (error) {
    console.error(`  ✗ ${名}\n    ${error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n    ') : error}`)
    process.exitCode = 1
  }
}

const 等 = (ms) => new Promise((r) => setTimeout(r, ms))
const 会话id = 'sess-agency-1'

// ---------- 假 OneBot ----------
const 收到 = { 群: [], 私聊: [], 登录: 0, 拉群: 0, 拉私聊: 0 }
const 群号 = 123456
const 主人QQ = 88888
let 群消息 = []

const 服务器 = createServer((req, res) => {
  let 体 = ''
  req.on('data', (c) => { 体 += c })
  req.on('end', () => {
    let j = {}
    try { j = JSON.parse(体 || '{}') } catch (e) {}
    const 路径 = String(req.url || '').replace(/^\//, '')
    const 回 = (o) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(o))
    }
    if (路径 === 'get_login_info') {
      收到.登录 += 1
      return 回({ status: 'ok', retcode: 0, data: { user_id: 10000, nickname: '小鱼' } })
    }
    if (路径 === 'get_group_msg_history') {
      收到.拉群 += 1
      return 回({ status: 'ok', retcode: 0, data: { messages: 群消息 } })
    }
    if (路径 === 'get_friend_msg_history') {
      收到.拉私聊 += 1
      return 回({ status: 'ok', retcode: 0, data: { messages: [] } })
    }
    if (路径 === 'send_group_msg') {
      收到.群.push(j)
      return 回({ status: 'ok', retcode: 0, data: { message_id: 'out-' + 收到.群.length } })
    }
    if (路径 === 'send_private_msg') {
      收到.私聊.push(j)
      return 回({ status: 'ok', retcode: 0, data: { message_id: 'p-' + 收到.私聊.length } })
    }
    回({ status: 'failed', retcode: 1404, wording: 'no such action' })
  })
})

const 端口 = await new Promise((解) => 服务器.listen(0, '127.0.0.1', () => 解(服务器.address().port)))

// ---------- 假宿主 ----------
const 家 = mkdtempSync(join(tmpdir(), 'agency-loop-'))
const 数据 = join(家, 'qq-agency')
mkdirSync(数据, { recursive: true })

const 配置 = {
  总开关: true,
  试运行: false,
  主动性: 100,
  心跳秒: 30,
  目标会话: 会话id,
  称呼: '主人',
  主人QQ: String(主人QQ),
  群号们: String(群号),
  话题词: '',
  NapCat: `http://127.0.0.1:${端口}`,
  NapCat令牌: '',
  私聊直达: true,
  群被叫直达: true,
  插话冷却分: 1,
  找主人冷却分: 90,
  每天最多找主人: 6,
  免打扰开始: '00:00',
  免打扰结束: '00:00', // 起止相同 = 不免打扰
  允许玩手机: false, // 测试里不碰 adb
  玩手机冷却分: 25,
  玩手机后汇报: false,
  ADB路径: 'adb',
  手机序列号: '',
  允许任意shell: false,
  人格补充: '',
}

const 写配置 = (改 = {}) => writeFileSync(join(数据, 'config.json'), JSON.stringify({ ...配置, ...改 }, null, 2), 'utf8')
const 写内心 = (改 = {}) => {
  const 现在 = Date.now()
  const 心 = {
    版本: 1,
    出生时间: 现在 - 86400000,
    上次心跳: 现在 - 10 * 60 * 1000,
    精力: 0.6,
    无聊: 0.95,
    想念: 0.2,
    情绪: { 愉悦: 0, 唤醒: 0.4 },
    上次群发言: 0,
    上次私聊主人: 0,
    主人最后说话: 现在 - 2 * 3600 * 1000,
    群最后热闹: 0,
    今日: { 日期: '', 群发言: 0, 私聊主人: 0 },
    累计: { 心跳: 0, 群发言: 0, 私聊主人: 0, 玩手机: 0, 忍住: 0 },
    念头: [],
    ...改,
  }
  writeFileSync(join(数据, 'mind.json'), JSON.stringify(心, null, 2), 'utf8')
}

写配置()
写内心()

// 群消息：一条提到它（触发「被叫直达」），一条普通（不触发）
const 现在秒 = Math.floor(Date.now() / 1000)
群消息 = [
  { message_id: 'm1', time: 现在秒 + 1, user_id: 20000, sender: { nickname: '阿明' }, message_type: 'group', group_id: 群号, message: [{ type: 'text', data: { text: '小鱼你今天干嘛去了' } }] },
  { message_id: 'm2', time: 现在秒 + 1, user_id: 20001, sender: { nickname: '阿花' }, message_type: 'group', group_id: 群号, message: [{ type: 'text', data: { text: '今晚吃火锅吗' } }] },
]

// 它这一轮说的话（假模型）
let 这一轮说 = '这是它自己说的话'
const 收到的独白 = []
const 监听 = []

const 假agent = {
  session: { id: 会话id },
  async followup(msg) {
    收到的独白.push(msg)
    // 模拟模型说完一轮：assistant/message + turn/end
    setTimeout(() => {
      for (const fn of 监听) {
        try { fn({ id: 会话id }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 这一轮说 }] }, turn: 1 } }) } catch (e) {}
      }
      for (const fn of 监听) {
        try { fn({ id: 会话id }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }) } catch (e) {}
      }
    }, 5)
  },
}

const ctx = {
  logger: { info: () => {} },
  on(_事件, fn) { 监听.push(fn); return () => { const i = 监听.indexOf(fn); if (i >= 0) 监听.splice(i, 1) } },
  effect(fn) { const d = fn(); return () => { try { if (typeof d === 'function') d() } catch (e) {} } },
  interval() { return () => {} }, // 心跳由测试手动调
  webServer: { register: () => () => {} },
  tools: { register: () => () => {} },
  systemPrompt: { section: () => () => {} },
  agents: { get: (id) => (id === 会话id || id === 'session-' + 会话id ? 假agent : undefined) },
  sessions: { list: () => [{ id: 会话id }], flush: async () => {} },
  sessionTitle: { get: () => ({ title: '测试会话' }) },
  get: () => undefined,
  attachments: undefined,
}

process.env.DSH_HOME = 家
const { apply } = await import('../lib/host.js')
const api = apply(ctx)

console.log('loop（假 OneBot + 假 agent）')

await 测('心跳能连上后端、认出自己是哪个号', async () => {
  await api.心跳()
  assert.ok(收到.登录 >= 1, '应该调过 get_login_info')
  assert.ok(收到.拉群 >= 1, '应该拉过群消息')
})

await 测('群里被点名 → 让它开口，而且独白里带群上下文', async () => {
  const 有群上下文 = 收到的独白.some((m) => {
    const 文 = m.content && m.content[0] && m.content[0].text || ''
    return 文.includes('群里刚发生的事') || 文.includes('提到了你')
  })
  assert.ok(有群上下文, `没触发「被叫直达」。收到 ${收到的独白.length} 条独白：${JSON.stringify(收到的独白.map((m) => (m.content[0].text || '').slice(0, 40)))}`)
})

await 测('无聊拉满 → 自发插话的独白是「内心独白」那种', async () => {
  const 有独白 = 收到的独白.some((m) => {
    const 文 = m.content && m.content[0] && m.content[0].text || ''
    return 文.includes('不是别人发给你的消息')
  })
  assert.ok(有独白, '没触发自发插话')
})

await 测('它说完话 → 真的发到了 QQ 群', async () => {
  await 等(200)
  assert.ok(收到.群.length >= 1, `一条都没发出去（收到 ${收到.群.length} 条）`)
  const 第一 = 收到.群[0]
  assert.equal(Number(第一.group_id), 群号, '群号不对')
  const 文本 = (第一.message || []).map((s) => (s.data && s.data.text) || '').join('')
  assert.ok(文本.includes('这是它自己说的话'), `发出去的内容不对：${文本}`)
})

await 测('发出去之后，内心记了「今天在群里说过话」', async () => {
  const 心 = JSON.parse(readFileSync(join(数据, 'mind.json'), 'utf8'))
  assert.ok(心.今日.群发言 >= 1, `今日群发言 = ${心.今日.群发言}`)
  assert.ok(心.上次群发言 > 0, '上次群发言没记')
  assert.ok(心.念头.some((x) => String(x.话).includes('说了')), '念头里没有说过话的记录')
})

await 测('试运行打开后，一条都不真发', async () => {
  const 之前 = 收到.群.length
  写配置({ 试运行: true })
  写内心({ 无聊: 0.99, 上次群发言: 0 })
  await api.心跳()
  await 等(200)
  assert.equal(收到.群.length, 之前, `试运行还是发了 ${收到.群.length - 之前} 条`)
})

await 测('总开关关掉后，连采样都不做', async () => {
  const 之前拉群 = 收到.拉群
  写配置({ 总开关: false })
  await api.心跳()
  assert.equal(收到.拉群, 之前拉群, '总开关关着还在拉消息')
})

await 测('日志里能看出它每一步在干什么', async () => {
  const 日志 = api.日志.map((x) => x.文本).join('\n')
  assert.ok(日志.includes('已装好'), '缺启动日志')
  assert.ok(日志.includes('连着的 QQ'), '缺登录日志')
  assert.ok(/✅ 已发|试运行/.test(日志), '缺发送/试运行日志')
})

await 测('内心能跨进程读回来（落盘是真的）', async () => {
  const 心 = api.读心()
  assert.ok(typeof 心.无聊 === 'number')
  assert.ok(心.累计.心跳 >= 1, '心跳计数没落盘')
})

服务器.close()
console.log(`\n${过} 项通过${process.exitCode ? '，有失败' : ''}`)
