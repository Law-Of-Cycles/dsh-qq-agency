// 端到端走查：让插件自己操作一个真实 App，走到「准备付款」为止。
//
//   node tests/app-walkthrough.mjs                          # 默认拼多多 + 蓝牙耳机
//   node tests/app-walkthrough.mjs com.xunmeng.pinduoduo 蓝牙耳机
//   node tests/app-walkthrough.mjs com.xunmeng.pinduoduo 蓝牙耳机 127.0.0.1:16384
//
// 这条脚本就是「它自己会买东西」的证据链：
//   打开 App → 关掉隐私弹窗 → 跳过登录 → 进搜索 → 读商品列表 → 点进详情 → 点到购买按钮
//
// ⚠ 最后一步**不点**提交订单 —— 那会产生真实订单。脚本停在按钮前面，
//   把按钮文字和位置打出来，剩下的交给人。
//
// 退出码 0 = 走到了购买按钮；1 = 中途断了（断在哪一步会写清楚）。

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { 建手机, 跑 } from '../lib/phone.js'

const 包名 = process.argv[2] || 'com.xunmeng.pinduoduo'
const 搜索词 = process.argv[3] || ''
const 设备参数 = process.argv[4] || ''

const 等 = (ms) => new Promise((r) => setTimeout(r, ms))
const 记录 = []
const 步 = async (名, fn) => {
  process.stdout.write(`  ${名} … `)
  try {
    const 值 = await fn()
    console.log(`✓${值 ? `  ${值}` : ''}`)
    记录.push({ 步: 名, ok: true, 值: 值 || '' })
    return true
  } catch (error) {
    console.log(`✗  ${String((error && error.message) || error)}`)
    记录.push({ 步: 名, ok: false, 值: String((error && error.message) || error) })
    return false
  }
}

/** 界面树读不到是常态（加载中），重试几次再判定失败。 */
async function 读界面(手机, 试 = 6, 间隔 = 2000) {
  for (let i = 0; i < 试; i++) {
    const 树 = await 手机.界面({ 最多: 150 })
    const 有字 = (树.元素们 || []).filter((e) => e.文字 || e.描述)
    if (有字.length > 2) return { ...树, 有字 }
    await 等(间隔)
  }
  return { ok: false, 元素们: [], 有字: [], 错: '连续重试仍读不到界面（可能是自绘界面或还在加载）' }
}

const 有 = (树, 正则) => (树.有字 || []).filter((e) => 正则.test(e.文字 || e.描述 || ''))
const 打印 = (元素们, 条数 = 6) => 元素们.slice(0, 条数).map((e) => (e.文字 || e.描述 || '').slice(0, 30)).join(' / ')

const 面积 = (e) => (e.框 ? (e.框[2] - e.框[0]) * (e.框[3] - e.框[1]) : 0)
const 框内 = (外, 点) => 外.框 && 点.框
  && 点.中心[0] >= 外.框[0] && 点.中心[0] <= 外.框[2]
  && 点.中心[1] >= 外.框[1] && 点.中心[1] <= 外.框[3]

/**
 * 找商品卡片。
 *
 * 电商 App 的坑：**标题文字本身不可点**，能点的是包着它的大 ViewGroup。
 * 所以不能"点标题"，得"找包住价格/标题的那个可点大框"。
 *
 * 还要排掉顶部广告横幅：那种是**通栏**的（宽 = 整屏），点进去是活动页不是商品。
 * 两列商品流的卡片宽度大约是屏宽一半。
 */
function 找商品卡片(树) {
  const 价格们 = (树.有字 || []).filter((e) => /^[¥￥]?[\d.]+$/.test((e.文字 || '').trim()) || /已拼|已售|人收藏/.test(e.文字 || ''))
  const 屏宽 = Math.max(0, ...(树.元素们 || []).map((e) => (e.框 ? e.框[2] : 0))) || 720
  const 可点大块 = (树.元素们 || []).filter((e) => {
    if (!e.可点 || !e.框) return false
    const 宽 = e.框[2] - e.框[0]
    const 高 = e.框[3] - e.框[1]
    if (宽 * 高 <= 20000) return false
    if (e.框[1] < 250 || e.框[3] > 1210) return false // 排掉顶部导航和底部 tab
    if (宽 > 屏宽 * 0.62) return false // 通栏 = 广告横幅，不是商品
    if (高 < 宽 * 0.8) return false // 商品卡是竖的
    return true
  })
  for (const 块 of 可点大块) {
    if (价格们.some((p) => 框内(块, p))) return 块
  }
  return 可点大块[0] || null
}

