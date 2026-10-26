// 真机检查：连上一台真的安卓机（或模拟器），把插件会用到的每个动作都试一遍。
//
//   node tests/phone-check.mjs                      # 自动找 adb / 自动找设备
//   node tests/phone-check.mjs 127.0.0.1:16384      # 指定设备
//   node tests/phone-check.mjs 127.0.0.1:16384 "D:\path\adb.exe"
//
// 这个脚本不碰 QQ、不发消息，只验证「手和眼睛」。
// 退出码 0 = 全过；1 = 有一步失败（失败那步会写清楚原因）。

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { 建手机, 跑, 候选adb } from '../lib/phone.js'

const 设备参数 = process.argv[2] || ''
const adb参数 = process.argv[3] || ''

const 等 = (ms) => new Promise((r) => setTimeout(r, ms))
let 失败 = 0
const 步 = async (名, fn) => {
  try {
    const 值 = await fn()
    console.log(`  ✓ ${名}${值 ? `  —— ${值}` : ''}`)
    return true
  } catch (error) {
    失败 += 1
    console.log(`  ✗ ${名}\n      ${String((error && error.message) || error)}`)
    return false
  }
}

/** 找到能用的 adb：先看参数，再看 PATH，再看模拟器自带。 */
async function 找adb() {
  if (adb参数) {
    if (!existsSync(adb参数)) throw new Error(`指定的 adb 不存在：${adb参数}`)
    return adb参数
  }
  for (const 候选 of 候选adb()) {
    if (候选 !== 'adb' && !existsSync(候选)) continue
    const r = await 跑(候选, ['version'], { 超时毫秒: 8000 })
    if (r.ok) return 候选
  }
  // MuMu / BlueStacks 常见的自带位置
  const 额外 = [
    'D:\\Program Files\\Netease\\MuMu Player 12\\shell\\adb.exe',
    'C:\\Program Files\\Netease\\MuMu Player 12\\shell\\adb.exe',
    join(homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  ]
  for (const p of 额外) {
    if (!existsSync(p)) continue
    const r = await 跑(p, ['version'], { 超时毫秒: 8000 })
    if (r.ok) return p
  }
  throw new Error('找不到 adb。装 platform-tools 并加进 PATH，或者把路径当第 2 个参数传进来。')
}

console.log('真机检查（只动手机，不碰 QQ）\n')

const adb = await 找adb()
console.log(`adb：${adb}`)

// 没指定设备就看看有没有现成的；没有就试几个模拟器常用端口
let 序列号 = 设备参数
if (!序列号) {
  const 列 = await 跑(adb, ['devices'], { 超时毫秒: 8000 })
  const 行们 = String(列.出 || '').split(/\r?\n/).slice(1).map((x) => x.trim()).filter(Boolean)
  const 可用 = 行们.map((x) => x.split(/\s+/)).filter((x) => x[1] === 'device').map((x) => x[0])
  序列号 = 可用[0] || ''
  if (!序列号) {
    for (const 端口 of [16384, 5555, 7555, 62001]) {
      await 跑(adb, ['connect', `127.0.0.1:${端口}`], { 超时毫秒: 6000 })
    }
    const 再 = await 跑(adb, ['devices'], { 超时毫秒: 8000 })
    序列号 = (String(再.出 || '').split(/\r?\n/).slice(1).map((x) => x.trim().split(/\s+/)).find((x) => x[1] === 'device') || [])[0] || ''
  }
  if (!序列号) {
    console.log('\n✗ 没找到任何设备。')
    console.log('  手机：开「开发者选项 → USB 调试」，插上线，在手机上点「允许调试」。')
    console.log('  模拟器：先把模拟器启动起来，再跑这个脚本（会自动试 16384 / 5555 等端口）。')
    process.exit(1)
  }
}
console.log(`设备：${序列号}\n`)

const 手机 = 建手机({ adb, 序列号, 临时目录: join(process.cwd(), 'tests', '.tmp') })

await 步('设备在线且已授权', async () => {
  const r = await 手机.在线()
  if (!r.ok) throw new Error(r.错)
  if (!r.在线) throw new Error(r.错 || '设备不在线')
  return r.序列号
})

await 步('读状态（电量 / 亮屏 / 分辨率 / 前台）', async () => {
  const s = await 手机.状态()
  if (!s.ok) throw new Error(s.错)
  return `电量 ${s.电量 ?? '?'}%${s.充电 ? '（充电中）' : ''}，${s.亮屏 ? '亮屏' : '息屏'}，`
    + `${s.分辨率 ? `${s.分辨率.宽}x${s.分辨率.高}` : '分辨率未知'}，前台 ${s.前台 || '?'}，安卓 ${s.系统 || '?'}`
})

await 步('截一张图', async () => {
  const r = await 手机.截图()
  if (!r.ok) throw new Error(r.错)
  if (r.字节数 < 5000) throw new Error(`图太小（${r.字节数} 字节），可能是坏图`)
  return `${Math.round(r.字节数 / 1024)} KB → ${r.路径}`
})

await 步('读界面树（能拿到文字和坐标）', async () => {
  const r = await 手机.界面({ 最多: 40 })
  if (!r.ok) throw new Error(r.错)
  const 有字 = r.元素们.filter((e) => e.文字 || e.描述).length
  if (有字 === 0) throw new Error('界面树里一个有字的元素都没有（当前可能在锁屏或空白页）')
  return `${r.数量} 个元素（${有字} 个有字），前台 ${r.前台包}`
})

await 步('打开系统设置', async () => {
  const r = await 手机.打开('com.android.settings')
  if (!r.ok) throw new Error(r.错)
  await 等(2200)
  const s = await 手机.状态()
  if (s.ok && s.前台 && !String(s.前台).includes('settings')) {
    throw new Error(`打开了但前台是 ${s.前台}`)
  }
  return '前台已切到 com.android.settings'
})

await 步('按文字点一个入口（这就是「会操作」）', async () => {
  const 树 = await 手机.界面({ 最多: 60 })
  if (!树.ok) throw new Error(树.错)
  const 候选 = ['存储', '应用', '通知', '声音', '电池', '网络和互联网', '显示', '关于手机']
  const 命中 = 候选.find((字) => 树.元素们.some((e) => (e.文字 || e.描述 || '').includes(字)))
  if (!命中) throw new Error(`设置首页上找不到这些入口：${候选.join(' / ')}`)
  const 点 = await 手机.按文字点(命中)
  if (!点.ok) throw new Error(点.错)
  await 等(2000)
  const 后 = await 手机.界面({ 最多: 40 })
  const 字们 = (后.元素们 || []).filter((e) => e.文字 || e.描述).map((e) => e.文字 || e.描述)
  return `点了「${命中}」→ 现在屏幕上是：${字们.slice(0, 4).join(' / ')}`
})

await 步('按不存在的字会给出清楚的报错', async () => {
  const r = await 手机.按文字点('这个字肯定不存在_zzz')
  if (r.ok) throw new Error('居然点到了？')
  if (!r.错.includes('找不到')) throw new Error(`报错不清楚：${r.错}`)
  return '报错里带上了当前屏幕上真实存在的字'
})

await 步('按键：返回 + 回桌面', async () => {
  const b = await 手机.按键('back')
  if (!b.ok) throw new Error(b.错)
  await 等(700)
  const h = await 手机.按键('home')
  if (!h.ok) throw new Error(h.错)
  await 等(700)
  return 'back → home 都按了'
})

await 步('打字（ASCII 一定行；中文要 ADBKeyboard）', async () => {
  const r = await 手机.打字('agency-test-123')
  if (!r.ok) throw new Error(r.错)
  const 中文 = await 手机.打字('中文测试')
  return 中文.ok ? '中英文都能打' : 'ASCII 能打；中文需要手机装 ADBKeyboard（插件会明说，不会假装成功）'
})

await 步('看通知栏', async () => {
  const r = await 手机.通知()
  if (!r.ok) throw new Error(r.错)
  return `${r.数量} 条${r.数量 ? `：${r.通知们.slice(0, 2).map((x) => x.标题 || x.正文 || x.包).join(' / ')}` : ''}`
})

await 步('清理临时截图', async () => {
  const n = 手机.清理临时(2)
  return `删了 ${n} 张旧图`
})

console.log('')
if (失败) {
  console.log(`✗ ${失败} 步没过。上面每条都写了原因。`)
  process.exit(1)
} else {
  console.log('✓ 全过 —— 这台机器可以交给它当身体了。')
  console.log('  下一步：设置 → 它自己 → 「允许玩手机」打开，填好 adb 路径和设备序列号。')
  process.exit(0)
}
