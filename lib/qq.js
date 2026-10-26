// dsh-qq-agency · 嘴和耳朵（OneBot 11 HTTP 客户端）
//
// 只做 HTTP，不连 WebSocket、不依赖 BOT 框架：NapCat / SnowLuma 都把接口开在
// 一个 http 端口上（默认 127.0.0.1:3000），这里就按 OneBot 11 的 action 名调用。
//
// 所有方法都不抛异常：连不上 QQ 后端不该把整个 DSH 带崩，
// 返回 { ok:false, 错 } 让上层记一笔、等下一次心跳再试。

/** 一个 OneBot 11 的 HTTP 客户端。 */
export function 建QQ({ 基址, 令牌 = '', 超时毫秒 = 8000 } = {}) {
  const 地址 = String(基址 || 'http://127.0.0.1:3000').replace(/\/+$/, '')
  const 令牌串 = String(令牌 || '').trim()

  async function 调用(action, 体 = {}, 超时 = 超时毫秒) {
    const 控制 = typeof AbortController === 'function' ? new AbortController() : null
    const 表 = 控制 ? setTimeout(() => { try { 控制.abort() } catch (e) {} }, 超时) : null
    try {
      const 头 = { 'content-type': 'application/json' }
      if (令牌串) 头.authorization = `Bearer ${令牌串}`
      const r = await fetch(`${地址}/${action}`, {
        method: 'POST',
        headers: 头,
        body: JSON.stringify(体 || {}),
        signal: 控制 ? 控制.signal : undefined,
      })
      const 文 = await r.text()
      let j = null
      try { j = JSON.parse(文) } catch (e) { j = null }
      if (!j) return { ok: false, action, 错: `返回的不是 JSON（HTTP ${r.status}）：${文.slice(0, 160)}` }
      const 成功 = j.status === 'ok' || j.retcode === 0
      return { ok: 成功, action, 数据: j.data, 原始: j, 错: 成功 ? '' : String(j.wording || j.message || `retcode=${j.retcode}`) }
    } catch (error) {
      const 原因 = String((error && error.message) || error)
      return { ok: false, action, 错: 原因 === 'This operation was aborted' ? `超时（${超时}ms）` : 原因 }
    } finally {
      if (表) clearTimeout(表)
    }
  }

  /** 连着的 QQ 是哪个号。顺便当连通性检查。 */
  async function 登录信息() {
    const r = await 调用('get_login_info', {}, 4000)
    if (!r.ok) return { ok: false, 错: r.错 }
    const d = r.数据 || {}
    return { ok: true, QQ号: String(d.user_id || ''), 昵称: String(d.nickname || '') }
  }

  /** 一条纯文字消息体。 */
  const 文字段 = (text) => [{ type: 'text', data: { text: String(text) } }]

  /** 一条 base64 图片段（不依赖 QQ 后端能不能访问本机文件）。 */
  const 图段 = (base64) => [{ type: 'image', data: { file: 'base64://' + String(base64) } }]

  /** 发私聊。图用 base64。 */
  async function 发私聊(QQ号, 文字, 图们 = []) {
    const 段 = 文字 ? 文字段(文字) : []
    const 出 = []
    if (段.length) 出.push(await 调用('send_private_msg', { user_id: Number(QQ号), message: 段 }))
    for (const b64 of 图们) {
      出.push(await 调用('send_private_msg', { user_id: Number(QQ号), message: 图段(b64) }))
    }
    return 合并(出, '发私聊')
  }

  /** 发群。图用 base64。 */
  async function 发群(群号, 文字, 图们 = []) {
    const 段 = 文字 ? 文字段(文字) : []
    const 出 = []
    if (段.length) 出.push(await 调用('send_group_msg', { group_id: Number(群号), message: 段 }))
    for (const b64 of 图们) {
      出.push(await 调用('send_group_msg', { group_id: Number(群号), message: 图段(b64) }))
    }
    return 合并(出, '发群')
  }

  function 合并(结果们, 标签) {
    if (!结果们.length) return { ok: false, 错: `${标签}：没有要发的内容` }
    const 坏的 = 结果们.filter((x) => !x.ok)
    return 坏的.length
      ? { ok: false, 错: `${标签}失败：${坏的.map((x) => x.错).join('；').slice(0, 300)}`, 结果们 }
      : { ok: true, 结果们 }
  }

  /** 拉最近私聊记录（按时间正序返回）。 */
  async function 拉私聊(QQ号, 条数 = 10) {
    const r = await 调用('get_friend_msg_history', { user_id: Number(QQ号), count: Math.max(1, Math.min(50, 条数)) })
    return r.ok && r.数据 && Array.isArray(r.数据.messages) ? r.数据.messages.slice() : []
  }

  /** 拉最近群记录（按时间正序返回）。 */
  async function 拉群(群号, 条数 = 30) {
    const r = await 调用('get_group_msg_history', { group_id: Number(群号), count: Math.max(1, Math.min(50, 条数)) })
    return r.ok && r.数据 && Array.isArray(r.数据.messages) ? r.数据.messages.slice() : []
  }

  /**
   * 我加了哪些群 —— 给设置页挑群用，不用手抄群号。
   * OneBot 的 `get_group_list` 返回 [{ group_id, group_name, member_count, max_member_count }]。
   */
  async function 拉群列表() {
    const r = await 调用('get_group_list', {}, 10000)
    if (!r.ok) return { ok: false, 错: r.错, 群们: [] }
    const 列 = Array.isArray(r.数据) ? r.数据 : (r.数据 && Array.isArray(r.数据.groups) ? r.数据.groups : [])
    const 群们 = 列
      .map((g) => ({
        群号: String((g && (g.group_id || g.groupId)) || ''),
        名称: String((g && (g.group_name || g.groupName)) || ''),
        人数: Number((g && (g.member_count || g.memberCount)) || 0),
        上限: Number((g && (g.max_member_count || g.maxMemberCount)) || 0),
      }))
      .filter((g) => g.群号)
    return { ok: true, 群们, 数量: 群们.length }
  }

  return { 地址, 调用, 登录信息, 发私聊, 发群, 拉私聊, 拉群, 拉群列表 }
}

