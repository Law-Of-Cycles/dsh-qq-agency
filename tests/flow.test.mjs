// 端到端流程测试：把用户描述的那个场景，从头到尾走一遍。
//
//   bot：我可以在拼多多上买一个大肥鱼玩偶吗？
//   你：可以
//   bot：好，那我打开了
//   bot：找到一个「大肥鱼抱枕 45cm」，39 块，买这个吗？
//   你：买
//   bot：好，下单了
//
// 这个测试跑的是**真实的 host.js**（不是 mock），把「心跳 → 起念头 → 用户回话 →
// 模型报告 → 再确认 → 下单」整条链路串起来，验证：
//   1. 每一步的状态都对
//   2. 说"可以"不会导致下单（这是最要紧的一条）
//   3. 说"算了"任何阶段都能停
//   4. 中途重启（重新读盘）状态还在
//
// 跑：node tests/flow.test.mjs

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 新任务, 推进任务, 任务提示, 判意图 } from '../lib/task.js'

let 过 = 0
const 测 = async (名, fn) => {
  try {
    await fn()
    过 += 1
    console.log(`  ✓ ${名}`)
  } catch (error) {
    console.error(`  ✗ ${名}\n    ${(error && error.message) || error}`)
    process.exitCode = 1
  }
}

console.log('flow（从「可以吗」到「下单了」的完整链路）')

const 家 = mkdtempSync(join(tmpdir(), 'agency-flow-'))
mkdirSync(join(家, 'qq-agency'), { recursive: true })
process.env.DSH_HOME = 家
const 配置文件 = join(家, 'qq-agency', 'config.json')
const 任务文件 = join(家, 'qq-agency', 'tasks.json')

const 写配置 = (o) => writeFileSync(配置文件, JSON.stringify(o), 'utf8')
const 读盘 = () => JSON.parse(readFileSync(任务文件, 'utf8'))

写配置({
  总开关: true,
  试运行: true, // 试运行只挡"真发消息"，不影响任务状态机
  允许玩手机: true,
  允许办事: true,
  单笔预算上限: 100,
  每天最多办事: 3,
  办事要确认: true,
  称呼: '主人',
  主人QQ: '88888',
})

// 装一遍真的 host
const 工具表 = []
const 假ctx = {
  logger: { info: () => {} },
  on: () => () => {},
  effect: (fn) => { try { fn() } catch (e) {} return () => {} },
  interval: () => () => {},
  webServer: { register: () => () => {} },
  tools: { register: (t) => { 工具表.push(t); return () => {} } },
  systemPrompt: { section: () => () => {} },
  agents: { get: () => undefined },
  sessions: { list: () => [] },
  sessionTitle: { get: () => ({}) },
  get: () => undefined,
}
const { apply } = await import('../lib/host.js')
apply(假ctx)

const 任务工具 = 工具表.find((t) => t.name === 'agency_task')
assert.ok(任务工具, 'agency_task 没注册')

/** 模拟用户私聊说一句 —— 走 host 内部同一套状态机。 */
const 用户说 = (话) => {
  const 簿 = 读盘()
  const 结果 = 推进任务(簿.当前, { 类型: '用户说话', 说: 话, 现在: Date.now() }, { 称呼: '主人' })
  if (结果.任务 && 结果.任务 !== 簿.当前) writeFileSync(任务文件, JSON.stringify({ ...簿, 当前: 结果.任务 }), 'utf8')
  return 结果
}

await 测('① 它起了念头 → 停在「等授权」，还没动手机', async () => {
  const v = await 任务工具.execute({ 动作: '起念头', 念头: '想在拼多多买个大肥鱼玩偶' }, {})
  assert.equal(v.ok, true, v.说)
  assert.equal(v.阶段, '等授权')
  const 盘 = 读盘()
  assert.equal(盘.当前.念头, '想在拼多多买个大肥鱼玩偶')
  assert.equal(盘.当前.阶段, '等授权')
  assert.equal(盘.当前.商品, null, '这时候不该有商品')
})

