// dsh-qq-agency · 身体（ADB）
//
// 一台连着 adb 的安卓机，就是它在物理世界里的手和眼。
// 这里只封装最必要的动作：看（截图/状态/通知）、动（点/滑/打字/按键）、
// 起（打开 App）、连（设备列表）。所有函数都不抛异常，失败返回 { ok:false, 错 }。
//
// 为什么截图不用 `exec-out screencap -p`：Windows 上管道会把 PNG 的 \n 变成 \r\n，
// 图就烂了。稳妥做法是手机上先落一份，再 pull 回来 —— 多一次往返，但不会坏。

import { execFile } from 'node:child_process'
import { readFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'

/** 常见 adb 位置（找不到就用 PATH 里的 adb）。 */
export function 候选adb() {
  const 表 = ['adb']
  if (process.platform === 'win32') {
    const 本 = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    表.push(join(本, 'Android', 'Sdk', 'platform-tools', 'adb.exe'))
    表.push(join(process.env.ProgramFiles || 'C:\\Program Files', 'Android', 'platform-tools', 'adb.exe'))
  } else {
    表.push('/usr/bin/adb', '/usr/local/bin/adb', join(homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'))
  }
  return 表
}

/**
 * 跑一条 adb 命令。参数数组形式，不经 shell。
 *
 * 返回里带 `码`（退出码）：有些场景必须区分"命令跑了但退出码是 124"（手机端 timeout 生效）
 * 和"命令根本没跑起来"（ENOENT / 超时被杀），只看 ok/错 分不出来。
 * 注意不能靠 `sh -c '...; echo $?'` —— adb shell 会把 argv 用空格重新拼一遍，引号会丢。
 */
export function 跑(命令, 参数 = [], { 超时毫秒 = 15000 } = {}) {
  return new Promise((解) => {
    let 已解 = false
    const 收 = (ok, 值, 码) => {
      if (已解) return
      已解 = true
      解(ok ? { ok: true, 出: 值, 码: 码 ?? 0 } : { ok: false, 错: 值, 码: 码 ?? null })
    }
    try {
      const 子 = execFile(命令, 参数, { timeout: 超时毫秒, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (错误, stdout, stderr) => {
        if (错误) {
          const 尾巴 = String(stderr || '').trim().slice(0, 300)
          const 原因 = String((错误 && 错误.message) || 错误)
          const 码 = typeof 错误.code === 'number' ? 错误.code : null
          if (/timed out|ETIMEDOUT/i.test(原因)) return 收(false, `超时（${超时毫秒}ms）`, 码)
          if (/ENOENT/i.test(原因)) return 收(false, `找不到命令：${命令}`, null)
          // 非零退出码但有 stdout（比如 timeout 124）—— 把 stdout 也带上，调用方要能看
          return 收(false, 尾巴 || 原因, 码)
        }
        收(true, String(stdout || ''), 0)
      })
      子.on('error', (e) => 收(false, String((e && e.message) || e), null))
    } catch (error) {
      收(false, String((error && error.message) || error), null)
    }
  })
}

/**
 * 一台手机的句柄。
 * @param {object} 选项 { adb, 序列号, 临时目录 }
 */
export function 建手机({ adb = 'adb', 序列号 = '', 临时目录 = join(tmpdir(), 'dsh-qq-agency') } = {}) {
  const 命令 = String(adb || 'adb').trim() || 'adb'
  let 号 = String(序列号 || '').trim()
  let 前缀 = 号 ? ['-s', 号] : []

  async function 自动重连() {
    if (/:/.test(号)) {
      await 跑(命令, ['connect', 号], { 超时毫秒: 4000 })
    }
    if (号.includes('16384') || !号) {
      await 跑(命令, ['connect', '127.0.0.1:16384'], { 超时毫秒: 4000 })
    }
    const r = await 跑(命令, ['devices'], { 超时毫秒: 4000 })
    if (r.ok) {
      const 行们 = r.出.split(/\r?\n/).slice(1).map((x) => x.trim()).filter(Boolean)
      const 设备们 = 行们.map((行) => {
        const [id, 状态] = 行.split(/\s+/)
        return { id, 状态 }
      }).filter((x) => x.id && x.状态 === 'device')
      const 可用ids = 设备们.map((x) => x.id)

      if (号 && !可用ids.includes(号)) {
        if (号.includes('16384') && 可用ids.includes('emulator-5554')) {
          号 = 'emulator-5554'
          前缀 = ['-s', 号]
        } else if (可用ids.length === 1) {
          号 = 可用ids[0]
          前缀 = ['-s', 号]
        }
      } else if (!号 && 可用ids.length > 0) {
        号 = 可用ids[0]
        前缀 = ['-s', 号]
      }
    }
  }

  async function 跑adb(参数 = [], 选项 = {}) {
    let r = await 跑(命令, [...前缀, ...参数], 选项)
    if (!r.ok && /device .* not found|device offline/i.test(r.错 || '')) {
      await 自动重连()
      r = await 跑(命令, [...前缀, ...参数], 选项)
    }
    return r
  }

  async function 壳(...参数) {
    return 跑adb(['shell', ...参数], { 超时毫秒: 15000 })
  }

  /** 在不在。 */
  async function 在线() {
    if (/:/.test(号)) {
      await 跑(命令, ['connect', 号], { 超时毫秒: 3000 })
    }
    if (号.includes('16384')) {
      await 跑(命令, ['connect', '127.0.0.1:16384'], { 超时毫秒: 3000 })
    }
    let r = await 跑(命令, ['devices'], { 超时毫秒: 8000 })
    if (!r.ok) return { ok: false, 在线: false, 错: r.错 }
    let 行们 = r.出.split(/\r?\n/).slice(1).map((x) => x.trim()).filter(Boolean)
    let 设备们 = 行们.map((行) => {
      const [id, 状态] = 行.split(/\s+/)
      return { id, 状态 }
    }).filter((x) => x.id)
    let 可用 = 设备们.filter((x) => x.状态 === 'device')
    let 选的 = 号 ? 可用.find((x) => x.id === 号) : 可用[0]
    if (!选的 && 号 && 号.includes('16384')) {
      选的 = 可用.find((x) => x.id === 'emulator-5554')
      if (选的) {
        号 = 'emulator-5554'
        前缀 = ['-s', 号]
      }
    }
    if (!选的) {
      return {
        ok: true,
        在线: false,
        设备们,
        错: 设备们.length ? '设备在，但没授权（手机上点「允许调试」）' : '没看到任何设备（USB 连了吗 / adb 开了吗）',
      }
    }
    return { ok: true, 在线: true, 设备们, 序列号: 选的.id }
  }

  /** 电量、亮屏、分辨率、前台 App、系统版本 —— 一次采样。 */
  async function 状态() {
    const 在 = await 在线()
    if (!在.ok || !在.在线) return { ok: false, 在线: false, 错: 在.错 || '手机没连上' }

    const [电, 屏, 尺寸, 前台, 版] = await Promise.all([
      壳('dumpsys', 'battery'),
      壳('dumpsys', 'power'),
      壳('wm', 'size'),
      壳('dumpsys', 'activity', 'activities'),
      壳('getprop', 'ro.build.version.release'),
    ])

    const 电量 = (() => {
      const m = String(电.出 || '').match(/level:\s*(\d+)/i)
      return m ? Number(m[1]) : null
    })()
    const 充电 = /AC powered:\s*true|USB powered:\s*true|Wireless powered:\s*true/i.test(String(电.出 || ''))
    const 亮屏 = /mWakefulness=Awake|mScreenOn=true|Display Power:\s*state=ON/i.test(String(屏.出 || ''))
    const 分辨率 = (() => {
      const m = String(尺寸.出 || '').match(/(\d+)\s*x\s*(\d+)/i)
      return m ? { 宽: Number(m[1]), 高: Number(m[2]) } : null
    })()
    const 前台包名 = (() => {
      const 文 = String(前台.出 || '')
      const m = 文.match(/(?:mResumedActivity|topResumedActivity|mFocusedApp)[^\n]*?([a-zA-Z][\w.]+\/[a-zA-Z][\w.$]+)/)
      if (m) return m[1]
      const m2 = 文.match(/ResumedActivity:\s*ActivityRecord\{\S+\s+\S+\s+([a-zA-Z][\w.]+)\//)
      return m2 ? m2[1] : ''
    })()

    return {
      ok: true,
      在线: true,
      序列号: 在.序列号,
      电量,
      充电,
      亮屏,
      分辨率,
      前台: 前台包名,
      系统: String(版.出 || '').trim(),
    }
  }

  /** 截一张图，落到临时目录，返回 { 路径, 字节数, base64 }。 */
  async function 截图() {
    try { mkdirSync(临时目录, { recursive: true }) } catch (e) {}
    const 手机路径 = `/sdcard/.dsh-agency-${Date.now()}.png`
    const 本地路径 = join(临时目录, `shot-${Date.now()}.png`)
    const 截 = await 壳('screencap', '-p', 手机路径)
    if (!截.ok) return { ok: false, 错: `截图失败：${截.错}` }
    const 拉 = await 跑adb(['pull', 手机路径, 本地路径], { 超时毫秒: 20000 })
    void 壳('rm', '-f', 手机路径)
    if (!拉.ok) return { ok: false, 错: `取图失败：${拉.错}` }
    try {
      const buf = readFileSync(本地路径)
      if (!buf.length) return { ok: false, 错: '图是空的' }
      return { ok: true, 路径: 本地路径, 字节数: buf.length, base64: buf.toString('base64') }
    } catch (error) {
      return { ok: false, 错: `读图失败：${String((error && error.message) || error)}` }
    }
  }

  /** 点一下。 */
  async function 点(x, y) {
    const 横 = Math.round(Number(x))
    const 纵 = Math.round(Number(y))
    if (!Number.isFinite(横) || !Number.isFinite(纵) || 横 < 0 || 纵 < 0) return { ok: false, 错: '坐标不对' }
    return 壳('input', 'tap', String(横), String(纵))
  }

  /** 划一下（默认从下往上 = 刷下一条）。 */
  async function 划(x1, y1, x2, y2, 毫秒 = 300) {
    const 数 = [x1, y1, x2, y2].map((v) => Math.round(Number(v)))
    if (数.some((v) => !Number.isFinite(v))) return { ok: false, 错: '坐标不对' }
    return 壳('input', 'swipe', ...数.map(String), String(Math.max(50, Math.round(Number(毫秒) || 300))))
  }

  /**
   * 打字。
   * `input text` 只吃 ASCII —— 中文得靠 ADBKeyboard 的广播接口（手机上要装那个输入法并切过去）。
   *
   * ⚠ 这里必须**先确认 ADBKeyboard 真的装着**：`am broadcast` 发个没人收的广播
   *   一样返回 "Broadcast completed: result=0"，照那个判成功就是假成功 ——
   *   模型会以为字打进去了，实际什么都没发生。
   */
  async function 打字(文字) {
    const 文 = String(文字 || '')
    if (!文) return { ok: false, 错: '没有要打的字' }
    if (/^[\x20-\x7e\s]*$/.test(文)) {
      const 转 = 文.replace(/([\\'"&|<>()$`;*?~])/g, '\\$1').replace(/\s/g, '%s')
      return 壳('input', 'text', 转)
    }
    const 装了 = await 有ADBKeyboard()
    if (!装了) {
      return {
        ok: false,
        错: '中文打不进去：手机上没装 ADBKeyboard（`input text` 只支持 ASCII）。'
          + '装法：手机上装 ADBKeyboard 并切到它当输入法，再试。'
          + '（不想装就改用 phone_key / phone_tap_text 点按钮，别指望打字。）',
      }
    }
    const b64 = Buffer.from(文, 'utf8').toString('base64')
    const 广播 = await 壳('am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', b64)
    if (!广播.ok) return { ok: false, 错: `广播失败：${广播.错}` }
    if (/Error|Exception|Unable to find/i.test(广播.出 || '')) {
      return { ok: false, 错: `广播被拒：${String(广播.出).slice(0, 200)}` }
    }
    return { ok: true, 出: '已用 ADBKeyboard 广播输入' }
  }

  /** ADBKeyboard 装没装（结果缓存，别每次打字都查一遍包列表）。 */
  let adbKeyboard缓存 = null
  async function 有ADBKeyboard() {
    if (adbKeyboard缓存 !== null) return adbKeyboard缓存
    const r = await 壳('pm', 'list', 'packages')
    if (!r.ok) return false // 查不到就当没装，让它走"打不进去"的明确报错，而不是假装成功
    adbKeyboard缓存 = /package:[\w.]*adbkeyboard/i.test(String(r.出 || ''))
    return adbKeyboard缓存
  }

  /** 按键：home / back / recents / power / wake / enter / 或直接给 KEYCODE_xxx。 */
  async function 按键(键) {
    const 表 = {
      home: 'KEYCODE_HOME', back: 'KEYCODE_BACK', recents: 'KEYCODE_APP_SWITCH',
      power: 'KEYCODE_POWER', wake: 'KEYCODE_WAKEUP', sleep: 'KEYCODE_SLEEP',
      enter: 'KEYCODE_ENTER', delete: 'KEYCODE_DEL', volume_up: 'KEYCODE_VOLUME_UP',
      volume_down: 'KEYCODE_VOLUME_DOWN', camera: 'KEYCODE_CAMERA',
    }
    const 原名 = String(键 || '').trim()
    const 码 = 表[原名.toLowerCase()] || (/^KEYCODE_/.test(原名) ? 原名 : '')
    if (!码) return { ok: false, 错: `不认识的键：${原名}（可用：${Object.keys(表).join(' / ')}）` }
    return 壳('input', 'keyevent', 码)
  }

  /** 点亮并解锁（默认上滑；有锁屏密码的话只能到锁屏那一步）。 */
  async function 唤醒() {
    const 状 = await 状态()
    if (状.ok && 状.亮屏) return { ok: true, 出: '本来就是亮的' }
    await 按键('wake')
    await new Promise((r) => setTimeout(r, 400))
    const 尺寸 = (状 && 状.分辨率) || { 宽: 1080, 高: 2340 }
    await 划(尺寸.宽 / 2, 尺寸.高 * 0.82, 尺寸.宽 / 2, 尺寸.高 * 0.22, 220)
    return { ok: true, 出: '亮屏 + 上滑' }
  }

  /** 打开 App（包名）。 */
  async function 打开(pkg) {
    const 包 = String(pkg || '').trim()
    if (!包) return { ok: false, 错: '要给包名，比如 com.tencent.mobileqq' }
    const r = await 壳('monkey', '-p', 包, '-c', 'android.intent.category.LAUNCHER', '1')
    if (r.ok && !/No activities found|aborted/i.test(r.出 || '')) return { ok: true, 出: r.出.trim().slice(0, 200) }
    const 二 = await 壳('cmd', 'package', 'resolve-activity', '--brief', 包)
    if (二.ok) {
      const 组件 = String(二.出 || '').split(/\r?\n/).map((x) => x.trim()).filter((x) => x.includes('/')).pop()
      if (组件) {
        const 三 = await 壳('am', 'start', '-n', 组件)
        return 三.ok ? { ok: true, 出: `已启动 ${组件}` } : { ok: false, 错: 三.错 }
      }
    }
    return { ok: false, 错: `打不开 ${包}（没装？或者没有可启动的 Activity）` }
  }

  /** 未读通知摘要（标题 + 包名）。 */
  async function 通知() {
    const r = await 壳('dumpsys', 'notification', '--noredact')
    if (!r.ok) return { ok: false, 错: r.错 }
    const 文 = String(r.出 || '')
    const 条们 = []
    const 块们 = 文.split(/NotificationRecord\{/)
    for (const 块 of 块们.slice(1)) {
      const 包 = (块.match(/pkg=([\w.]+)/) || [])[1] || ''
      const 标题 = (块.match(/android\.title=([^\n]*)/) || [])[1] || ''
      const 正文 = (块.match(/android\.text=([^\n]*)/) || [])[1] || ''
      if (!标题 && !正文) continue
      条们.push({ 包, 标题: 标题.trim().slice(0, 80), 正文: 正文.trim().slice(0, 120) })
      if (条们.length >= 20) break
    }
    return { ok: true, 数量: 条们.length, 通知们: 条们 }
  }

  /** 拍一张照（调系统相机；有的机型需要前台，拍完图在 DCIM）。 */
  async function 拍照() {
    const 前 = await 状态()
    if (前.ok && !前.亮屏) await 唤醒()
    const 打 = await 壳('am', 'start', '-a', 'android.media.action.STILL_IMAGE_CAMERA')
    if (!打.ok) return { ok: false, 错: `打不开相机：${打.错}` }
    await new Promise((r) => setTimeout(r, 1800))
    const 快门 = await 按键('camera')
    await new Promise((r) => setTimeout(r, 1500))
    return { ok: 快门.ok, 出: '已按下快门（照片在手机相册里；要发出来得先 pull）', 错: 快门.ok ? '' : 快门.错 }
  }

  /** 白名单内的 adb shell（默认关，配置里显式打开才用）。 */
  async function 任意壳(参数们) {
    const 白 = ['input', 'wm', 'am', 'pm', 'dumpsys', 'settings', 'getprop', 'screencap', 'cmd', 'monkey', 'ls', 'cat', 'df', 'top', 'ps', 'uiautomator']
    const 首 = String((参数们 && 参数们[0]) || '')
    if (!白.includes(首)) return { ok: false, 错: `不允许的 adb shell 命令：${首}（白名单：${白.join(' ')}）` }
    return 壳(...参数们.map(String))
  }

  /**
   * 界面树：屏幕上现在有哪些元素、能不能点、中心在哪。
   *
   * 为什么必须有这个：只给模型一张截图，它看得见却点不准 ——
   * 而且纯文本模型根本看不见图。uiautomator 给的是**可点的文字和坐标**，
   * 这才是"能操作 App"和"瞎点"的区别。
   *
   * ⚠ 两个坑，都在真机上踩过：
   *  1. `uiautomator dump` 偶尔会**卡死**（进程挂在 futex 上）。adb 客户端被超时杀掉后，
   *     手机端那个 uiautomator 会变成孤儿继续占着 dump 锁，导致后面每次 dump 都超时。
   *     所以失败时要先 `pkill -f uiautomator` 清掉孤儿，再重试。
   *  2. 页面切换瞬间 dump 会得到空树。所以空树也算失败，往上抛让调用方重试。
   */
  async function 界面({ 只要可点 = false, 最多 = 80 } = {}) {
    const 手机路径 = '/sdcard/.dsh-agency-ui.xml'
    let 文 = ''

    const 清孤儿 = async () => {
      await 壳('pkill', '-f', 'uiautomator')
      await 壳('rm', '-f', 手机路径)
    }

    // 关键：用手机自带的 `timeout` 包住 dump —— 让**手机端**自己到点杀掉 uiautomator。
    // 只靠 adb 客户端的超时不够：客户端被杀后手机端的 uiautomator 会变孤儿，一直占着 dump 锁。
    //
    // 快失败很重要：如果手机端返回 124（它自己超时了），说明这个页面**根本 dump 不动**
    // （自绘界面/防截取），再试三次只是白等 30 秒 —— 直接放弃，让调用方改走截图。
    const 试法 = [
      { 压缩: true, 先清: false },
      { 压缩: false, 先清: true },
    ]
    let 页面读不出来 = false
    for (const { 压缩, 先清 } of 试法) {
      if (先清) await 清孤儿()
      const 参数 = ['uiautomator', 'dump', ...(压缩 ? ['--compressed'] : []), 手机路径]
      // 手机端 timeout 8 秒：到点它自己杀 uiautomator，不会留孤儿进程占着 dump 锁。
      // 退出码 124 是 timeout 的约定 —— 说明这页根本 dump 不动，别再试第二次白等。
      const 存 = await 壳('timeout', '8', ...参数)
      if (存.码 === 124) { 页面读不出来 = true; break }
      if (!存.ok) continue
      const 读 = await 壳('cat', 手机路径)
      await 壳('rm', '-f', 手机路径)
      if (读.ok && String(读.出 || '').includes('<hierarchy')) { 文 = String(读.出); break }
    }
    if (!文) {
      await 清孤儿()
      return {
        ok: false,
        页面读不出来,
        错: 页面读不出来
          ? '这个页面 uiautomator 读不出来（自绘界面/防截取，拼多多商品详情页就是这样）。'
            + '改用 phone_look 截图看画面，再用 phone_tap 按坐标点。'
          : '拿不到界面树（页面可能还在加载，稍等 1-2 秒再试一次）',
      }
    }

    const 解 = (s) => String(s || '')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

    const 元素们 = []
    const 正则 = /<node\b([^>]*?)\/?>/g
    let m
    while ((m = 正则.exec(文)) !== null) {
      const 属性 = {}
      const 属性正则 = /([\w-]+)="([^"]*)"/g
      let a
      while ((a = 属性正则.exec(m[1])) !== null) 属性[a[1]] = a[2]

      const 边界 = String(属性.bounds || '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
      if (!边界) continue
      const x1 = Number(边界[1]); const y1 = Number(边界[2])
      const x2 = Number(边界[3]); const y2 = Number(边界[4])
      const 宽 = x2 - x1
      const 高 = y2 - y1
      if (宽 <= 0 || 高 <= 0) continue

      const 文字 = 解(属性.text)
      const 描述 = 解(属性['content-desc'])
      const 可点 = 属性.clickable === 'true'
      const 可滚 = 属性.scrollable === 'true'
      if (!文字 && !描述 && !可点 && !可滚) continue // 布局壳子，纯噪音
      if (只要可点 && !可点) continue
      if (可点 && 宽 < 8 && 高 < 8) continue // 太小的点是装饰

      元素们.push({
        文字: 文字.slice(0, 60),
        描述: 描述.slice(0, 60),
        类型: String(属性.class || '').split('.').pop(),
        标识: String(属性['resource-id'] || '').replace(/^.*:id\//, '').slice(0, 40),
        可点,
        可滚,
        密码: 属性.password === 'true',
        禁用: 属性.enabled === 'false',
        中心: [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)],
        框: [x1, y1, x2, y2],
      })
      if (元素们.length >= Math.max(1, Math.min(200, 最多))) break
    }

    const 包 = (文.match(/package="([\w.]+)"/) || [])[1] || ''
    const 旋转 = Number((文.match(/rotation="(\d)"/) || [])[1] || 0)
    return { ok: true, 数量: 元素们.length, 前台包: 包, 旋转, 元素们 }
  }

  /**
   * 按文字点：在界面树里找「包含这段字」的元素，点它的中心。
   * 这是最稳的操作方式 —— 比让模型猜坐标可靠得多。
   */
  async function 按文字点(要找, { 精确 = false, 第几个 = 1 } = {}) {
    const 目标 = String(要找 || '').trim()
    if (!目标) return { ok: false, 错: '要找什么字？' }
    const 树 = await 界面({ 最多: 200 })
    if (!树.ok) return { ok: false, 错: 树.错 }

    const 命中 = 树.元素们.filter((e) => {
      const 候选 = [e.文字, e.描述].filter(Boolean)
      return 候选.some((t) => (精确 ? t === 目标 : t.includes(目标)))
    })
    if (!命中.length) {
      const 有字 = 树.元素们.filter((e) => e.文字 || e.描述).slice(0, 15).map((e) => e.文字 || e.描述)
      return { ok: false, 错: `界面上找不到「${目标}」。现在能看到的字：${有字.join(' / ') || '（一片空白）'}` }
    }
    const 排 = 命中.slice().sort((a, b) => Number(b.可点) - Number(a.可点))
    const 选 = 排[Math.max(0, Math.min(排.length - 1, Number(第几个) - 1))]
    const 点结果 = await 点(选.中心[0], 选.中心[1])
    return 点结果.ok
      ? { ok: true, 出: `点了「${选.文字 || 选.描述}」(${选.中心[0]}, ${选.中心[1]})`, 点中: 选 }
      : { ok: false, 错: 点结果.错 }
  }

  /** 清掉旧的临时截图（心跳跑久了别把盘塞满），保留最近 N 张。 */
  function 清理临时(保留 = 12) {
    try {
      mkdirSync(临时目录, { recursive: true })
      const 表 = readdirSync(临时目录)
        .filter((x) => /^shot-\d+\.png$/.test(x))
        .map((x) => {
          const p = join(临时目录, x)
          let 时 = 0
          try { 时 = statSync(p).mtimeMs } catch (e) { 时 = 0 }
          return { p, 时 }
        })
        .sort((a, b) => b.时 - a.时)
      let 删了 = 0
      for (const x of 表.slice(Math.max(0, 保留))) {
        try { unlinkSync(x.p); 删了 += 1 } catch (e) {}
      }
      return 删了
    } catch (e) {
      return 0
    }
  }

  return { 命令, 序列号: 号, 在线, 状态, 截图, 点, 划, 打字, 按键, 唤醒, 打开, 通知, 拍照, 任意壳, 界面, 按文字点, 清理临时 }
}

/** 删掉一张临时图（发完就删，别攒）。 */
export function 删图(路径) {
  try { if (路径 && existsSync(路径)) unlinkSync(路径) } catch (e) {}
}