/**
 * 把一条 OneBot 消息拆成「谁、什么时候、说了什么、有没有图、有没有 @ 我」。
 *
 * @param {object} 条     OneBot 的 message 对象
 * @param {string} 我     自己的 QQ 号（用来判断 @ 的是不是自己、以及别把自己的话当别人说的）
 */
export function 解析一条(条, 我 = '') {
  if (!条 || typeof 条 !== 'object') return null
  const 段们 = Array.isArray(条.message) ? 条.message : []
  const 文字们 = []
  const 图们 = []
  let 提到我 = false
  for (const 段 of 段们) {
    if (!段 || typeof 段 !== 'object') continue
    const d = 段.data && typeof 段.data === 'object' ? 段.data : {}
    if (段.type === 'text' && typeof d.text === 'string') 文字们.push(d.text)
    else if (段.type === 'at' && String(d.qq || '') === String(我 || '')) 提到我 = true
    else if (段.type === 'image' || 段.type === 'mface') 图们.push(d)
  }
  const 发送者 = 条.sender && typeof 条.sender === 'object' ? 条.sender : {}
  const 名字 = String(发送者.card || 发送者.nickname || 条.user_id || '')
  return {
    id: String(条.message_id || ''),
    时间: Number(条.time) || 0,
    QQ号: String(条.user_id || ''),
    名字,
    文字: 文字们.join('').trim(),
    图们,
    提到我,
    是私聊: 条.message_type === 'private' || (!条.group_id && !!条.user_id),
    群号: String(条.group_id || ''),
  }
}

/** 只留「别人说的」：过滤掉自己的话、空消息、系统提示。 */
export function 别人的话(条们, 我 = '') {
  return (Array.isArray(条们) ? 条们 : [])
    .map((x) => 解析一条(x, 我))
    .filter((x) => x && x.QQ号 && String(x.QQ号) !== String(我 || ''))
    .filter((x) => x.文字 || x.图们.length)
}

/**
 * 话题命中：配置里给几个词，群里提到就算「跟我有关」。
 * 这是很笨的相关度，但够用 —— 真正判断该不该说话的是内心那一层。
 */
export function 话题命中(文字们, 词表) {
  const 词 = (Array.isArray(词表) ? 词表 : String(词表 || '').split(/[,，\s]+/))
    .map((x) => String(x || '').trim())
    .filter((x) => x.length >= 1)
  if (!词.length) return false
  const 全 = (Array.isArray(文字们) ? 文字们 : [文字们]).map((x) => String(x || '')).join('\n')
  if (!全) return false
  return 词.some((w) => 全.includes(w))
}