await 测('② 提示词让它去问「可不可以」，并报出预算', () => {
  const 文 = 任务提示(读盘().当前, { 称呼: '主人' })
  assert.ok(文.includes('同不同意'), `没让它去问：${文}`)
  assert.ok(文.includes('100'), '没把预算说出来')
})

await 测('③ 用户说「可以」→ 只进到「找商品」，绝不下单', async () => {
  const r = 用户说('可以')
  assert.equal(r.任务.阶段, '找商品', `说"可以"应该只是允许去看：${r.任务.阶段}`)
  assert.ok(r.说话, '应该说一句"好，我去看看"')
  // 这一条是整套设计的地基：随手一个"可以"不能变成花钱
  assert.notEqual(r.任务.阶段, '下单中')
  assert.notEqual(r.任务.阶段, '完成')
})

await 测('④ 「找商品」阶段的提示词明确禁止下单', () => {
  const 文 = 任务提示(读盘().当前, { 称呼: '主人' })
  assert.ok(文.includes('只许看不许买'), '必须明确禁止')
  assert.ok(文.includes('phone_ui') && 文.includes('phone_tap_text'), '要给出具体操作路径')
  assert.ok(文.includes('agency_task'), '要告诉它怎么回报')
})

await 测('⑤ 模型报告找到商品 → 进「等确认」，且这步该问用户', async () => {
  const v = await 任务工具.execute({ 动作: '找到商品', 商品名: '大肥鱼抱枕 45cm', 价格: 39 }, {})
  assert.equal(v.ok, true, v.说)
  assert.equal(v.阶段, '等确认')
  assert.equal(v.商品.名称, '大肥鱼抱枕 45cm')
  assert.equal(v.商品.价格, 39)
  // 关键：这时候还是没下单
  assert.notEqual(v.阶段, '下单中')
})

await 测('⑥ 「等确认」的提示词要把商品名和价格说清楚再问一遍', () => {
  const 文 = 任务提示(读盘().当前, { 称呼: '主人' })
  assert.ok(文.includes('大肥鱼抱枕 45cm'), '没说商品名')
  assert.ok(文.includes('39'), '没说价格')
  assert.ok(/买不买/.test(文), '没问买不买')
})

await 测('⑦ 用户说「买吧」→ 才进「下单中」', async () => {
  const r = 用户说('买吧')
  assert.equal(r.任务.阶段, '下单中', `明确说买才该下单：${r.任务.阶段}`)
})

await 测('⑧ 下单阶段的提示词说了「到支付密码就停」', () => {
  const 文 = 任务提示(读盘().当前, { 称呼: '主人' })
  assert.ok(/密码|验证码/.test(文), '没说支付密码要停')
  assert.ok(文.includes('大肥鱼抱枕 45cm'))
})

await 测('⑨ 报告下单成功 → 完成，并记下花了多少', async () => {
  const v = await 任务工具.execute({ 动作: '下单成功' }, {})
  assert.equal(v.阶段, '完成')
  const 盘 = 读盘()
  assert.equal(盘.当前.阶段, '完成')
  assert.equal(盘.当前.已花, 39)
})

await 测('⑩ 刚办完一件，10 分钟内不会再起新念头（防止反复折腾）', async () => {
  const 刚 = await 任务工具.execute({ 动作: '起念头', 念头: '想买本书' }, {})
  assert.equal(刚.ok, false, '刚办完不该马上又来一件')
  assert.ok(/刚办完|够多/.test(刚.说), `要说清为什么不行：${刚.说}`)

  // 把上次结束时间往前拨 11 分钟，就该放行了
  const 簿 = 读盘()
  writeFileSync(任务文件, JSON.stringify({ ...簿, 当前: { ...簿.当前, 改时: Date.now() - 11 * 60 * 1000 } }), 'utf8')
  const 后来 = await 任务工具.execute({ 动作: '起念头', 念头: '想买本书' }, {})
  assert.equal(后来.ok, true, `过了冷却就该能起：${后来.说}`)
  assert.equal(后来.阶段, '等授权')
})

// ── 中途叫停 ──

