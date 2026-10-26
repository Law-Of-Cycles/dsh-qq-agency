// 契约测试：验证「装进 DSH 之后不会崩」的那些硬约束。
//   · package.json 的 dsh 清单完整
//   · host.js 导出 name / inject / apply，且 inject 都是真服务名
//   · 每个工具定义的 JSON Schema 自洽（required ⊆ properties、没有内部标记漏出去）
//   · 工具的 render 返回合法的 content blocks
//   · client.js 能在模块加载器里跑起来并注册到设置页
// 跑：node tests/contract.test.mjs

import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'

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

const 包根 = join(import.meta.dirname, '..')
const 读 = (p) => readFileSync(join(包根, p), 'utf8')

console.log('contract（装进宿主前的硬约束）')

await 测('package.json：dsh 清单指向真实的 patch 与 client', () => {
  const p = JSON.parse(读('package.json'))
  assert.equal(p.name, 'dsh-qq-agency')
  assert.equal(p.type, 'module')
  assert.equal(p.main, 'lib/host.js')
  assert.ok(p.dsh && p.dsh.bundle && p.dsh.bundle.patch, '缺 dsh.bundle.patch')
  assert.equal(p.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(p.dsh.client, '缺 dsh.client')
  assert.equal(p.dsh.client.platform, 'web')
  assert.ok(Array.isArray(p.dsh.client.inject) && p.dsh.client.inject.includes('slots'))
  assert.ok(Array.isArray(p.dsh.client.external) && p.dsh.client.external.includes('react'))
  // 清单里提到的文件都得真的在
  for (const f of ['cordis.patch.yml', 'lib/host.js', 'lib/client.js', 'README.md', 'LICENSE']) {
    assert.ok(读(f).length > 0, `清单里的 ${f} 是空的或不存在`)
  }
})

await 测('cordis.patch.yml：插的是这个插件本身', () => {
  const 文 = 读('cordis.patch.yml')
  assert.ok(文.includes('insert:'), '缺 insert')
  assert.ok(文.includes("name: 'dsh-qq-agency'"), 'name 不是 dsh-qq-agency')
  assert.ok(文.includes('id: qq-agency'), '缺 id')
})

await 测('host.js：导出 name / inject / apply，inject 全是宿主真有的服务', () => {
  const 文 = 读('lib/host.js')
  assert.ok(/export const name = 'qq-agency'/.test(文))
  assert.ok(/export const inject = \[/.test(文))
  assert.ok(/export function apply\(ctx\)/.test(文))
  // 这些是 DSH 宿主的标准服务名，写错一个插件就起不来
  const 合法 = new Set(['agents', 'sessions', 'sessionTitle', 'webServer', 'timer', 'workspaceRegistry', 'attachments', 'tools', 'systemPrompt', 'jobs', 'subagents', 'goals', 'compaction', 'sandbox', 'approval', 'llm'])
  const m = 文.match(/export const inject = \[([^\]]+)\]/)
  const 名单 = m[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean)
  assert.ok(名单.length >= 4, `inject 太少：${名单}`)
  for (const 名 of 名单) assert.ok(合法.has(名), `inject 里有不认识的服务：${名}`)
})

// ---------- 装一遍，看工具 ----------
const 家 = mkdtempSync(join(tmpdir(), 'agency-contract-'))
mkdirSync(join(家, 'qq-agency'), { recursive: true })
process.env.DSH_HOME = 家
writeFileSync(join(家, 'qq-agency', 'config.json'), JSON.stringify({ 总开关: true, 试运行: true, 允许玩手机: false }), 'utf8')

const 工具表 = []
const 段落们 = []
const 假ctx = {
  logger: { info: () => {} },
  on: () => () => {},
  effect: (fn) => { try { const d = fn() } catch (e) {} return () => {} },
  interval: () => () => {},
  webServer: { register: () => () => {} },
  tools: { register: (t) => { 工具表.push(t); return () => {} } },
  systemPrompt: { section: (s) => { 段落们.push(s); return () => {} } },
  agents: { get: () => undefined },
  sessions: { list: () => [] },
  sessionTitle: { get: () => ({}) },
  get: () => undefined,
}

const { apply, name, inject } = await import('../lib/host.js')
apply(假ctx)

await 测('注册了工具（不然它没有手）', () => {
  assert.ok(工具表.length >= 8, `只注册了 ${工具表.length} 个工具`)
  const 名们 = 工具表.map((t) => t.name)
  for (const 必需 of ['agency_state', 'qq_speak', 'phone_status', 'phone_look', 'phone_tap', 'phone_swipe', 'phone_type', 'phone_open', 'phone_notifications']) {
    assert.ok(名们.includes(必需), `缺工具 ${必需}`)
  }
  assert.equal(new Set(名们).size, 名们.length, '有重名工具')
})

await 测('每个工具的 JSON Schema 自洽（模型会照着它调用）', () => {
  for (const t of 工具表) {
    assert.ok(t.name && /^[a-z][a-z0-9_]*$/.test(t.name), `工具名不规范：${t.name}`)
    assert.ok(typeof t.description === 'string' && t.description.length > 8, `${t.name} 说明太短`)
    const p = t.parameters
    assert.equal(p.type, 'object', `${t.name} 的参数根不是 object`)
    assert.ok(p.properties && typeof p.properties === 'object', `${t.name} 没有 properties`)
    for (const 键 of p.required || []) {
      assert.ok(键 in p.properties, `${t.name} 的 required 里有不存在的键：${键}`)
    }
    for (const [键, 值] of Object.entries(p.properties)) {
      assert.ok(!('__必填' in 值), `${t.name}.${键} 把内部标记漏给模型了`)
      assert.ok(值.type || 值.enum, `${t.name}.${键} 没有 type`)
    }
    assert.ok(t.output && t.output.schema, `${t.name} 缺 output.schema`)
    assert.equal(typeof t.output.render, 'function', `${t.name} 的 render 不是函数`)
    assert.equal(typeof t.execute, 'function', `${t.name} 的 execute 不是函数`)
  }
})

await 测('agency_state 真的能跑（不依赖网络）', async () => {
  const t = 工具表.find((x) => x.name === 'agency_state')
  const v = await t.execute({}, { signal: undefined })
  assert.ok(typeof v.摘要 === 'string' && v.摘要.includes('精力'), `返回不对：${JSON.stringify(v)}`)
  const 块 = t.output.render({}, v)
  assert.ok(Array.isArray(块) && 块.length >= 1 && 块[0].type === 'text', 'render 没返回文字块')
})

await 测('qq_speak 在试运行里拒绝真发（安全默认）', async () => {
  const t = 工具表.find((x) => x.name === 'qq_speak')
  const v = await t.execute({ 去哪: '群', 话: '测试' }, {})
  assert.equal(v.ok, false)
  assert.ok(String(v.说).includes('试运行'), `应该说明是试运行挡的：${v.说}`)
})

await 测('phone_status 返回合法结构，不把宿主带崩', async () => {
  const t = 工具表.find((x) => x.name === 'phone_status')
  const v = await t.execute({}, {})
  assert.equal(typeof v.在线, 'boolean')
  if (!v.在线) {
    assert.ok(typeof v.错 === 'string' && v.错.length > 0)
  }
  const 块 = t.output.render({}, v)
  assert.equal(块[0].type, 'text')
})

await 测('phone_look 拿不到手机时抛异常（基础设施故障该抛）', async () => {
  const t = 工具表.find((x) => x.name === 'phone_look')
  await assert.rejects(() => t.execute({}, {}))
})

await 测('系统提示词注册了「你是活的」那一段', () => {
  const 段 = 段落们.find((s) => s.name === 'qq-agency')
  assert.ok(段, '没注册提示词 section')
  assert.ok(Number.isFinite(段.order), 'order 不是数字')
  const 文 = typeof 段.text === 'function' ? 段.text({}) : 段.text
  assert.ok(typeof 文 === 'string' && 文.length > 0, '总开关开着时提示词不该是空的')
  assert.ok(文.includes('你是活的') || 文.includes('精力'), `提示词内容不对：${文.slice(0, 80)}`)
})

await 测('总开关关着时，提示词一个字都不加', () => {
  writeFileSync(join(家, 'qq-agency', 'config.json'), JSON.stringify({ 总开关: false }), 'utf8')
  const 段 = 段落们.find((s) => s.name === 'qq-agency')
  const 文 = typeof 段.text === 'function' ? 段.text({}) : 段.text
  assert.equal(文, '')
})

await 测('client.js 能在模块加载器里跑起来，并注册到设置页', () => {
  const 源 = 读('lib/client.js')
  let 载入 = null
  const 注册们 = []
  const 沙箱 = {
    window: { __ModuleLoader__: { load: (x) => { 载入 = x } } },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
  }
  沙箱.window.window = 沙箱.window
  vm.createContext(沙箱)
  vm.runInContext(源, 沙箱, { filename: 'client.js' })

  assert.ok(载入, '没调用 __ModuleLoader__.load')
  assert.equal(载入.id, 'dsh-qq-agency')
  assert.equal(typeof 载入.factory, 'function')

  const 假React = {
    createElement: (t, p, ...c) => ({ t, p, c }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useCallback: (f) => f,
    useMemo: (f) => f(),
    useRef: (v) => ({ current: v }),
  }
  const 导出 = 载入.factory((名) => (名 === 'react' ? 假React : {}))
  assert.equal(typeof 导出.apply, 'function', 'client 没导出 apply')
  assert.ok(Array.isArray(导出.inject) && 导出.inject.includes('slots'))

  const 假slots = {
    inject: (_槽, fn) => fn(),
    register: (元, 组件) => { 注册们.push({ 元, 组件 }); return () => {} },
  }
  导出.apply({ get: () => 假slots })
  assert.equal(注册们.length, 1, `注册了 ${注册们.length} 次`)
  assert.equal(注册们[0].元.name, 'settings.section')
  assert.equal(注册们[0].元.id, 'qq-agency')
  assert.equal(typeof 注册们[0].元.label(), 'string')
  assert.equal(typeof 注册们[0].组件, 'function', '注册的不是组件')
})

await 测('设置页引用的每条路由，宿主那半边都真的有', () => {
  const 客户端 = 读('lib/client.js')
  const 服务端 = 读('lib/host.js')
  const 用的 = [...客户端.matchAll(/['"]\/(state|save|poke|say|phone|groups|reset-mind|task|task-start)['"]/g)].map((m) => m[1])
  assert.ok(用的.length >= 5, `客户端引用的路由太少：${用的}`)
  for (const 路 of new Set(用的)) {
    assert.ok(服务端.includes(`\${路由前缀}/${路}`), `host.js 里没有 /${路} 这条路由`)
  }
})

await 测('任务：有 agency_task 工具，且参数能表达完整流程', () => {
  const t = 工具表.find((x) => x.name === 'agency_task')
  assert.ok(t, '缺 agency_task 工具')
  const 动作 = t.parameters.properties.动作
  assert.ok(动作 && Array.isArray(动作.enum), '动作 应该是枚举')
  for (const a of ['起念头', '找到商品', '下单成功', '失败']) {
    assert.ok(动作.enum.includes(a), `动作里缺「${a}」`)
  }
  assert.ok(t.parameters.properties.商品名, '缺 商品名')
  assert.ok(t.parameters.properties.价格, '缺 价格')
  // 说明里必须写清「不能自己下单」—— 这是安全边界，不能只靠代码拦
  assert.ok(/不要自己下单|等对方/.test(t.description), `说明里没写清不能自己下单：${t.description}`)
})

await 测('任务：没开「允许办事」时 agency_task 拒绝起念头（默认关）', async () => {
  writeFileSync(join(家, 'qq-agency', 'config.json'), JSON.stringify({ 总开关: true, 允许办事: false }), 'utf8')
  const t = 工具表.find((x) => x.name === 'agency_task')
  const v = await t.execute({ 动作: '起念头', 念头: '想买个玩偶' }, {})
  assert.equal(v.ok, false)
  assert.ok(String(v.说).includes('允许办事'), `应该说清是被哪个开关挡的：${v.说}`)
})

await 测('任务：开了之后能起念头，并停在「等授权」（不会自己开干）', async () => {
  writeFileSync(join(家, 'qq-agency', 'config.json'), JSON.stringify({ 总开关: true, 允许办事: true, 单笔预算上限: 100, 每天最多办事: 2 }), 'utf8')
  const t = 工具表.find((x) => x.name === 'agency_task')
  const v = await t.execute({ 动作: '起念头', 念头: '想买个玩偶' }, {})
  assert.equal(v.ok, true, `起念头失败：${v.说}`)
  assert.equal(v.阶段, '等授权', '起完念头必须停在等授权')
  // 落盘了吗
  const 盘 = JSON.parse(readFileSync(join(家, 'qq-agency', 'tasks.json'), 'utf8'))
  assert.ok(盘.当前 && 盘.当前.念头 === '想买个玩偶', '任务没落盘')
  assert.equal(盘.当前.阶段, '等授权')
})

await 测('任务：超预算的商品不会进入「等确认」', async () => {
  writeFileSync(join(家, 'qq-agency', 'config.json'), JSON.stringify({ 总开关: true, 允许办事: true, 单笔预算上限: 50 }), 'utf8')
  writeFileSync(join(家, 'qq-agency', 'tasks.json'), JSON.stringify({
    当前: { id: 't1', 类型: '办事', 念头: '买耳机', 阶段: '找商品', 预算上限: 50, 商品: null, 已花: 0, 建时: Date.now(), 改时: Date.now(), 超时: Date.now() + 600000, 历史: [] },
    今日: { 日期: new Date().toISOString().slice(0, 10), 发起: 1 },
    上次汇报时: 0,
  }), 'utf8')
  const t = 工具表.find((x) => x.name === 'agency_task')
  const v = await t.execute({ 动作: '找到商品', 商品名: '贵耳机', 价格: 429 }, {})
  assert.equal(v.阶段, '找商品', '超预算不该进到等确认')
  assert.ok(String(v.警告).includes('超预算'), `应该报超预算：${JSON.stringify(v)}`)
})

await 测('任务：起念头落盘后，第二次起念头会被拒（同时只办一件事）', async () => {
  writeFileSync(join(家, 'qq-agency', 'config.json'), JSON.stringify({ 总开关: true, 允许办事: true, 单笔预算上限: 100, 每天最多办事: 2 }), 'utf8')
  writeFileSync(join(家, 'qq-agency', 'tasks.json'), JSON.stringify({
    当前: { id: 't1', 类型: '办事', 念头: '买玩偶', 阶段: '找商品', 预算上限: 100, 商品: null, 已花: 0, 建时: Date.now(), 改时: Date.now(), 超时: Date.now() + 600000, 历史: [] },
    今日: { 日期: new Date().toISOString().slice(0, 10), 发起: 1 },
    上次汇报时: 0,
  }), 'utf8')
  const t = 工具表.find((x) => x.name === 'agency_task')
  const v = await t.execute({ 动作: '起念头', 念头: '还想买别的' }, {})
  assert.equal(v.ok, false)
  assert.ok(String(v.说).includes('还有一件事'), `应该说清手上还有活：${v.说}`)
})

await 测('群聊能「拉列表勾选」，不是只能手填', () => {
  const 客户端 = 读('lib/client.js')
  const 服务端 = 读('lib/host.js')
  const qq = 读('lib/qq.js')
  assert.ok(qq.includes('get_group_list'), 'qq.js 没实现拉群列表')
  assert.ok(服务端.includes('群缓存文件'), 'host.js 没把群列表落文件')
  assert.ok(服务端.includes('groups.json'), '群列表缓存文件不叫 groups.json')
  assert.ok(客户端.includes('从 QQ 拉取我的群'), '设置页没有拉取按钮')
  assert.ok(客户端.includes('群列表文件'), '设置页没显示群列表存在哪')
  assert.ok(客户端.includes('拼群号'), '设置页没有勾选逻辑')
})

await 测('手机有「看界面」和「按文字点」两个工具（不然点不准）', () => {
  const 名们 = 工具表.map((t) => t.name)
  assert.ok(名们.includes('phone_ui'), '缺 phone_ui')
  assert.ok(名们.includes('phone_tap_text'), '缺 phone_tap_text')
  const 点工具 = 工具表.find((t) => t.name === 'phone_tap_text')
  assert.ok(点工具.parameters.properties.文字, 'phone_tap_text 缺 文字 参数')
})

await 测('README 里写了「别和 dsh-qq-bridge 同时抢同一间会话」', () => {
  const 文 = 读('README.md')
  assert.ok(文.includes('dsh-qq-bridge'), 'README 没提和 bridge 的关系')
  assert.ok(/二选一|只留一个|关掉/.test(文), 'README 没说清楚冲突怎么处理')
})

console.log(`\n${过} 项通过${process.exitCode ? '，有失败' : ''}`)
