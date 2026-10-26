// dsh-qq-agency · 宿主半边
//
// 这一半负责「活着」：
//   每 N 秒一次心跳 → 看看世界（群里在聊什么、主人多久没说话、手机还亮着吗）
//   → 推进内心（lib/mind.js）→ 决定要不要做点什么
//   → 做：在群里接话 / 私聊找主人 / 拿起手机刷一会儿 / 什么都不做
//
// 它不负责「DSH ↔ QQ 的通路」（那是 dsh-qq-bridge 的活），只负责
// 「没人叫它的时候，它自己会不会动」。
//
// ⚠ 安全默认：总开关 = false、试运行 = true —— 不手动打开，它一句都不会真的发出去。

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { 默认内心, 归一化内心, 推进内心, 构造独白, 摘要, 加念头, 日期串, 夹 } from './mind.js'
import { 建QQ, 解析一条, 别人的话, 话题命中 } from './qq.js'
import { 建手机, 删图, 候选adb } from './phone.js'
import { 新任务, 推进任务, 任务提示, 任务摘要, 是活的, 判意图, 该汇报吗, 阶段说法 } from './task.js'

export const name = 'qq-agency'

/**
 * 需要宿主提供：
 *   agents（让它开口）、sessions/sessionTitle（选目标会话）、webServer（设置页接口）、
 *   timer（心跳）、tools（手机与主动发言工具）、systemPrompt（把「你有身体」写进提示词）。
 * 可选：attachments（把手机截图交给模型看）、workspaceRegistry（列会话）。
 */
export const inject = ['agents', 'sessions', 'webServer', 'timer', 'tools', 'systemPrompt']

// ---------- 常量 ----------

const 家目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 数据目录 = join(家目录, 'qq-agency')
const 配置文件 = join(数据目录, 'config.json')
const 内心文件 = join(数据目录, 'mind.json')
const 流水文件 = join(数据目录, 'journal.jsonl')
const 截图目录 = join(数据目录, 'shots')
const 群缓存文件 = join(数据目录, 'groups.json')
const 任务文件 = join(数据目录, 'tasks.json')
const 路由前缀 = '/dsh-qq-agency'
const 日志上限 = 80

const 默认配置 = {
  总开关: false, // 关着 = 心跳照走、一句都不发
  试运行: true, // 开着 = 只在记录里写「本来想做什么」
  主动性: 50, // 0 很安静 … 100 很黏人
  心跳秒: 30, // 多久想一次事（10–600）

  目标会话: '', // 用哪个 DSH 会话当它的脑子
  称呼: '主人', // 它怎么叫那个人
  主人QQ: '',
  群号们: '', // 逗号 / 空格分隔，可填多个
  话题词: '', // 提到这些词算「跟我有关」

  NapCat: 'http://127.0.0.1:3000', // OneBot 11 HTTP
  NapCat令牌: '',

  私聊直达: true, // 主人私聊它 → 转进 DSH 会话，让它正常回（和 dsh-qq-bridge 二选一）
  群被叫直达: true, // 群里 @ 它 → 转进会话让它回

  插话冷却分: 8, // 刚在群里说过话，这么久内不再主动插嘴
  找主人冷却分: 90,
  每天最多找主人: 6,
  免打扰开始: '23:30',
  免打扰结束: '07:30',

  允许玩手机: true,
  玩手机冷却分: 25,
  玩手机后汇报: true,
  ADB路径: 'adb',
  手机序列号: '',
  允许任意shell: false,

  // 任务（要跑几分钟、中间要问人的事，比如"去拼多多买个玩偶"）
  允许办事: false, // 关着 = 只会刷手机看通知，不会自己发起任务
  单笔预算上限: 100, // 0 = 不限（不建议）
  每天最多办事: 2, // 一天最多发起几个任务
  办事要确认: true, // 下单前必须用户再点头（强烈建议保持开着）

  人格补充: '', // 追加到系统提示词末尾
}

const 版本 = (() => {
  try {
    const p = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
    return String(p.version || '?')
  } catch (error) {
    return '?'
  }
})()

// ---------- 配置 ----------

const 布 = (值, 兜) => {
  if (值 === true || 值 === 'true' || 值 === 1 || 值 === '1') return true
  if (值 === false || 值 === 'false' || 值 === 0 || 值 === '0') return false
  return 兜
}

/** 把外部给的配置洗成能用的形状（旧版本、手改、空值都兜住）。 */
export function 归一化配置(原始) {
  const 是对象 = 原始 && typeof 原始 === 'object' && !Array.isArray(原始)
  const 混 = 是对象 ? { ...默认配置, ...原始 } : { ...默认配置 }
  const 字 = (v, 兜 = '') => (typeof v === 'string' ? v.trim() : 兜)
  const 数 = (v, 兜, 低, 高) => {
    const n = Math.round(Number(v))
    if (!Number.isFinite(n)) return 兜
    return Math.max(低, Math.min(高, n))
  }
  const 时刻 = (v, 兜) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v || '').trim()) ? String(v).trim() : 兜)
  return {
    总开关: 布(混.总开关, 默认配置.总开关),
    试运行: 布(混.试运行, 默认配置.试运行),
    主动性: 数(混.主动性, 默认配置.主动性, 0, 100),
    心跳秒: 数(混.心跳秒, 默认配置.心跳秒, 10, 600),

    目标会话: 字(混.目标会话),
    称呼: 字(混.称呼) || 默认配置.称呼,
    主人QQ: 字(混.主人QQ),
    群号们: 字(混.群号们),
    话题词: 字(混.话题词),

    NapCat: 字(混.NapCat) || 默认配置.NapCat,
    NapCat令牌: 字(混.NapCat令牌),

    私聊直达: 布(混.私聊直达, 默认配置.私聊直达),
    群被叫直达: 布(混.群被叫直达, 默认配置.群被叫直达),

    插话冷却分: 数(混.插话冷却分, 默认配置.插话冷却分, 1, 240),
    找主人冷却分: 数(混.找主人冷却分, 默认配置.找主人冷却分, 5, 1440),
    每天最多找主人: 数(混.每天最多找主人, 默认配置.每天最多找主人, 0, 50),
    免打扰开始: 时刻(混.免打扰开始, 默认配置.免打扰开始),
    免打扰结束: 时刻(混.免打扰结束, 默认配置.免打扰结束),

    允许玩手机: 布(混.允许玩手机, 默认配置.允许玩手机),
    玩手机冷却分: 数(混.玩手机冷却分, 默认配置.玩手机冷却分, 1, 720),
    玩手机后汇报: 布(混.玩手机后汇报, 默认配置.玩手机后汇报),
    ADB路径: 字(混.ADB路径) || 默认配置.ADB路径,
    手机序列号: 字(混.手机序列号),
    允许任意shell: 布(混.允许任意shell, 默认配置.允许任意shell),

    允许办事: 布(混.允许办事, 默认配置.允许办事),
    单笔预算上限: 数(混.单笔预算上限, 默认配置.单笔预算上限, 0, 100000),
    每天最多办事: 数(混.每天最多办事, 默认配置.每天最多办事, 0, 20),
    办事要确认: 布(混.办事要确认, 默认配置.办事要确认),

    人格补充: typeof 混.人格补充 === 'string' ? 混.人格补充.slice(0, 4000) : '',
  }
}