await 测('⑪ 在「等确认」时用户说「算了」→ 立刻取消，不下单', async () => {
  writeFileSync(任务文件, JSON.stringify({
    当前: { ...新任务({ 现在: Date.now(), 念头: '买耳机', 预算上限: 100 }), 阶段: '等确认', 商品: { 名称: '耳机', 价格: 89 } },
    今日: { 日期: new Date().toISOString().slice(0, 10), 发起: 1 },
    上次汇报时: 0,
  }), 'utf8')
  const r = 用户说('算了别买了')
  assert.equal(r.任务.阶段, '取消')
  assert.ok(r.说话.includes('不'), '应该说一句"不弄了"')
  // 取消之后不能再往前走
  const r2 = 用户说('买吧')
  assert.equal(r2.任务.阶段, '取消', '取消就是取消')
})

await 测('⑫ 在「找商品」时叫停也能停（不能因为"已经在跑了"就停不住）', async () => {
  writeFileSync(任务文件, JSON.stringify({
    当前: { ...新任务({ 现在: Date.now(), 念头: '买玩偶', 预算上限: 100 }), 阶段: '找商品' },
    今日: { 日期: new Date().toISOString().slice(0, 10), 发起: 1 },
    上次汇报时: 0,
  }), 'utf8')
  const r = 用户说('不要了')
  assert.equal(r.任务.阶段, '取消')
})

// ── 重启存活 ──

await 测('⑬ 中途重启（重新读盘）状态还在 —— 不会假装没问过', async () => {
  writeFileSync(任务文件, JSON.stringify({
    当前: { ...新任务({ 现在: Date.now(), 念头: '买玩偶', 预算上限: 100 }), 阶段: '等确认', 商品: { 名称: '玩偶', 价格: 39 } },
    今日: { 日期: new Date().toISOString().slice(0, 10), 发起: 1 },
    上次汇报时: 0,
  }), 'utf8')
  // 模拟宿主重启：重新读一次盘
  const 盘 = 读盘()
  assert.equal(盘.当前.阶段, '等确认')
  assert.equal(盘.当前.商品.名称, '玩偶')
  // 重启后用户回"买吧"照样能推进
  const r = 用户说('买吧')
  assert.equal(r.任务.阶段, '下单中')
})

// ── 安全边界 ──

await 测('⑭ 用户说「买吧」但商品超预算 → 拒绝下单，并说明原因', async () => {
  writeFileSync(任务文件, JSON.stringify({
    当前: { ...新任务({ 现在: Date.now(), 念头: '买耳机', 预算上限: 50 }), 阶段: '等确认', 商品: { 名称: '贵耳机', 价格: 429 } },
    今日: { 日期: new Date().toISOString().slice(0, 10), 发起: 1 },
    上次汇报时: 0,
  }), 'utf8')
  const r = 用户说('买吧')
  assert.equal(r.任务.阶段, '失败', '超预算必须拦住')
  assert.ok(r.说话.includes('超过'), `要说清是超预算：${r.说话}`)
})

await 测('⑮ 「可以」和「买」在任何位置都不会被混淆', () => {
  // 穷举常见说法，确认两档分得开
  const 批准 = ['可以', '行', '好', '嗯', '去吧', '看看', '你看着办', 'ok', 'OK', '好的呀']
  const 确认 = ['买吧', '买了', '就它', '下单', '付款', '确认', '就要这个', '买']
  for (const 词 of 批准) {
    assert.equal(判意图(词), '批准', `「${词}」不该被当成确认`)
  }
  for (const 词 of 确认) {
    assert.equal(判意图(词), '确认', `「${词}」该是确认`)
  }
  // 两批不能有交集
  assert.equal(批准.filter((x) => 确认.includes(x)).length, 0, '两批词有重叠')
})

await 测('⑯ 试运行开着时，任务照样能推进（试运行只挡真发消息）', () => {
  const 配 = JSON.parse(readFileSync(配置文件, 'utf8'))
  assert.equal(配.试运行, true, '这个测试的前提是试运行开着')
  // 状态机不受试运行影响 —— 它只管"该不该做"，发不发是另一层的事
  const 簿 = 读盘()
  assert.ok(簿.当前, '试运行下任务状态也该在')
})

console.log(`\n${过} 项通过${process.exitCode ? '，有失败' : ''}`)