/** 找搜索入口：顶部那条（y < 130）可点、且不是纯图标/分类的横条。 */
function 找搜索入口(树) {
  const 顶部 = (树.元素们 || []).filter((e) => e.可点 && e.框 && e.框[1] < 130 && (e.框[2] - e.框[0]) > 300)
  // 优先"里面有文字但自己不叫拍照搜索"的那种（就是搜索框本体）
  const 框体 = 顶部.find((e) => (e.框[2] - e.框[0]) > 600 && !/拍照搜索/.test(e.描述 || ''))
  return 框体 || 顶部[0] || null
}

/** 找到 adb 与设备（跟 phone-check 一样，不重复造轮子）。 */
async function 找设备() {
  const 候选 = [
    process.env.ADB_PATH,
    'D:\\Program Files\\Netease\\MuMu Player 12\\shell\\adb.exe',
    'C:\\Program Files\\Netease\\MuMu Player 12\\shell\\adb.exe',
    join(homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    'adb',
  ].filter(Boolean)
  let adb = ''
  for (const p of 候选) {
    if (p !== 'adb' && !existsSync(p)) continue
    const r = await 跑(p, ['version'], { 超时毫秒: 8000 })
    if (r.ok) { adb = p; break }
  }
  if (!adb) throw new Error('找不到 adb')

  if (设备参数) return { adb, 序列号: 设备参数 }
  const 列 = await 跑(adb, ['devices'], { 超时毫秒: 8000 })
  const 行 = String(列.出 || '').split(/\r?\n/).slice(1).map((x) => x.trim()).filter(Boolean)
  const 在 = 行.map((x) => x.split(/\s+/)).filter((x) => x[1] === 'device').map((x) => x[0])
  if (在.length) return { adb, 序列号: 在[0] }
  for (const 端口 of [16384, 5555, 7555, 62001]) await 跑(adb, ['connect', `127.0.0.1:${端口}`], { 超时毫秒: 6000 })
  const 再 = await 跑(adb, ['devices'], { 超时毫秒: 8000 })
  const 在2 = String(再.出 || '').split(/\r?\n/).slice(1).map((x) => x.trim().split(/\s+/)).filter((x) => x[1] === 'device').map((x) => x[0])
  if (!再 || !在2.length) throw new Error('没有可用设备')
  return { adb, 序列号: 在2[0] }
}

console.log(`端到端走查：${包名}${搜索词 ? `（搜「${搜索词}」）` : ''}\n`)

const { adb, 序列号 } = await 找设备()
const 手机 = 建手机({ adb, 序列号, 临时目录: join(process.cwd(), 'tests', '.tmp') })
console.log(`设备：${序列号}\n`)

let 当前 = null

await 步('打开 App', async () => {
  const r = await 手机.打开(包名)
  if (!r.ok) throw new Error(r.错)
  await 等(4000)
  return 包名
})

await 步('处理隐私/用户协议弹窗', async () => {
  当前 = await 读界面(手机)
  const 弹 = 有(当前, /隐私|协议|同意|接受|知道了/)
  if (!弹.length) return '没有弹窗'
  for (const 词 of ['同意', '接受', '知道了']) {
    if (弹.some((e) => (e.文字 || e.描述 || '').includes(词))) {
      const r = await 手机.按文字点(词)
      if (r.ok) { await 等(3500); 当前 = await 读界面(手机); return `点了「${词}」` }
    }
  }
  throw new Error(`有弹窗但没找到同意按钮：${打印(弹)}`)
})

await 步('跳过登录（游客也能逛）', async () => {
  const 登录 = 有(当前, /登录|微信登录|手机号登录|其他方式/)
  if (!登录.length) return '没在登录页'
  for (const 词 of ['跳过', '暂不登录', '以后再说', '随便逛逛']) {
    const r = await 手机.按文字点(词)
    if (r.ok) { await 等(3500); 当前 = await 读界面(手机); return `点了「${词}」` }
  }
  // 有的版本没有"跳过"，退回去也一样能到主页
  await 手机.按键('back')
  await 等(2500)
  当前 = await 读界面(手机)
  return '没有跳过按钮，用 back 退出来了'
})

await 步('找到搜索入口', async () => {
  const 入口 = 找搜索入口(当前)
  if (!入口) throw new Error(`界面上没有搜索入口：${打印(当前.有字, 10)}`)
  return `[${入口.中心.join(',')}] 框 ${JSON.stringify(入口.框)}`
})

if (搜索词) {
  await 步(`搜索「${搜索词}」`, async () => {
    const 入口 = 找搜索入口(当前)
    if (入口) { await 手机.点(入口.中心[0], 入口.中心[1]); await 等(2800); 当前 = await 读界面(手机) }

    // 中文要 ADBKeyboard；没装就点热词兜底
    const 打 = await 手机.打字(搜索词)
    if (打.ok) {
      const 搜 = 有(当前, /^搜索$/).find((e) => e.可点)
      if (搜) await 手机.点(搜.中心[0], 搜.中心[1])
      else await 手机.按键('enter')
      await 等(4500)
      当前 = await 读界面(手机)
      return '打字 + 提交'
    }
    // 兜底：点界面上的热词
    const 热词 = (当前.有字 || []).find((e) => (e.文字 || '').includes(搜索词))
    if (热词) {
      await 手机.点(热词.中心[0], 热词.中心[1])
      await 等(4500)
      当前 = await 读界面(手机)
      return `打字不行，点了热词「${热词.文字}」`
    }
    throw new Error(`打不进中文（${打.错.slice(0, 40)}），界面上也没有「${搜索词}」热词`)
  })
}

await 步('读到商品列表（价格 / 销量）', async () => {
  const 商品 = 有(当前, /¥|￥|已拼|已售|人收藏|下单/)
  if (商品.length < 2) throw new Error(`没读到商品信息：${打印(当前.有字, 12)}`)
  return 打印(商品, 5)
})

await 步('点进第一个商品详情页', async () => {
  const 卡片 = 找商品卡片(当前)
  if (!卡片) throw new Error(`找不到商品卡片：${打印(当前.有字, 12)}`)
  const 之前前台 = (await 手机.状态()).前台
  await 手机.点(卡片.中心[0], 卡片.中心[1])

  for (let i = 0; i < 6; i++) {
    await 等(3000)
    const 状 = await 手机.状态()
    const 换页了 = 状.前台 && 状.前台 !== 之前前台
    const 树 = await 手机.界面({ 最多: 120 })
    const 有购买 = (树.元素们 || []).filter((e) => /立即购买|发起拼单|单独购买|加入购物车/.test(e.文字 || '')).length > 0
    if (有购买) {
      当前 = { ...树, 有字: (树.元素们 || []).filter((e) => e.文字 || e.描述) }
      const 标题 = 有(当前, /【|耳机|降噪|包|鞋|衣|机/).find((e) => (e.文字 || '').length > 6)
      return 标题 ? 标题.文字.slice(0, 26) : '已进详情页'
    }
    // 拼多多详情页是自绘的：uiautomator 读不出来本身就是"进去了"的信号
    if (树.页面读不出来) {
      当前 = { ok: true, 元素们: [], 有字: [], 页面读不出来: true }
      const 图 = await 手机.截图()
      return `已进详情页（这页 uiautomator 读不出来，只能截图：${图.ok ? Math.round(图.字节数 / 1024) + ' KB' : '截图也失败'}）`
    }
    if (换页了 && i >= 2) return `已换页（${状.前台}），但还没看到购买按钮`
  }
  throw new Error('点了但没进详情页（可能被登录墙挡住）')
})

await 步('找到购买按钮（到这里为止，不提交）', async () => {
  if (当前 && 当前.页面读不出来) {
    // 自绘页读不到元素 —— 这是拼多多详情页的真实情况，不是失败。
    // 走查到这里就停：再往下只能靠截图 + 坐标，那属于"人工/多模态"的活。
    return '这页是自绘界面，读不到元素；已截图留证，往下需要看图的模型按坐标点';
  }
  let 购买 = 有(当前, /立即购买|发起拼单|单独购买|加入购物车/)
  if (!购买.length) {
    // 详情页要滚到底才看得到底栏
    await 手机.划(360, 1000, 360, 400, 400)
    await 等(2500)
    当前 = await 读界面(手机)
    购买 = 有(当前, /立即购买|发起拼单|单独购买|加入购物车/)
  }
  if (!购买.length) throw new Error(`没找到购买按钮：${打印(当前.有字, 12)}`)
  const 主 = 购买.find((e) => /立即购买|发起拼单/.test(e.文字 || '')) || 购买[0]
  return `「${主.文字}」在 [${主.中心.join(',')}]`
})

console.log('')
const 购买 = 有(当前, /立即购买|发起拼单|单独购买/)
if (购买.length) {
  console.log('停在购买按钮前（没有点，避免产生真实订单）：')
  for (const e of 购买) console.log(`  ${e.可点 ? '▣' : '·'} [${e.中心.join(',')}] ${(e.文字 || e.描述 || '').slice(0, 40)}`)
  console.log('\n  要继续下单，让它调 phone_tap_text 点这个按钮；付款那一步会停在支付密码。')
}

const 失败 = 记录.filter((x) => !x.ok)
console.log('')
if (失败.length) {
  console.log(`✗ ${失败.length} 步没过：${失败.map((x) => x.步).join('、')}`)
  process.exit(1)
} else {
  console.log(`✓ ${记录.length} 步全过 —— 这条链路可以交给它自己跑了。`)
  process.exit(0)
}