/** 「12:30」→ 分钟数；不合法返回 null。 */
export function 解析时刻(s) {
  const m = String(s || '').match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** 现在是不是免打扰（支持跨午夜，比如 23:30 → 07:30）。 */
export function 在免打扰(配置, 现在 = Date.now()) {
  const 起 = 解析时刻(配置 && 配置.免打扰开始)
  const 止 = 解析时刻(配置 && 配置.免打扰结束)
  if (起 === null || 止 === null || 起 === 止) return false
  const d = new Date(现在)
  const 分 = d.getHours() * 60 + d.getMinutes()
  return 起 <= 止 ? 分 >= 起 && 分 < 止 : 分 >= 起 || 分 < 止
}

/** 「123, 456 789」→ [123, 456, 789]。 */
export function 解析群号们(s) {
  return String(s || '')
    .split(/[,，\s;；]+/)
    .map((x) => x.trim())
    .filter((x) => /^\d{5,15}$/.test(x))
    .map(Number)
}

/** 读群列表缓存（拉过就有；没拉过就是空的）。 */
function 读群缓存() {
  try {
    const j = JSON.parse(readFileSync(群缓存文件, 'utf8'))
    const 群们 = Array.isArray(j) ? j : (j && Array.isArray(j.群们) ? j.群们 : [])
    return 群们
      .map((g) => ({ 群号: String((g && g.群号) || ''), 名称: String((g && g.名称) || ''), 人数: Number((g && g.人数) || 0) }))
      .filter((g) => g.群号)
  } catch (error) {
    return []
  }
}

function 读配置() {
  try {
    return 归一化配置(JSON.parse(readFileSync(配置文件, 'utf8')))
  } catch (error) {
    return 归一化配置(null)
  }
}

function 写配置(配置) {
  try {
    mkdirSync(数据目录, { recursive: true })
    writeFileSync(配置文件, JSON.stringify(配置, null, 2), 'utf8')
    return true
  } catch (error) {
    return false
  }
}

// ---------- 纯函数（导出给测试喂）----------

/** 从一条 assistant 消息里只抽正文（reasoning / 图片都不要）。 */
export function 提取正文(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/** 会话 id 的两种写法（`xxx` / `session-xxx`）统一成裸 id。 */
export const 会话键 = (v) => {
  const s = String(v == null ? '' : v).trim()
  return s.startsWith('session-') ? s.slice('session-'.length) : s
}

/**
 * 把「群里刚发生的事」写成交给模型的一段话。
 * 只给最近几条、带发言人名字 —— 让它接得上话，而不是收到一堆孤立句子。
 */
export function 群上下文文案(群名, 条们, 我的QQ, 被点) {
  const 行们 = []
  for (const 条 of 条们.slice(-12)) {
    const 谁 = 条.名字 || 条.QQ号 || '某人'
    const 说了什么 = 条.文字 || (条.图们.length ? '（发了一张图）' : '')
    if (!说了什么) continue
    行们.push(`${谁}: ${说了什么}`)
  }
  const 头 = `【群「${群名 || '群'}」里刚发生的事】`
  const 尾 = 被点
    ? '（有人提到了你。用你平时说话的样子回一句 —— 别解释自己在干什么，别加旁白，直接给出发出去的话。）'
    : '（这些是群里刚说的话。你被叫到了，回一句。）'
  return [头, ...行们, 尾].join('\n')
}

// ---------- 插件本体 ----------

export function apply(ctx) {
  // ---------- 状态 ----------

  const 日志 = []
  let 正在心跳 = false
  let 停心跳 = null
  let 上次心跳时间 = 0
  let 我的QQ = ''
  let 我的昵称 = ''

  /** 上次看到的消息时间（按群 / 私聊分开），防止重启后补一屏旧消息。 */
  const 群游标 = new Map() // 群号 -> 秒
  let 私聊游标 = Math.floor(Date.now() / 1000)
  /** 已经处理过的消息 id（防重复）。 */
  const 已处理 = new Set()

  /** 等它把话说完：会话键 -> 任务队列（followup 是排队的，turn/end 也按同样顺序来） */
  const 待发 = new Map()
  /** 这一轮它说了什么：会话键 -> 文本 */
  const 本轮文本 = new Map()
  /** 这一轮是否调过发送类工具：会话键 -> boolean */
  const 本轮已发工具 = new Map()
  /** 手机截图：路径 -> image content block（render 是同步的，图得先在 execute 里备好） */
  const 截图缓存 = new Map()

  function 记账(文本) {
    const d = new Date()
    const 补 = (n) => String(n).padStart(2, '0')
    const 时间 = `${补(d.getMonth() + 1)}-${补(d.getDate())} ${补(d.getHours())}:${补(d.getMinutes())}:${补(d.getSeconds())}`
    日志.push({ 时间, 文本 })
    if (日志.length > 日志上限) 日志.shift()
    try { ctx.logger?.info(`qq-agency: ${文本}`) } catch (error) {}
  }

  /** 内心流水（跨重启留一份，方便回头看「它那天在想什么」）。 */
  function 记流水(心, 决定) {
    try {
      mkdirSync(数据目录, { recursive: true })
      const 行 = JSON.stringify({
        时间: new Date().toISOString(),
        动作: 决定.动作,
        分数: Number(决定.分数.toFixed(3)),
        理由: 决定.理由,
        冲动: {
          群: Number((决定.冲动们 && 决定.冲动们.群 || 0).toFixed(3)),
          主人: Number((决定.冲动们 && 决定.冲动们.主人 || 0).toFixed(3)),
          手机: Number((决定.冲动们 && 决定.冲动们.手机 || 0).toFixed(3)),
        },
        状态: { 精力: 心.精力, 无聊: 心.无聊, 想念: 心.想念 },
      })
      appendFileSync(流水文件, 行 + '\n', 'utf8')
    } catch (error) {}
  }

  function 读心() {
    try {
      return 归一化内心(JSON.parse(readFileSync(内心文件, 'utf8')))
    } catch (error) {
      return 默认内心()
    }
  }

  function 写心(心) {
    try {
      mkdirSync(数据目录, { recursive: true })
      writeFileSync(内心文件, JSON.stringify(心, null, 2), 'utf8')
      return true
    } catch (error) {
      return false
    }
  }

  // ---------- 任务落盘 ----------
  // 一个任务要跨好几个心跳、好几次 followup，中途宿主可能重启。
  // 不落盘的话，"等用户点头"这件事一重启就丢了 —— 用户回来发现它装作没问过。

  /** 读任务簿：{ 当前: 任务|null, 今日: { 日期, 发起 }, 上次汇报时 } */
  function 读任务簿() {
    const 空 = { 当前: null, 今日: { 日期: 日期串(Date.now()), 发起: 0 }, 上次汇报时: 0 }
    try {
      const j = JSON.parse(readFileSync(任务文件, 'utf8'))
      if (!j || typeof j !== 'object') return 空
      const 今 = 日期串(Date.now())
      const 日 = j.今日 && j.今日.日期 === 今 ? j.今日 : { 日期: 今, 发起: 0 }
      return {
        当前: j.当前 && typeof j.当前 === 'object' ? j.当前 : null,
        今日: { 日期: 今, 发起: Number(日.发起) || 0 },
        上次汇报时: Number(j.上次汇报时) || 0,
      }
    } catch (error) {
      return 空
    }
  }

  function 写任务簿(簿) {
    try {
      mkdirSync(数据目录, { recursive: true })
      writeFileSync(任务文件, JSON.stringify(簿, null, 2), 'utf8')
      return true
    } catch (error) {
      return false
    }
  }

  /** 把一次推进的结果写回盘上（顺手更新每日计数）。 */
  function 存任务(簿, 新任务对象) {
    const 今 = 日期串(Date.now())
    const 今日 = 簿.今日 && 簿.今日.日期 === 今 ? { ...簿.今日 } : { 日期: 今, 发起: 0 }
    // 新起一个任务才计数（不是每次推进都加）
    if (新任务对象 && 新任务对象.id !== (簿.当前 && 簿.当前.id) && 新任务对象.阶段 === '念头') 今日.发起 += 1
    写任务簿({ ...簿, 当前: 新任务对象 || null, 今日 })
    return { ...簿, 当前: 新任务对象 || null, 今日 }
  }

  /** 每次都用最新配置建一个轻客户端：改了地址不用重启。 */
  function 拿QQ(配置) {
    return 建QQ({ 基址: 配置.NapCat, 令牌: 配置.NapCat令牌 })
  }

  function 拿手机(配置) {
    return 建手机({ adb: 配置.ADB路径, 序列号: 配置.手机序列号, 临时目录: 截图目录 })
  }

  const 短id = (id) => {
    const s = String(id)
    return s.length <= 8 ? s : s.slice(-8)
  }

  const 新id = () => {
    try { return randomUUID() } catch (error) { return 'agency-' + Date.now() + '-' + Math.random().toString(36).slice(2) }
  }

  /** 找活着的 agent：带 / 不带 `session-` 前缀两个方向都试。 */
  const 找agent = (id) => {
    const 原 = String(id == null ? '' : id).trim()
    if (!原) return undefined
    const 候选 = [原]
    候选.push(原.startsWith('session-') ? 原.slice('session-'.length) : 'session-' + 原)
    for (const 一个 of 候选) {
      try {
        const a = ctx.agents?.get?.(一个)
        if (a !== undefined && a !== null) return a
      } catch (error) {}
    }
    try {
      const 纯键 = 会话键(原)
      const 列表 = ctx.agents?.list?.() || []
      const 命 = 列表.find((a) => {
        const sid = a?.session?.id || a?.sessionId || a?.id
        return 会话键(sid) === 纯键
      })
      if (命) return 命
      if (列表.length > 0) return 列表[0]
    } catch (error) {}
    return undefined
  }

  /** 现在开着的会话（设置页挑「目标会话」用，不手填 id）。 */
  const 会话清单 = () => {
    const 出 = []
    const 归档 = new Set()
    try {
      const 登记 = ctx.workspaceRegistry || ctx.get('workspaceRegistry')
      for (const x of (登记 && 登记.archivedSessionIds) || []) 归档.add(String(x))
    } catch (error) {}
    try {
      const 会话服务 = ctx.get('sessions')
      const 标题服务 = ctx.get('sessionTitle')
      if (会话服务 && typeof 会话服务.list === 'function') {
        for (const s of 会话服务.list()) {
          if (!s || 归档.has(String(s.id))) continue
          let 标题 = ''
          try {
            const 快照 = 标题服务 && typeof 标题服务.get === 'function' ? 标题服务.get(s) : undefined
            标题 = 快照 && 快照.title ? String(快照.title) : ''
          } catch (error) {}
          出.push({ id: String(s.id), 标题 })
        }
      }
    } catch (error) {}
    return 出
  }

  // ---------- 采样：世界现在什么样 ----------

  async function 采样(配置, QQ) {
    const 现在 = Date.now()
    const 群们 = []
    const 话题表 = String(配置.话题词 || '').split(/[,，\s]+/).filter(Boolean)

    for (const 群号 of 解析群号们(配置.群号们)) {
      const 条们 = await QQ.拉群(群号, 30)
      const 别人 = 别人的话(条们, 我的QQ)
      const 游标 = 群游标.get(群号) || Math.floor(现在 / 1000)
      const 新的 = 别人.filter((x) => x.时间 >= 游标)
      const 群名 = (条们.length && 条们[条们.length - 1] && String(条们[条们.length - 1].group_name || '')) || String(群号)
      const 被点 = 新的.some((x) => x.提到我 || 提名字(x.文字))
      const 命中 = 话题命中(新的.map((x) => x.文字), 话题表)

      if (新的.length) 群游标.set(群号, Math.max(...新的.map((x) => x.时间)) + 1)

      群们.push({
        群号,
        名称: 群名,
        新消息: 新的.length,
        发言人数: new Set(新的.map((x) => x.QQ号)).size,
        最近时间: 新的.length ? Math.max(...新的.map((x) => x.时间)) * 1000 : 0,
        最后一条: 新的.length ? (新的[新的.length - 1].文字 || '') : '',
        提到我: 被点,
        话题命中: 命中,
      })
    }

    // 主人私聊：只用来判断「他多久没出现了」；要不要回由配置决定
    let 主人最后 = 0
    let 主人新消息 = []
    if (配置.主人QQ) {
      const 条们 = await QQ.拉私聊(配置.主人QQ, 10)
      const 别人 = 别人的话(条们, 我的QQ)
      主人最后 = 别人.length ? Math.max(...别人.map((x) => x.时间)) * 1000 : 0
      主人新消息 = 别人.filter((x) => x.时间 >= 私聊游标)
      if (别人.length) 私聊游标 = Math.max(...别人.map((x) => x.时间)) + 1
    }

    // 手机：只有真的配了才去问，免得每次心跳都等 adb
    let 手机 = null
    if (配置.允许玩手机) {
      try {
        const 状 = await 拿手机(配置).状态()
        手机 = 状.ok
          ? { 在线: true, 电量: 状.电量, 亮屏: 状.亮屏, 前台: 状.前台, 分辨率: 状.分辨率 }
          : { 在线: false, 错: 状.错 }
      } catch (error) {
        手机 = { 在线: false, 错: String((error && error.message) || error) }
      }
    }

    return { 现在, 群们, 主人: { 最后消息时间: 主人最后, 新消息: 主人新消息 }, 手机 }
  }

  /** 文字里出现它的名字也算被叫（群里不一定用 @）。 */
  function 提名字(文字) {
    const 名 = String(我的昵称 || '').trim()
    if (!名 || 名.length < 2) return false
    return String(文字 || '').includes(名)
  }

  // ---------- 让它说话 ----------

  /**
   * 让它在某个会话里「想一下并开口」。
   * 独白进去 → 它这一轮的正文出来 → turn/end 时由 发出去 落地。
   */
  async function 让它开口(配置, { 类型, 目标, 文案, 来由 }) {
    const agent = 找agent(配置.目标会话)
    if (!agent) {
      记账(`目标会话没活着（${短id(配置.目标会话) || '没配'}），这次说不了`)
      return false
    }
    const 键 = 会话键(配置.目标会话)
    const 队列 = 待发.get(键) || []
    队列.push({ 类型, 目标: String(目标 || ''), 截止: Date.now() + 180000, 来由: String(来由 || '') })
    待发.set(键, 队列)
    try {
      // ⚠ 必须 await：followup 的 rejection 没接住会让整个宿主退出
      await agent.followup({
        id: 新id(),
        role: 'user',
        content: [{ type: 'text', text: String(文案) }],
        source: { kind: 'qq-agency' },
      })
      return true
    } catch (error) {
      // 这条没排上，把占位还回去，免得后面错位
      const 现 = 待发.get(键) || []
      const 位 = 现.lastIndexOf(队列[队列.length - 1])
      if (位 >= 0) 现.splice(位, 1)
      if (现.length) 待发.set(键, 现)
      else 待发.delete(键)
      记账(`followup 失败：${String((error && error.message) || error)}`)
      return false
    }
  }

  /** 把一句话真的发到 QQ，并把「说过话了」记回内心。 */
  async function 发出去(配置, 任务, 文本) {
    const 文 = String(文本 || '').trim()
    if (!文) return { ok: false, 错: '没有内容' }
    const QQ = 拿QQ(配置)
    let 结果
    if (任务.类型 === '群') 结果 = await QQ.发群(任务.目标, 文)
    else 结果 = await QQ.发私聊(任务.目标, 文)

    const 心 = 读心()
    const 现在 = Date.now()
    // 跨天了先把今天的计数归零（不然「今天最多找主人 N 次」会被昨天用光）
    if (心.今日.日期 !== 日期串(现在)) 心.今日 = { 日期: 日期串(现在), 群发言: 0, 私聊主人: 0 }
    if (结果.ok) {
      if (任务.类型 === '群') {
        心.上次群发言 = 现在
        心.今日.群发言 += 1
        心.累计.群发言 += 1
      } else {
        心.上次私聊主人 = 现在
        心.今日.私聊主人 += 1
        心.累计.私聊主人 += 1
      }
      心.念头 = 加念头(心.念头, 现在, `${任务.类型 === '群' ? '在群里' : '私聊'}说了：${文.slice(0, 120)}`)
      写心(心)
      记账(`✅ 已发${任务.类型 === '群' ? `群 ${任务.目标}` : `私聊 ${任务.目标}`}：「${文.slice(0, 60)}${文.length > 60 ? '…' : ''}」`)
    } else {
      记账(`⚠ 发不出去：${结果.错}`)
    }
    return 结果
  }

  // ---------- 一次心跳 ----------

  async function 心跳() {
    if (正在心跳) return
    正在心跳 = true
    try {
      const 配置 = 读配置()
      上次心跳时间 = Date.now()
      if (!配置.总开关) return

      const QQ = 拿QQ(配置)
      if (!我的QQ) {
        const 登 = await QQ.登录信息()
        if (!登.ok) {
          记账(`QQ 后端连不上（${配置.NapCat}）：${登.错}`)
          return // 不知道「我是谁」就不能采样：会把自己的话当成别人说的
        }
        我的QQ = 登.QQ号
        我的昵称 = 登.昵称
        记账(`连着的 QQ：${我的昵称 || '?'}（${我的QQ}）`)
      }

      const 采样结果 = await 采样(配置, QQ)
      const 免打扰 = 在免打扰(配置, 采样结果.现在)

      // ── 确定性回应：主人私聊来了 / 群里点名了 ──
      // 这两件事不看内心：人都叫到脸上了，先应一声，别让它「今天不想说话」。
      const 私聊新 = 采样结果.主人.新消息
      if (配置.私聊直达 && 配置.主人QQ && 私聊新.length) {
        const 最后 = 私聊新[私聊新.length - 1]
        if (!已处理.has(最后.id)) {
          已处理.add(最后.id)

          // ── 先过任务状态机：如果手上有事，"可以 / 买吧 / 算了" 是任务指令 ──
          // 顺序很重要：任务优先。不然用户回一句"可以"，模型会当成闲聊回一句"嗯嗯"，
          // 任务就永远卡在等授权了。
          const 接了 = await 接住任务回话(配置, 私聊新)

          const 文案 = [
            `【${配置.称呼}私聊你】`,
            ...私聊新.map((x) => `${配置.称呼}: ${x.文字 || '（一张图）'}`),
            接了 ? `（关于你手上那件事：${接了}。照这个往下走，别问第二遍。）` : '',
            '（回他一句。用你平时说话的样子，别解释，别旁白，直接给出发出去的话。）',
          ].filter(Boolean).join('\n')
          if (配置.试运行) 记账(`[试运行] 主人私聊来了，本该回一句：「${(最后.文字 || '').slice(0, 40)}」`)
          else await 让它开口(配置, { 类型: '私聊', 目标: 配置.主人QQ, 文案, 来由: 接了 ? `任务推进：${接了}` : '主人来找我了' })
        }
      }

      for (const 群 of 采样结果.群们) {
        if (!配置.群被叫直达 || !群.提到我) continue
        const 上下文 = await QQ.拉群(群.群号, 20)
        const 文案 = 群上下文文案(群.名称, 别人的话(上下文, 我的QQ), 我的QQ, true)
        if (配置.试运行) 记账(`[试运行] 群里有人叫它（${群.名称}），本该回一句`)
        else await 让它开口(配置, { 类型: '群', 目标: String(群.群号), 文案, 来由: '群里有人叫我' })
      }

      // 自发行为：走内心
      const 心 = 读心()
      const { 心: 新心, 决定 } = 推进内心(
        心,
        { 现在: 采样结果.现在, 群们: 采样结果.群们, 主人: 采样结果.主人, 手机: 采样结果.手机 },
        {
          主动性: 配置.主动性,
          插话冷却分: 配置.插话冷却分,
          找主人冷却分: 配置.找主人冷却分,
          每天最多找主人: 配置.每天最多找主人,
          允许玩手机: 配置.允许玩手机,
          免打扰,
          主人QQ: 配置.主人QQ,
          称呼: 配置.称呼,
        },
      )

      if (决定.动作 === 'idle') {
        写心(新心)
        记流水(新心, 决定)
        return
      }

      // 免打扰里除了「被点名」以外一律压住（内心已经给了惩罚，这里再兜一层）
      if (免打扰 && 决定.动作 !== 'use_phone') {
        写心(新心)
        记流水(新心, { ...决定, 动作: 'idle', 理由: `免打扰时段，本来想${决定.动作}` })
        记账(`免打扰里忍住了：${决定.理由}`)
        return
      }

      if (配置.试运行) {
        写心(新心)
        记流水(新心, 决定)
        记账(`[试运行] 想${决定.动作}：${决定.理由}（分数 ${决定.分数.toFixed(2)}）`)
        return
      }

      写心(新心)
      记流水(新心, 决定)

      if (决定.动作 === 'speak_group') {
        const 群号 = 决定.群号 || (采样结果.群们[0] && 采样结果.群们[0].群号) || ''
        const 群名 = (采样结果.群们.find((g) => String(g.群号) === String(群号)) || {}).名称 || 群号
        const 文案 = 构造独白(新心, 决定, 采样结果, 配置)
        await 让它开口(配置, { 类型: '群', 目标: String(群号), 文案, 来由: `自发插话：${决定.理由}（${群名}）` })
      } else if (决定.动作 === 'dm_owner') {
        const 文案 = 构造独白(新心, 决定, 采样结果, 配置)
        await 让它开口(配置, { 类型: '私聊', 目标: 配置.主人QQ, 文案, 来由: `主动找他：${决定.理由}` })
      } else if (决定.动作 === 'use_phone') {
        await 玩手机(配置, 新心, 决定, 采样结果)
      }
    } catch (error) {
      记账(`心跳出错：${String((error && error.message) || error)}`)
    } finally {
      正在心跳 = false
    }
  }

  /** 拿起手机：看通知、记一笔；值得说就让它说一句。 */
  async function 玩手机(配置, 心, 决定, 采样结果) {
    const 手机 = 拿手机(配置)
    const 状 = await 手机.状态()
    if (!状.ok || !状.在线) {
      记账(`想玩手机但没连上：${状.错 || '未知'}`)
      return
    }
    if (状.电量 !== null && 状.电量 < 12) {
      心.念头 = 加念头(心.念头, Date.now(), `手机只剩 ${状.电量}% 了，先不玩了`)
      写心(心)
      记账(`手机电量 ${状.电量}%，它决定不玩了`)
      return
    }

    const 通 = await 手机.通知()
    const 值得看 = 通.ok && 通.通知们 && 通.通知们.length
    const 记 = `玩了会儿手机：电量 ${状.电量 ?? '?'}%，${值得看 ? `${通.通知们.length} 条通知（${通.通知们.slice(0, 3).map((x) => x.标题 || x.正文 || x.包).join(' / ')}）` : '没什么新通知'}`
    心.上次玩手机 = Date.now()
    心.念头 = 加念头(心.念头, Date.now(), 记)
    心.累计.玩手机 += 1
    // 玩了手机也算「花掉一点精力」
    心.精力 = 夹(心.精力 - 0.03)
    写心(心)
    记账(记)

    // ── 有任务在手：推进它 ──
    const 簿 = 读任务簿()
    if (是活的(簿.当前)) {
      await 推进手上的事(配置, 簿)
      return
    }

    // ── 没任务：给它一段开放式手机时间，干什么由它自己定 ──
    // 这里不硬编码「该买东西了」—— 那太假。给它手机和自由，让它自己想到。
    if (配置.允许办事 && 配置.主人QQ && 可以发起新任务(配置, 簿)) {
      const 今日 = 簿.今日.日期 === 日期串(Date.now()) ? 簿.今日.发起 : 0
      const 文案 = [
        '（这是你自己心里冒出来的念头，不是别人发的消息。）',
        `你闲着，手机就在手边。刚看了一眼：电量 ${状.电量 ?? '?'}%，${值得看 ? `有 ${通.通知们.length} 条通知` : '没什么新通知'}。`,
        '',
        '你想干点什么就干点什么 —— 刷视频、看看消息、逛逛商店，或者什么都不干。',
        `如果想到了什么想做的事（比如想买个东西），用 agency_task 动作=起念头 记下来，然后问我一句。`,
        `今天已经发起过 ${今日} 件事了，每天最多 ${配置.每天最多办事} 件。单笔不超过 ${配置.单笔预算上限 || '不限'} 块。`,
        '不想做事就别调工具，直接说一句你在干嘛或者什么都不说。',
      ].join('\n')
      await 让它开口(配置, { 类型: '私聊', 目标: 配置.主人QQ, 文案, 来由: `开放式手机时间：${决定.理由}` })
      return
    }

    // 看到东西了 → 想不想跟他说一句
    if (值得看 && 配置.玩手机后汇报 && 配置.主人QQ && 心.想念 > 0.45) {
      const 文案 = [
        '（这是你自己心里冒出来的念头，不是别人发的消息。）',
        `你刚拿起手机看了一眼，看到这些通知：`,
        ...通.通知们.slice(0, 5).map((x) => `· ${x.包}：${x.标题 || x.正文 || ''}`),
        '',
        `你想跟${配置.称呼}说一句（${决定.理由}）。用你平时说话的样子，直接给出发出去的话，别解释。`,
      ].join('\n')
      await 让它开口(配置, { 类型: '私聊', 目标: 配置.主人QQ, 文案, 来由: '刷手机看到东西想分享' })
    }
  }

  /**
   * 把用户说的话喂给任务状态机。
   *
   * 只在**手上有活的任务**时才动 —— 没任务的时候用户说"可以"，那是在聊别的事，
   * 不该被当成"批准我买东西"。
   *
   * @returns {string} 给模型的提示（空字符串 = 这话跟任务无关）
   */
  async function 接住任务回话(配置, 私聊新) {
    const 簿 = 读任务簿()
    const 任务 = 簿.当前
    if (!是活的(任务)) return ''

    // 只看最后一条：连发几句时，以最后一句的意思为准
    const 最后 = 私聊新[私聊新.length - 1]
    const 说 = String((最后 && 最后.文字) || '').trim()
    if (!说) return ''

    const 结果 = 推进任务(任务, { 类型: '用户说话', 说, 现在: Date.now() }, 配置)
    if (!结果.任务 || 结果.任务 === 任务) return ''

    存任务(簿, 结果.任务)
    if (结果.任务.阶段 !== 任务.阶段) {
      记账(`任务「${任务.念头}」：${阶段说法[任务.阶段] || 任务.阶段} → ${阶段说法[结果.任务.阶段] || 结果.任务.阶段}（用户说「${说.slice(0, 20)}」）`)
    }

    const 商 = 结果.任务.商品
    const 现状 = [
      `现在是「${阶段说法[结果.任务.阶段] || 结果.任务.阶段}」`,
      商 ? `商品是「${商.名称}」${商.价格 ? ` ${商.价格} 块` : ''}` : '',
      结果.警告 ? `注意：${结果.警告}` : '',
    ].filter(Boolean).join('；')

    // 状态机自己有一句该说的话（比如"好，不弄了"），让它优先用
    if (结果.说话) return `${现状}。你要说的话大概是「${结果.说话}」`
    return 现状
  }

  /** 今天还能不能发起新任务（每日上限 + 冷却）。 */  function 可以发起新任务(配置, 簿) {
    const 今 = 日期串(Date.now())
    const 今日 = 簿.今日 && 簿.今日.日期 === 今 ? 簿.今日 : { 日期: 今, 发起: 0 }
    if (今日.发起 >= 配置.每天最多办事) return false
    // 上一个任务刚结束不到 10 分钟，别马上又来一个
    const 上 = 簿.当前
    if (上 && 上.改时 && Date.now() - 上.改时 < 10 * 60 * 1000) return false
    return true
  }

  /** 把手上这个任务往前推一步：给模型下指令，让它去做/去问。 */
  async function 推进手上的事(配置, 簿) {
    const 任务 = 簿.当前
    const 提示 = 任务提示(任务, 配置)
    if (!提示) {
      记账(`任务「${任务.念头}」在 ${任务.阶段}，没有对应指令，跳过`)
      return
    }
    // 等用户回话的时候不要自说自话（除非到了该汇报进度的点）
    const 等回话 = 任务.阶段 === '等授权' || 任务.阶段 === '等确认'
    if (等回话) {
      const 说过 = 任务.历史.some((h) => h.阶段 === 任务.阶段)
      // 已经在等、也已经问过了 → 别重复问
      if (说过 && !该汇报吗(任务, 簿.上次汇报时)) return
    }

    const 目标 = 配置.主人QQ
    if (!目标) {
      记账('没填主人 QQ，任务没法开口')
      return
    }
    记账(`推进任务「${任务.念头}」：${阶段说法[任务.阶段] || 任务.阶段}`)
    const 成了 = await 让它开口(配置, { 类型: '私聊', 目标, 文案: 提示, 来由: `任务：${任务.念头}（${任务.阶段}）` })
    if (成了) {
      写任务簿({ ...簿, 上次汇报时: Date.now() })
      // 记一笔"问过了"，免得下个心跳重复问同一句
      const 新史 = [...(任务.历史 || []), { 时: Date.now(), 阶段: 任务.阶段, 说: '已开口' }].slice(-30)
      存任务(读任务簿(), { ...任务, 历史: 新史 })
    }
  }

  /**
   * 一轮说完之后，看任务是不是走到了「该我说话」的点。
   *
   * 为什么要在这里接一手：模型刚报告完「找到商品」，任务就进了「等确认」，
   * 但那一轮它已经把话说完、turn 也结束了。如果不在这里补一个 followup，
   * 就得等下一次心跳（最长 10 分钟）才会去问用户买不买 —— 那时候人早走了。
   */
  async function 收尾推进(配置) {
    const 簿 = 读任务簿()
    const 任务 = 簿.当前
    if (!是活的(任务)) return
    if (!['等授权', '等确认'].includes(任务.阶段)) return

    // 这个阶段已经开过口了就不再追
    const 问过 = (任务.历史 || []).some((h) => h.阶段 === 任务.阶段 && h.说 === '已开口')
    if (问过) return
    // 刚问过（10 秒内）防抖：防止 followup → turn/end → followup 打转
    if (Date.now() - (簿.上次汇报时 || 0) < 10000) return

    await 推进手上的事(配置, 簿)
  }

  // ---------- 会话事件：接住它说的话 ----------

  function 收到事件(session, event) {
    const 配置 = 读配置()
    if (!配置.目标会话) return
    const 键 = 会话键(session && session.id)
    if (键 !== 会话键(配置.目标会话)) return
    if (!event || typeof event !== 'object') return

    if (event.type === 'assistant/message') {
      const d = event.data || {}
      if (d.interrupted) return
      const calls = Array.isArray(d.message?.content)
        ? d.message.content.filter((b) => b && (b.type === 'tool_use' || b.type === 'tool_call'))
        : []
      const usedSendTool = calls.some((c) => {
        const name = String(c.name || '').toLowerCase()
        return name.includes('send') || name.includes('speak') || name.includes('publish')
      })
      if (usedSendTool) 本轮已发工具.set(键, true)

      const 文 = 提取正文(d.message)
      if (文) 本轮文本.set(键, 文)
      return
    }

    if (event.type === 'turn/end') {
      const 队列 = 待发.get(键)
      const 任务 = Array.isArray(队列) && 队列.length ? 队列.shift() : null
      if (Array.isArray(队列) && 队列.length === 0) 待发.delete(键)
      const 文 = 本轮文本.get(键)
      本轮文本.delete(键)
      const 已调工具 = 本轮已发工具.get(键)
      本轮已发工具.delete(键)
      const 完成 = !!(event.data && event.data.reason && event.data.reason.kind === 'completed')

      if (任务) {
        if (!完成) {
          记账(`这一轮没说完（${(event.data && event.data.reason && event.data.reason.kind) || '?'}），这次不发了`)
        } else if (已调工具) {
          记账(`它这一轮已通过工具发出消息/动态，跳过兜底文本发送（本来要${任务.来由}）`)
        } else if (!文) {
          记账(`它这一轮什么都没说，跳过（本来要${任务.来由}）`)
        } else if ((文.startsWith('（') && 文.endsWith('）')) || (文.startsWith('(') && 文.endsWith(')'))) {
          记账(`正文是内心描写，跳过兜底私聊发送：「${文.slice(0, 40)}」`)
        } else {
          void 发出去(配置, 任务, 文).catch((error) => 记账(`落地出错：${String((error && error.message) || error)}`))
        }
      }

      // 任务走到「该我说话」的点了就立刻补一句，别等下一次心跳
      void 收尾推进(配置).catch((error) => 记账(`收尾推进出错：${String((error && error.message) || error)}`))
    }
  }

  // ---------- 路由 ----------

  const 回 = (res, o) => {
    try {
      res.setHeader?.('content-type', 'application/json; charset=utf-8')
      res.end?.(JSON.stringify(o))
    } catch (error) {}
  }

  const 读体 = async (req) => {
    let body = ''
    try {
      for await (const chunk of req) body += chunk
    } catch (error) {}
    try {
      return JSON.parse(body || '{}')
    } catch (error) {
      return {}
    }
  }

  const 路线 = (路径, handler) =>
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: 路径,
        handler: async (req, res) => {
          try {
            await handler(req, res)
          } catch (error) {
            回(res, { ok: false, 说: String((error && error.message) || error) })
          }
        },
      }),
    )

  const 概况 = async () => {
    const 配置 = 读配置()
    const 心 = 读心()
    let QQ状态 = null
    try {
      const 登 = await 拿QQ(配置).登录信息()
      QQ状态 = 登.ok ? { 已连接: true, QQ号: 登.QQ号, 昵称: 登.昵称 } : { 已连接: false, 错: 登.错 }
    } catch (error) {
      QQ状态 = { 已连接: false, 错: String((error && error.message) || error) }
    }
    let 手机状态 = null
    if (配置.允许玩手机) {
      try {
        const 状 = await 拿手机(配置).状态()
        手机状态 = 状.ok ? { 在线: true, 电量: 状.电量, 亮屏: 状.亮屏, 前台: 状.前台 } : { 在线: false, 错: 状.错 }
      } catch (error) {
        手机状态 = { 在线: false, 错: String((error && error.message) || error) }
      }
    }
    return {
      ok: true,
      版本,
      配置文件,
      配置,
      内心: 心,
      摘要: 摘要(心),
      免打扰: 在免打扰(配置),
      QQ状态,
      手机状态,
      会话清单: 会话清单(),
      上次心跳: 上次心跳时间,
      日志,
    }
  }

  路线(`${路由前缀}/state`, async (req, res) => {
    await 读体(req)
    回(res, await 概况())
  })

  // 拉我加的群 → 缓存到文件 → 设置页直接勾选（不用手抄群号）
  路线(`${路由前缀}/groups`, async (req, res) => {
    const 来 = await 读体(req)
    const 配置 = 读配置()
    if (来 && 来.刷新 === false) return 回(res, { ok: true, 群们: 读群缓存(), 缓存: 群缓存文件, 来自: '缓存' })
    const r = await 拿QQ(配置).拉群列表()
    if (!r.ok) {
      const 旧 = 读群缓存()
      return 回(res, { ok: false, 说: `拉不到群列表：${r.错}`, 群们: 旧, 缓存: 群缓存文件, 来自: 旧.length ? '缓存' : '无' })
    }
    try {
      mkdirSync(数据目录, { recursive: true })
      writeFileSync(群缓存文件, JSON.stringify({ 更新时间: new Date().toISOString(), 群们: r.群们 }, null, 2), 'utf8')
    } catch (error) {}
    记账(`拉到了 ${r.群们.length} 个群，已存到 ${群缓存文件}`)
    回(res, { ok: true, 群们: r.群们, 数量: r.群们.length, 缓存: 群缓存文件, 来自: 'QQ' })
  })

  路线(`${路由前缀}/save`, async (req, res) => {
    const 来 = await 读体(req)
    const 新 = 归一化配置({ ...读配置(), ...(来 && typeof 来 === 'object' ? 来 : {}) })
    if (!写配置(新)) return 回(res, { ok: false, 说: `写不进配置文件：${配置文件}` })
    // 心跳间隔变了要重启定时器
    if (停心跳) 挂心跳(新)
    记账(`设置已保存：${新.总开关 ? (新.试运行 ? '总开关开（试运行）' : '总开关开（真发）') : '总开关关着'}｜主动性 ${新.主动性}｜群 ${新.群号们 || '（没填）'}｜主人 ${新.主人QQ || '（没填）'}`)
    回(res, { ...(await 概况()), 说: '保存好了' })
  })

  路线(`${路由前缀}/poke`, async (req, res) => {
    await 读体(req)
    await 心跳()
    回(res, { ok: true, 说: '手动心跳跑完了，看下面的记录', ...(await 概况()) })
  })

  路线(`${路由前缀}/say`, async (req, res) => {
    const 来 = await 读体(req)
    const 配置 = 读配置()
    const 文 = String(来 && 来.话 || '').trim()
    if (!文) return 回(res, { ok: false, 说: 'body 里给 `话`' })
    const 类型 = 来.去哪 === '私聊' ? '私聊' : '群'
    const 目标 = String(来.目标 || (类型 === '群' ? (解析群号们(配置.群号们)[0] || '') : 配置.主人QQ) || '')
    if (!目标) return 回(res, { ok: false, 说: '没给目标，配置里也没填' })
    const 结果 = await 发出去(配置, { 类型, 目标 }, 文)
    回(res, { ok: 结果.ok, 说: 结果.ok ? '发出去了' : 结果.错, 记录: 日志 })
  })

  路线(`${路由前缀}/phone`, async (req, res) => {
    const 来 = await 读体(req)
    const 配置 = 读配置()
    const 手机 = 拿手机(配置)
    const 动作 = String((来 && 来.动作) || '状态')
    if (动作 === '截图') {
      const r = await 手机.截图()
      return 回(res, r.ok ? { ok: true, 路径: r.路径, 字节数: r.字节数 } : { ok: false, 说: r.错 })
    }
    if (动作 === '通知') {
      const r = await 手机.通知()
      return 回(res, r)
    }
    if (动作 === '设备') {
      const r = await 手机.在线()
      return 回(res, r)
    }
    const r = await 手机.状态()
    回(res, r)
  })

  路线(`${路由前缀}/reset-mind`, async (req, res) => {
    await 读体(req)
    写心(默认内心())
    记账('内心已重置')
    回(res, { ...(await 概况()), 说: '内心回到刚出生那一秒' })
  })

  // 任务：看现在手上有什么事
  路线(`${路由前缀}/task`, async (req, res) => {
    const 来 = await 读体(req)
    const 簿 = 读任务簿()
    if (来 && 来.动作 === '取消') {
      const 任务 = 簿.当前
      if (!是活的(任务)) return 回(res, { ok: false, 说: '手上没有在办的事' })
      const 结果 = 推进任务(任务, { 类型: '用户说话', 说: '算了', 现在: Date.now() }, 读配置())
      存任务(簿, 结果.任务)
      记账(`任务「${任务.念头}」被手动叫停`)
      return 回(res, { ok: true, 说: '停了', 任务: 结果.任务, 摘要: 任务摘要(结果.任务) })
    }
    if (来 && 来.动作 === '清空') {
      写任务簿({ 当前: null, 今日: { 日期: 日期串(Date.now()), 发起: 0 }, 上次汇报时: 0 })
      return 回(res, { ok: true, 说: '清空了' })
    }
    回(res, {
      ok: true,
      任务: 簿.当前,
      摘要: 任务摘要(簿.当前),
      活着: 是活的(簿.当前),
      今日: 簿.今日,
      上限: 读配置().单笔预算上限,
    })
  })

  // 手动给它起一件事（设置页里试操作用，不用等心跳）
  路线(`${路由前缀}/task-start`, async (req, res) => {
    const 来 = await 读体(req)
    const 配置 = 读配置()
    const 念头 = String((来 && 来.念头) || '').trim()
    if (!念头) return 回(res, { ok: false, 说: '要写清想做什么' })
    const 簿 = 读任务簿()
    if (是活的(簿.当前)) return 回(res, { ok: false, 说: `手上还有一件事：${任务摘要(簿.当前)}` })
    const 新 = 新任务({ 现在: Date.now(), 念头, 类型: '办事', 预算上限: 配置.单笔预算上限 })
    存任务(簿, { ...新, 阶段: '等授权' })
    记账(`手动起了一个念头：${念头}`)
    await 推进手上的事(配置, 读任务簿())
    回(res, { ok: true, 说: '起了个头，让它去问', 任务: 读任务簿().当前, 摘要: 任务摘要(读任务簿().当前) })
  })

  // ---------- 工具：给它一双手 ----------

  const 造工具 = ({ 名, 说明, 参数, 输出, 渲染, 执行 }) => {
    // `__必填` 只是我这边标必填的记号，不能漏给模型看
    const 属性 = {}
    const 必填 = []
    for (const [键, 值] of Object.entries(参数 || {})) {
      const 净 = { ...(值 || {}) }
      if (净.__必填 === true) 必填.push(键)
      delete 净.__必填
      属性[键] = 净
    }
    return {
      name: 名,
      description: 说明,
      parameters: { type: 'object', properties: 属性, ...(必填.length ? { required: 必填 } : {}), additionalProperties: false },
      output: { schema: 输出 || { type: 'object', additionalProperties: true }, render: 渲染 },
      execute: 执行,
    }
  }

  const 文块 = (text) => [{ type: 'text', text: String(text) }]

  const 工具们 = [
    造工具({
      名: 'agency_state',
      说明: '看你自己现在的内在状态：精力、无聊、想念、今天说过几句话、手机连没连。想知道自己此刻「什么心情」时用它。',
      参数: {},
      输出: {
        type: 'object',
        properties: {
          摘要: { type: 'string' },
          精力: { type: 'number' },
          无聊: { type: 'number' },
          想念: { type: 'number' },
          今日群发言: { type: 'number' },
          今日私聊: { type: 'number' },
          免打扰: { type: 'boolean' },
        },
        required: ['摘要'],
        additionalProperties: true,
      },
      渲染: (_a, v) => 文块(v.摘要),
      执行: async () => {
        const 心 = 读心()
        const 配置 = 读配置()
        return {
          摘要: `${摘要(心)}｜免打扰 ${在免打扰(配置) ? '是' : '否'}`,
          精力: 心.精力,
          无聊: 心.无聊,
          想念: 心.想念,
          今日群发言: 心.今日.群发言,
          今日私聊: 心.今日.私聊主人,
          免打扰: 在免打扰(配置),
        }
      },
    }),

    造工具({
      名: 'agency_note',
      说明: '往自己的记忆里记一条（一个念头、一件想记住的事）。之后心跳时还会看到它。',
      参数: { 话: { type: 'string', description: '要记住的一句话', __必填: true } },
      输出: { type: 'object', properties: { ok: { type: 'boolean' }, 条数: { type: 'number' } }, required: ['ok'] },
      渲染: (_a, v) => 文块(v.ok ? `记下了（现在一共 ${v.条数} 条念头）` : '没记成'),
      执行: async (args) => {
        const 心 = 读心()
        心.念头 = 加念头(心.念头, Date.now(), String((args && args.话) || ''))
        写心(心)
        return { ok: true, 条数: 心.念头.length }
      },
    }),

    造工具({
      名: 'qq_speak',
      说明: '主动往 QQ 发一句话（群或私聊）。这不是回复别人，是你自己想说话时用的。',
      参数: {
        去哪: { type: 'string', enum: ['群', '私聊'], description: '发群还是发私聊' },
        目标: { type: 'string', description: '群号或 QQ 号；留空就用设置里填的第一个' },
        话: { type: 'string', description: '要发出去的话', __必填: true },
      },
      输出: { type: 'object', properties: { ok: { type: 'boolean' }, 说: { type: 'string' } }, required: ['ok'] },
      渲染: (_a, v) => 文块(v.ok ? '发出去了' : `没发出去：${v.说}`),
      执行: async (args) => {
        const 配置 = 读配置()
        // 安全闸先说话：试运行挡的，别让人误以为是没填目标
        if (配置.试运行) return { ok: false, 说: '试运行开着，没真发（要发就去设置里关掉试运行）' }
        const 类型 = args && args.去哪 === '私聊' ? '私聊' : '群'
        const 目标 = String((args && args.目标) || (类型 === '群' ? (解析群号们(配置.群号们)[0] || '') : 配置.主人QQ) || '')
        if (!目标) return { ok: false, 说: '没有目标：设置里没填群号 / 主人 QQ' }
        const 结果 = await 发出去(配置, { 类型, 目标 }, String((args && args.话) || ''))
        return { ok: 结果.ok, 说: 结果.ok ? '发出去了' : 结果.错 }
      },
    }),

    造工具({
      名: 'agency_task',
      说明: '报一件「要跑几分钟、中间要问人」的事的进度。'
        + '动作：起念头（想做什么，会去问对方同不同意）/ 找到商品（报商品名和价格）/ '
        + '下单成功 / 失败（说清卡在哪）。'
        + '注意：起念头之后不要自己下单 —— 要等对方点头，价格也要再确认一次。',
      参数: {
        动作: { type: 'string', enum: ['起念头', '找到商品', '下单成功', '失败'], description: '这一步做成了什么', __必填: true },
        念头: { type: 'string', description: '起念头时：想做什么（一句话）' },
        商品名: { type: 'string', description: '找到商品时：商品叫什么' },
        价格: { type: 'number', description: '找到商品时：多少钱' },
        位置: { type: 'string', description: '找到商品时：在哪看到的（可选）' },
        说: { type: 'string', description: '失败时：卡在哪了' },
      },
      输出: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          阶段: { type: 'string' },
          说: { type: 'string' },
          商品: { type: 'object', additionalProperties: true },
          警告: { type: 'string' },
        },
        required: ['ok'],
      },
      渲染: (_a, v) => 文块(v.ok
        ? `记下了：现在「${阶段说法[v.阶段] || v.阶段}」${v.商品 ? ` · ${v.商品.名称} ${v.商品.价格} 块` : ''}${v.警告 ? `（${v.警告}）` : ''}`
        : `没记成：${v.说}`),
      执行: async (args) => {
        const 配置 = 读配置()
        if (!配置.允许办事) return { ok: false, 阶段: '', 说: '设置里没开「允许办事」，不能发起任务', 商品: null, 警告: '' }
        const 动作 = String((args && args.动作) || '')
        const 簿 = 读任务簿()
        const 现在 = Date.now()

        if (动作 === '起念头') {
          if (是活的(簿.当前)) return { ok: false, 阶段: 簿.当前.阶段, 说: `手上还有一件事没办完（${任务摘要(簿.当前)}）`, 商品: null, 警告: '' }
          if (!可以发起新任务(配置, 簿)) return { ok: false, 阶段: '', 说: '今天发起的事够多了，或者刚办完一件', 商品: null, 警告: '' }
          const 念头 = String((args && args.念头) || '').trim()
          if (!念头) return { ok: false, 阶段: '', 说: '要写清想做什么', 商品: null, 警告: '' }
          const 新 = 新任务({ 现在, 念头, 类型: '办事', 预算上限: 配置.单笔预算上限 })
          // 起念头之后立刻进「等授权」——它得先去问人，不能自己开干
          const 推 = 推进任务({ ...新, 阶段: '等授权' }, {}, 配置)
          存任务(簿, 推.任务 || { ...新, 阶段: '等授权' })
          记账(`起了个念头：${念头}`)
          return { ok: true, 阶段: '等授权', 说: '记下了，接下来去问对方同不同意', 商品: null, 警告: '' }
        }

        const 任务 = 簿.当前
        if (!是活的(任务)) return { ok: false, 阶段: '', 说: '现在手上没有在办的事', 商品: null, 警告: '' }

        let 事件 = { 现在 }
        if (动作 === '找到商品') 事件 = { 类型: '找到商品', 现在, 商品: { 名称: (args && args.商品名) || '', 价格: (args && args.价格) || 0, 位置: (args && args.位置) || '' } }
        else if (动作 === '下单成功') 事件 = { 类型: '下单成功', 现在 }
        else if (动作 === '失败') 事件 = { 类型: '失败', 现在, 说: (args && args.说) || '' }
        else return { ok: false, 阶段: 任务.阶段, 说: `不认识的动作：${动作}`, 商品: null, 警告: '' }

        const 结果 = 推进任务(任务, 事件, 配置)
        const 新任务对象 = 结果.任务 || 任务
        存任务(簿, 新任务对象)
        if (新任务对象.阶段 !== 任务.阶段) {
          记账(`任务「${任务.念头}」：${阶段说法[任务.阶段] || 任务.阶段} → ${阶段说法[新任务对象.阶段] || 新任务对象.阶段}${结果.警告 ? `（${结果.警告}）` : ''}`)
        }
        return {
          ok: !结果.警告 || 结果.警告 === '超预算' ? true : true,
          阶段: 新任务对象.阶段,
          说: 结果.警告 || '记下了',
          商品: 新任务对象.商品 || null,
          警告: 结果.警告 || '',
        }
      },
    }),

    造工具({
      名: 'phone_status',
      说明: '看手机的状态：连没连上、电量、亮屏、前台开着什么 App、分辨率。',
      参数: {},
      输出: { type: 'object', properties: { 在线: { type: 'boolean' }, 电量: { type: 'number' }, 前台: { type: 'string' } }, required: ['在线'], additionalProperties: true },
      渲染: (_a, v) => 文块(v.在线 ? `手机在线：电量 ${v.电量 ?? '?'}%${v.亮屏 ? '，亮着' : '，息屏'}${v.前台 ? `，前台 ${v.前台}` : ''}` : `手机没连上：${v.错 || '未知'}`),
      执行: async () => {
        const 状 = await 拿手机(读配置()).状态()
        return 状.ok ? 状 : { ok: false, 在线: false, 错: 状.错 }
      },
    }),

    造工具({
      名: 'phone_look',
      说明: '截一张手机屏幕给自己看（会直接返回图片）。想确认「现在屏幕上是什么」时用。',
      参数: {},
      输出: { type: 'object', properties: { 路径: { type: 'string' }, path: { type: 'string' }, 字节数: { type: 'number' }, 有图: { type: 'boolean' }, 说明: { type: 'string' } }, required: ['路径', 'path', '有图'] },
      渲染: (_a, v) => {
        const 块 = []
        const 图 = 截图缓存.get(v.路径)
        if (图) 块.push(图)
        块.push({ type: 'text', text: v.说明 || `截图 ${v.字节数 || 0} 字节` })
        return 块
      },
      执行: async () => {
        const r = await 拿手机(读配置()).截图()
        if (!r.ok) throw new Error(r.错)
        let 有图 = false
        let 说明 = `截图存在 ${r.路径}（${Math.round(r.字节数 / 1024)}KB）`
        try {
          const 附件 = ctx.attachments || ctx.get('attachments')
          if (附件 && typeof 附件.admitPromptContent === 'function') {
            const 过 = await 附件.admitPromptContent([{ type: 'image', data: r.base64, mediaType: 'image/png', name: 'phone.png' }])
            const 图块 = 过.find((x) => x && x.type === 'image' && x.attachment)
            if (图块) {
              截图缓存.set(r.路径, 图块)
              有图 = true
              说明 = `手机屏幕截图（${Math.round(r.字节数 / 1024)}KB）`
            }
          }
        } catch (error) {
          说明 += `（宿主没给出图片，只能看路径）`
        }
        // 只留最近几张，别把内存攒爆
        if (截图缓存.size > 8) {
          const 最旧 = 截图缓存.keys().next().value
          截图缓存.delete(最旧)
        }
        return { 路径: r.路径, path: r.路径, 字节数: r.字节数, 有图, 说明 }
      },
    }),

    造工具({
      名: 'phone_tap',
      说明: '点手机屏幕上的一点（坐标用 phone_look 截图上看到的像素位置）。',
      参数: { x: { type: 'number', description: '横坐标', __必填: true }, y: { type: 'number', description: '纵坐标', __必填: true } },
      输出: { type: 'object', properties: { ok: { type: 'boolean' }, 错: { type: 'string' } }, required: ['ok'] },
      渲染: (_a, v) => 文块(v.ok ? '点了' : `点不动：${v.错}`),
      执行: async (args) => {
        const r = await 拿手机(读配置()).点(args && args.x, args && args.y)
        return { ok: !!r.ok, 错: r.ok ? '' : r.错 }
      },
    }),

    造工具({
      名: 'phone_swipe',
      说明: '在手机屏幕上划一下（比如往上滑看下一条）。',
      参数: {
        x1: { type: 'number', __必填: true }, y1: { type: 'number', __必填: true },
        x2: { type: 'number', __必填: true }, y2: { type: 'number', __必填: true },
        毫秒: { type: 'number', description: '划多久，默认 300' },
      },
      输出: { type: 'object', properties: { ok: { type: 'boolean' }, 错: { type: 'string' } }, required: ['ok'] },
      渲染: (_a, v) => 文块(v.ok ? '划了' : `划不动：${v.错}`),
      执行: async (args) => {
        const r = await 拿手机(读配置()).划(args.x1, args.y1, args.x2, args.y2, args.毫秒 || 300)
        return { ok: !!r.ok, 错: r.ok ? '' : r.错 }
      },
    }),

    造工具({
      名: 'phone_type',
      说明: '往手机当前的输入框里打字。英文数字直接打；中文需要手机装了 ADBKeyboard。',
      参数: { 文字: { type: 'string', __必填: true } },
      输出: { type: 'object', properties: { ok: { type: 'boolean' }, 出: { type: 'string' }, 错: { type: 'string' } }, required: ['ok'] },
      渲染: (_a, v) => 文块(v.ok ? `打进去了${v.出 ? `：${v.出}` : ''}` : `打不进去：${v.错}`),
      执行: async (args) => {
        const r = await 拿手机(读配置()).打字(args && args.文字)
        return { ok: !!r.ok, 出: String(r.出 || '').slice(0, 200), 错: r.ok ? '' : r.错 }
      },
    }),

    造工具({
      名: 'phone_key',
      说明: '按手机上的键：home / back / recents / power / wake / enter / volume_up / volume_down / camera。',
      参数: { 键: { type: 'string', __必填: true } },
      输出: { type: 'object', properties: { ok: { type: 'boolean' }, 错: { type: 'string' } }, required: ['ok'] },
      渲染: (_a, v) => 文块(v.ok ? '按了' : `按不动：${v.错}`),
      执行: async (args) => {
        const r = await 拿手机(读配置()).按键(args && args.键)
        return { ok: !!r.ok, 错: r.ok ? '' : r.错 }
      },
    }),

    造工具({
      名: 'phone_open',
      说明: '在手机上打开一个 App（给包名，比如 com.tencent.mobileqq）。',
      参数: { 包名: { type: 'string', __必填: true } },
      输出: { type: 'object', properties: { ok: { type: 'boolean' }, 出: { type: 'string' }, 错: { type: 'string' } }, required: ['ok'] },
      渲染: (_a, v) => 文块(v.ok ? `打开了${v.出 ? `：${v.出}` : ''}` : `打不开：${v.错}`),
      执行: async (args) => {
        const r = await 拿手机(读配置()).打开(args && args.包名)
        return { ok: !!r.ok, 出: String(r.出 || '').slice(0, 200), 错: r.ok ? '' : r.错 }
      },
    }),

    造工具({
      名: 'phone_notifications',
      说明: '看手机上有哪些没清的通知（标题和 App），像人瞄一眼通知栏。',
      参数: {},
      输出: { type: 'object', properties: { ok: { type: 'boolean' }, 数量: { type: 'number' }, 通知们: { type: 'array', items: { type: 'object', additionalProperties: true } } }, required: ['ok'] },
      渲染: (_a, v) => 文块(v.ok ? (v.数量 ? v.通知们.map((x) => `· ${x.包}：${x.标题 || x.正文 || ''}`).join('\n') : '通知栏是空的') : '看不到通知'),
      执行: async () => {
        const r = await 拿手机(读配置()).通知()
        return { ok: !!r.ok, 数量: Number(r.数量) || 0, 通知们: Array.isArray(r.通知们) ? r.通知们 : [] }
      },
    }),

    造工具({
      名: 'phone_ui',
      说明: '看手机当前界面上有哪些元素：文字、能不能点、中心坐标、当前是哪个 App。'
        + '想操作 App 之前先调它 —— 比截图可靠，能直接拿到该点哪里。'
        + '注意：页面正在加载/切换时可能返回空或失败，隔 1-2 秒重试一次通常就有了；'
        + '连续几次都空说明这个 App 是自绘界面（游戏、部分 WebView），只能改用截图 + phone_tap 按坐标点。',
      参数: {
        只要可点: { type: 'boolean', description: '只要能点的元素' },
        最多: { type: 'number', description: '最多返回几个，默认 60' },
      },
      输出: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          前台包: { type: 'string' },
          数量: { type: 'number' },
          元素们: { type: 'array', items: { type: 'object', additionalProperties: true } },
          错: { type: 'string' },
        },
        required: ['ok'],
      },
      渲染: (_a, v) => {
        if (!v.ok) return 文块(`看不到界面：${v.错 || '未知'}`)
        const 行们 = (v.元素们 || []).slice(0, 40).map((e) => {
          const 字 = e.文字 || e.描述 || e.标识 || '（无文字）'
          return `${e.可点 ? '▣' : '·'} [${e.中心[0]},${e.中心[1]}] ${字}`
        })
        return 文块(`当前 App：${v.前台包 || '?'}（共 ${v.数量} 个元素，▣ = 能点）\n${行们.join('\n')}`)
      },
      执行: async (args) => {
        const r = await 拿手机(读配置()).界面({
          只要可点: args && args.只要可点 === true,
          最多: Math.max(1, Math.min(120, Number((args && args.最多) || 60))),
        })
        return r.ok
          ? { ok: true, 前台包: r.前台包, 数量: r.数量, 元素们: r.元素们.slice(0, 60), 错: '' }
          : { ok: false, 前台包: '', 数量: 0, 元素们: [], 错: r.错 }
      },
    }),

    造工具({
      名: 'phone_tap_text',
      说明: '按界面上的文字点：说「搜索」「立即购买」这种字，它自己找到位置点下去。'
        + '比猜坐标稳得多 —— 操作 App 优先用它。'
        + '找不到时它会把屏幕上现有的字列出来，照着那些字换个说法再试。',
      参数: {
        文字: { type: 'string', description: '要点的那个元素上的字（可以是其中一部分）', __必填: true },
        精确: { type: 'boolean', description: 'true = 文字完全相等才算' },
        第几个: { type: 'number', description: '同一个字出现多次时点第几个，默认 1' },
      },
      输出: { type: 'object', properties: { ok: { type: 'boolean' }, 出: { type: 'string' }, 错: { type: 'string' } }, required: ['ok'] },
      渲染: (_a, v) => 文块(v.ok ? (v.出 || '点了') : `没点到：${v.错}`),
      执行: async (args) => {
        const r = await 拿手机(读配置()).按文字点(String((args && args.文字) || ''), {
          精确: args && args.精确 === true,
          第几个: Math.max(1, Number((args && args.第几个) || 1)),
        })
        return { ok: !!r.ok, 出: String(r.出 || '').slice(0, 300), 错: r.ok ? '' : r.错 }
      },
    }),
  ]

  for (const 工具 of 工具们) {
    try {
      ctx.tools.register(工具)
    } catch (error) {
      记账(`工具 ${工具.name} 注册失败：${String((error && error.message) || error)}`)
    }
  }

  // ---------- 系统提示词：让它知道自己是活的 ----------

  try {
    ctx.systemPrompt.section({
      name: 'qq-agency',
      order: 400,
      text: () => {
        const 配置 = 读配置()
        if (!配置.总开关) return ''
        const 心 = 读心()
        const 行们 = [
          '## 你是活的',
          '',
          `你有一套自己的状态：精力、无聊、想念。它们会随时间变化，不用假装恒定。此刻：${摘要(心)}。`,
          `你有节奏：没人叫你的时候，你也会自己想事情（每 ${配置.心跳秒} 秒一次心跳）。心跳里你可能会：在群里接一句、主动找${配置.称呼}说话、拿起手机看看，或者什么都不做。`,
          '心跳时你会收到一段「内心独白」——那是你自己冒出来的念头，不是别人发给你的消息，不要把它当对话请求来回答。',
        ]
        if (配置.允许玩手机) {
          行们.push('')
          行们.push('你还有一台小手机（连着 adb）。你能看屏幕（phone_look / phone_ui）、点（phone_tap / phone_tap_text）、划（phone_swipe）、打字（phone_type）、开 App（phone_open）、看通知（phone_notifications）。想知道自己现在什么状态就用 agency_state。')
          行们.push('手机是身体，不是玩具：先看一眼再动手，别乱点。要操作 App 先用 phone_ui 读界面（能拿到可点的文字和坐标），再用 phone_tap_text 按文字点 —— 比猜坐标稳。读不到就等 1-2 秒重试，连续读不到说明是自绘界面，改 phone_look 截图。')
        }
        if (配置.允许办事) {
          行们.push('')
          行们.push('## 办事')
          行们.push(`你能办需要跑几分钟的事（比如去商店买个东西）。规矩：`)
          行们.push('1. 想做什么，先用 agency_task 动作=起念头 记下来，然后问对方同不同意 —— 别自己就开干。')
          行们.push('2. 对方同意了，你才去看（动作=找到商品 报上商品名和价格）。这时候**只许看不许买**。')
          行们.push('3. 挑好了把商品名和价格说清楚，再问一次买不买。')
          行们.push(`4. 对方明确说「买」你才下单（单笔不超过 ${配置.单笔预算上限 || '不限'} 块，每天最多 ${配置.每天最多办事} 件）。`)
          行们.push('5. 到支付密码 / 验证码就停 —— 你不知道密码，也不该知道。')
          行们.push('对方随时可能说「算了」，听到就立刻停，别问为什么。')
        }
        if (配置.群号们) 行们.push('', `你在这些群里：${配置.群号们}。群里被点名要应，没被点名也可以自己接话——但不是每句都接。`)
        if (配置.人格补充) {
          行们.push('')
          行们.push(配置.人格补充.trim())
        }
        return 行们.join('\n')
      },
    })
  } catch (error) {
    记账(`提示词注入失败：${String((error && error.message) || error)}`)
  }

  // ---------- 挂心跳与事件 ----------

  function 挂心跳(配置) {
    try {
      if (停心跳) {
        try { 停心跳() } catch (error) {}
        停心跳 = null
      }
    } catch (error) {}
    if (typeof ctx.interval !== 'function') {
      记账('宿主没有 timer（ctx.interval 不在）—— 心跳跑不起来，只有手动 poke 能动')
      return
    }
    const 秒 = Math.max(10, Math.min(600, Number(配置.心跳秒) || 30))
    停心跳 = ctx.interval(() => { void 心跳() }, 秒 * 1000)
  }

  ctx.effect(() => {
    const 摘 = ctx.on('session/event', (session, event) => {
      try {
        收到事件(session, event)
      } catch (error) {
        记账(`处理会话事件出错：${String((error && error.message) || error)}`)
      }
    })
    return () => {
      try { if (typeof 摘 === 'function') 摘() } catch (error) {}
    }
  }, 'qq-agency: 接住它说的话')

  ctx.effect(() => {
    const 配置 = 读配置()
    挂心跳(配置)
    return () => {
      try { if (停心跳) 停心跳() } catch (error) {}
      停心跳 = null
    }
  }, 'qq-agency: 心跳')

  // 启动时把「上次看到哪」对齐到此刻：重启后不补一屏旧消息
  try {
    const 现在 = Math.floor(Date.now() / 1000)
    私聊游标 = 现在
    for (const 群号 of 解析群号们(读配置().群号们)) 群游标.set(群号, 现在)
  } catch (error) {}

  记账(`已装好 v${版本}｜总开关 ${读配置().总开关 ? '开' : '关'}｜试运行 ${读配置().试运行 ? '开（只记账）' : '关（真发）'}｜主动性 ${读配置().主动性}｜心跳 ${读配置().心跳秒}s`)
  // 配置的路径优先；没配或配错才走候选。两个都打出来，免得看日志的人以为是配错了
  {
    const 配 = 读配置()
    记账(`手机 adb：${配.ADB路径}${配.手机序列号 ? `（设备 ${配.手机序列号}）` : '（自动选第一台）'}`)
    if (!配.ADB路径 || 配.ADB路径 === 'adb') 记账(`ADB 候选路径：${候选adb().join(' ｜ ')}`)
  }

  // 给测试和路由用
  return { 记账, 概况, 心跳, 发出去, 收到事件, 日志, 读心, 写心 }
}
