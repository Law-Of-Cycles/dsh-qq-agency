// dsh-qq-agency · 网页半边
//
// 只干一件事：在 DSH 设置左侧栏加一项「它自己」，把内在状态摆出来，
// 再给一张能改的表（开关 / 脑子 / QQ / 节奏 / 身体 / 人格）。
//
// 这里不碰会话、不发消息，只往宿主那几条 /dsh-qq-agency/* 路由上读写。

window.__ModuleLoader__.load({
  id: 'dsh-qq-agency',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']

    const B = '/dsh-qq-agency'
    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const post = (p, body) =>
      fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then((r) => r.json())
        .catch(() => null)

    /** 「123, 456」→ ['123','456']（勾选状态靠它对）。 */
    const 群号表 = (s) => String(s || '').split(/[,，\s;；]+/).map((x) => x.trim()).filter(Boolean)

    /** 勾上/取消一个群号，返回新的字符串。 */
    const 拼群号 = (表, 群号, 要选) => {
      const 新 = 表.filter((x) => x !== 群号)
      if (要选) 新.push(群号)
      return 新.join(', ')
    }

    const h = React.createElement

    const S = {
      wrap: {
        padding: '12px 14px 24px',
        fontSize: 13,
        lineHeight: 1.7,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
        borderRadius: 12,
      },
      h: { fontSize: 14, fontWeight: 600, margin: '18px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12 },
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      row: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' },
      lab: { minWidth: 190, paddingTop: 3, fontSize: 12.5 },
      ctl: { flex: '1 1 260px', minWidth: 220 },
      hint: { opacity: 0.6, fontSize: 11.5, marginTop: 2 },
      input: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: '100%',
        boxSizing: 'border-box',
      },
      small: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: 110,
        boxSizing: 'border-box',
      },
      ok: { color: 'var(--dsw-alias-state-business-primary)', fontSize: 12 },
      bad: { color: '#c0392b', fontSize: 12 },
      btn: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 12px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        cursor: 'pointer',
      },
      保存条: {
        position: 'sticky',
        bottom: 0,
        marginTop: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.95))',
        boxShadow: '0 -6px 18px rgba(0,0,0,.18)',
        zIndex: 5,
      },
      log: {
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 11.5,
        maxHeight: 240,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        opacity: 0.9,
      },
      bar: { height: 6, borderRadius: 3, background: 'rgba(128,128,128,.25)', overflow: 'hidden', width: 120 },
      barIn: (v, 色) => ({ height: '100%', width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`, background: 色 }),
    }

    const 字段说明 = {
      主动性: '0 = 很安静，几乎不主动；50 = 正常；100 = 很黏人',
      心跳秒: '多久想一次事。10–600 秒，默认 30',
      目标会话: '用哪个会话当它的脑子 —— 心跳和接话都在这一间里发生',
      私聊直达: '主人私聊它 → 转进会话正常回（和 dsh-qq-bridge 二选一，别同时开）',
      群被叫直达: '群里 @ 它 → 转进会话回一句',
      群号们: '逗号或空格分隔，可以填好几个',
      话题词: '提到这些词算「跟我有关」，会更容易插话',
      免打扰开始: '这个时间段里，除了被点名，它自己不会开口',
      玩手机后汇报: '刷手机看到通知，想不想顺口跟主人说一句',
      允许办事: '让它能办「要跑几分钟、中间要问你」的事，比如去商店买个东西',
      单笔预算上限: '单笔最多花多少块。0 = 不限（不建议）',
      每天最多办事: '一天最多发起几件事，防止它反复折腾',
      办事要确认: '下单前必须你再点头一次（强烈建议保持开着）',
      人格补充: '追加到系统提示词末尾，比如「说话别太客气，可以损人」',
    }

    function 字段({ 标签, 说明, 孩子 }) {
      return h('div', { style: S.row },
        h('div', { style: S.lab }, 标签, 说明 ? h('div', { style: S.hint }, 说明) : null),
        h('div', { style: S.ctl }, 孩子),
      )
    }

    function 开关({ 值, onChange, 标签, 说明 }) {
      return 字段({
        标签,
        说明,
        孩子: h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' } },
          h('input', { type: 'checkbox', checked: !!值, onChange: (e) => onChange(e.target.checked) }),
          h('span', { style: S.dim }, 值 ? '开' : '关'),
        ),
      })
    }

    function 数字({ 值, onChange, 标签, 说明, 宽 = 110 }) {
      return 字段({
        标签,
        说明,
        孩子: h('input', {
          type: 'number',
          style: { ...S.small, width: 宽 },
          value: 值,
          onChange: (e) => onChange(e.target.value === '' ? '' : Number(e.target.value)),
        }),
      })
    }

    function 文本({ 值, onChange, 标签, 说明, 密码 }) {
      return 字段({
        标签,
        说明,
        孩子: h('input', {
          type: 密码 ? 'password' : 'text',
          style: S.input,
          value: 值 || '',
          onChange: (e) => onChange(e.target.value),
        }),
      })
    }

    function 进度({ 名, 值, 色 }) {
      return h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 } },
        h('span', { style: { minWidth: 52, ...S.dim } }, 名),
        h('div', { style: S.bar }, h('div', { style: S.barIn(值, 色) })),
        h('span', { style: { ...S.dim, minWidth: 34 } }, Number(值 || 0).toFixed(2)),
      )
    }

    function Section() {
      const [状态, set状态] = React.useState(null)
      const [表单, set表单] = React.useState(null)
      const [提示, set提示] = React.useState('')
      const [忙, set忙] = React.useState('')
      const [试说, set试说] = React.useState('')
      const [试任务, set试任务] = React.useState('')
      const [任务摘要, set任务摘要] = React.useState('')
      const [脏, set脏] = React.useState(false)
      const [群们, set群们] = React.useState([])
      const [群缓存, set群缓存] = React.useState('')

      const 拉 = React.useCallback(async () => {
        const s = await get('/state')
        if (!s || !s.ok) {
          set提示(s && s.说 ? `读不到状态：${s.说}` : '读不到状态（宿主那半边没起来？）')
          return
        }
        set状态(s)
        set表单((旧) => 旧 || { ...s.配置 })
        // 群列表读缓存（不主动打扰 QQ 后端）；已经拉过就不覆盖，免得轮询时闪
        const g = await post('/groups', { 刷新: false })
        if (g) {
          set群们((旧) => (旧.length ? 旧 : (g.群们 || [])))
          set群缓存((旧) => 旧 || (g.缓存 || ''))
        }
        const t = await post('/task', {})
        if (t && t.ok) set任务摘要(t.摘要 || '手上没活儿')
      }, [])

      React.useEffect(() => { void 拉() }, [拉])
      React.useEffect(() => {
        const t = setInterval(() => { void 拉() }, 8000)
        return () => clearInterval(t)
      }, [拉])

      const 改 = (键, 值) => {
        set表单((旧) => ({ ...(旧 || {}), [键]: 值 }))
        set脏(true)
        set提示('')
      }

      const 保存 = async () => {
        set忙('save')
        const r = await post('/save', 表单 || {})
        set忙('')
        if (r && r.ok) {
          set状态(r)
          set表单({ ...r.配置 })
          set脏(false)
          set提示('保存好了')
        } else {
          set提示(r && r.说 ? r.说 : '保存失败')
        }
      }

      const 动作 = async (路径, 体, 名字) => {
        set忙(名字)
        const r = await post(路径, 体 || {})
        set忙('')
        if (r && r.ok) {
          set状态((旧) => (旧 ? { ...旧, ...r } : r))
          set提示('做完了，看下面的记录')
        } else {
          set提示(r && r.说 ? r.说 : '没成功')
        }
      }

      const 起一件事 = async () => {
        const 念头 = 试任务.trim()
        if (!念头) return set提示('先写清想让它做什么')
        set忙('task')
        const r = await post('/task-start', { 念头 })
        set忙('')
        if (r && r.ok) {
          set试任务('')
          set任务摘要(r.摘要 || '')
          set提示('起了个头 —— 它应该会去问你要不要做')
        } else {
          set提示(r && r.说 ? r.说 : '没成')
        }
      }

      const 停一件事 = async () => {
        set忙('task')
        const r = await post('/task', { 动作: '取消' })
        set忙('')
        set任务摘要(r && r.摘要 ? r.摘要 : '手上没活儿')
        set提示(r && r.ok ? '叫停了' : (r && r.说) || '手上没有在办的事')
      }

      if (!状态) {
        return h('div', { style: S.wrap }, h('div', { style: S.h }, '它自己'),
          h('div', { style: S.dim }, 提示 || '正在读它的状态…'))
      }

      const 心 = 状态.内心 || {}
      const 配置 = 表单 || 状态.配置 || {}
      const 会话 = 状态.会话清单 || []
      const QQ = 状态.QQ状态 || {}
      const 手机 = 状态.手机状态

      return h('div', { style: S.wrap },
        h('div', { style: S.h }, '它自己'),
        h('div', { style: S.dim }, `v${状态.版本 || '?'} · 让它在没人叫的时候也会动：自己接话、主动找你、用 ADB 拿起手机。`),

        // ── 现在什么样 ──
        h('div', { style: { ...S.card, marginTop: 10 } },
          h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '现在'),
          h('div', { style: S.dim }, 状态.摘要 || '（还没有状态）'),
          h('div', { style: { marginTop: 8 } },
            进度({ 名: '精力', 值: 心.精力 || 0, 色: '#3d8bfd' }),
            进度({ 名: '无聊', 值: 心.无聊 || 0, 色: '#d98a00' }),
            进度({ 名: '想念', 值: 心.想念 || 0, 色: '#c0392b' }),
          ),
          h('div', { style: { ...S.dim, marginTop: 6 } },
            `今天：群里说了 ${心.今日 ? 心.今日.群发言 : 0} 次，找主人 ${心.今日 ? 心.今日.私聊主人 : 0} 次`,
            `｜免打扰 ${状态.免打扰 ? '中' : '否'}`,
            `｜QQ ${QQ.已连接 ? `✓ ${QQ.昵称 || ''}（${QQ.QQ号 || ''}）` : `✗ ${QQ.错 || '没连上'}`}`,
            手机 ? `｜手机 ${手机.在线 ? `✓ 电量 ${手机.电量 ?? '?'}%` : `✗ ${手机.错 || '没连上'}`}` : '',
          ),
          h('div', { style: { marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('button', { style: S.btn, disabled: 忙 === 'poke', onClick: () => 动作('/poke', {}, 'poke') },
              忙 === 'poke' ? '正在想…' : '立刻心跳一次'),
            h('button', { style: S.btn, disabled: 忙 === 'phone', onClick: () => 动作('/phone', { 动作: '设备' }, 'phone') }, '测手机连接'),
            h('button', { style: S.btn, disabled: 忙 === 'reset', onClick: () => 动作('/reset-mind', {}, 'reset') }, '重置内心'),
          ),
        ),

        // ── 开关 ──
        h('div', { style: S.h }, '开关'),
        开关({ 标签: '总开关', 说明: '关着 = 心跳照走，但一句都不会真的发出去', 值: 配置.总开关, onChange: (v) => 改('总开关', v) }),
        开关({ 标签: '试运行', 说明: '开着只记账（「本来想做什么」），不真发', 值: 配置.试运行, onChange: (v) => 改('试运行', v) }),

        // ── 脑子 ──
        h('div', { style: S.h }, '脑子'),
        字段({
          标签: '目标会话',
          说明: 字段说明.目标会话,
          孩子: h('select', {
            style: S.input,
            value: 配置.目标会话 || '',
            onChange: (e) => 改('目标会话', e.target.value),
          },
            h('option', { value: '' }, '（还没选）'),
            ...会话.map((s) => h('option', { key: s.id, value: s.id }, `${s.标题 || '（没有标题）'} · ${String(s.id).slice(-8)}`)),
          ),
        }),
        文本({ 标签: '它怎么叫那个人', 值: 配置.称呼, onChange: (v) => 改('称呼', v) }),
        数字({ 标签: '主动性', 说明: 字段说明.主动性, 值: 配置.主动性, onChange: (v) => 改('主动性', v) }),
        数字({ 标签: '心跳间隔（秒）', 说明: 字段说明.心跳秒, 值: 配置.心跳秒, onChange: (v) => 改('心跳秒', v) }),

        // ── QQ ──
        h('div', { style: S.h }, 'QQ'),
        文本({ 标签: 'QQ 后端地址', 说明: 'OneBot 11 HTTP，NapCat / SnowLuma 都行', 值: 配置.NapCat, onChange: (v) => 改('NapCat', v) }),
        文本({ 标签: '访问令牌', 说明: '后端设了 token 才填', 值: 配置.NapCat令牌, onChange: (v) => 改('NapCat令牌', v), 密码: true }),
        文本({ 标签: '主人 QQ', 值: 配置.主人QQ, onChange: (v) => 改('主人QQ', v) }),
        文本({ 标签: '话题词', 说明: 字段说明.话题词, 值: 配置.话题词, onChange: (v) => 改('话题词', v) }),
        开关({ 标签: '主人私聊直达', 说明: 字段说明.私聊直达, 值: 配置.私聊直达, onChange: (v) => 改('私聊直达', v) }),
        开关({ 标签: '群里被叫直达', 说明: 字段说明.群被叫直达, 值: 配置.群被叫直达, onChange: (v) => 改('群被叫直达', v) }),

        // ── 节奏 ──
        h('div', { style: S.h }, '节奏'),
        数字({ 标签: '插话冷却（分钟）', 说明: '刚在群里说过，这么久内不再主动插嘴', 值: 配置.插话冷却分, onChange: (v) => 改('插话冷却分', v) }),
        数字({ 标签: '找主人冷却（分钟）', 值: 配置.找主人冷却分, onChange: (v) => 改('找主人冷却分', v) }),
        数字({ 标签: '每天最多找主人（次）', 值: 配置.每天最多找主人, onChange: (v) => 改('每天最多找主人', v) }),
        字段({
          标签: '免打扰',
          说明: 字段说明.免打扰开始,
          孩子: h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('input', { type: 'time', style: { ...S.small, width: 120 }, value: 配置.免打扰开始, onChange: (e) => 改('免打扰开始', e.target.value) }),
            h('span', { style: S.dim }, '→'),
            h('input', { type: 'time', style: { ...S.small, width: 120 }, value: 配置.免打扰结束, onChange: (e) => 改('免打扰结束', e.target.value) }),
          ),
        }),

        // ── 群聊：从 QQ 拉列表来勾，不手抄群号 ──
        h('div', { style: S.h }, '群聊'),
        h('div', { style: { ...S.card, padding: '8px 10px' } },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 } },
            h('button', {
              style: S.btn,
              disabled: 忙 === 'groups',
              onClick: async () => {
                set忙('groups')
                const r = await post('/groups', {})
                set忙('')
                if (r && r.ok) {
                  set群们(r.群们 || [])
                  set群缓存(r.缓存 || '')
                  set提示(`拉到 ${r.数量 || (r.群们 || []).length} 个群`)
                } else {
                  set群们((r && r.群们) || [])
                  set群缓存((r && r.缓存) || '')
                  set提示((r && r.说) || '拉取失败')
                }
              },
            }, 忙 === 'groups' ? '正在拉…' : '从 QQ 拉取我的群'),
            h('span', { style: S.dim }, 群们.length ? `共 ${群们.length} 个` : '还没拉过'),
          ),
          群们.length
            ? h('div', { style: { maxHeight: 220, overflow: 'auto' } },
                ...群们.map((g) => {
                  const 已选 = 群号表(配置.群号们).includes(String(g.群号))
                  return h('label', {
                    key: g.群号,
                    style: { display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', cursor: 'pointer' },
                  },
                    h('input', {
                      type: 'checkbox',
                      checked: 已选,
                      onChange: (e) => 改('群号们', 拼群号(群号表(配置.群号们), String(g.群号), e.target.checked)),
                    }),
                    h('span', { style: { flex: 1 } }, g.名称 || '（没有名字）'),
                    h('span', { style: S.dim }, g.群号, g.人数 ? ` · ${g.人数}人` : ''),
                  )
                }),
              )
            : h('div', { style: S.dim }, '点上面的按钮，会把你 QQ 加的群拉下来存成文件，然后在这里勾。'),
          群缓存 ? h('div', { ...S.hint, marginTop: 6 }, `群列表文件：${群缓存}`) : null,
        ),
        文本({ 标签: '或者手动填群号', 说明: '逗号/空格分隔；上面勾选会自动写进这里', 值: 配置.群号们, onChange: (v) => 改('群号们', v) }),

        // ── 身体 ──
        h('div', { style: S.h }, '身体（小手机）'),
        开关({ 标签: '允许玩手机', 说明: '用 adb 操作一台连着电脑的安卓机', 值: 配置.允许玩手机, onChange: (v) => 改('允许玩手机', v) }),
        文本({ 标签: 'adb 路径', 说明: '留 adb 就用 PATH 里的；也可以填完整路径', 值: 配置.ADB路径, onChange: (v) => 改('ADB路径', v) }),
        文本({ 标签: '设备序列号', 说明: '只连一台就留空', 值: 配置.手机序列号, onChange: (v) => 改('手机序列号', v) }),
        数字({ 标签: '玩手机冷却（分钟）', 值: 配置.玩手机冷却分, onChange: (v) => 改('玩手机冷却分', v) }),
        开关({ 标签: '刷完想跟主人说', 说明: 字段说明.玩手机后汇报, 值: 配置.玩手机后汇报, onChange: (v) => 改('玩手机后汇报', v) }),

        // ── 办事 ──
        h('div', { style: S.h }, '办事（能跑几分钟的事）'),
        开关({ 标签: '允许办事', 说明: 字段说明.允许办事, 值: 配置.允许办事, onChange: (v) => 改('允许办事', v) }),
        数字({ 标签: '单笔预算上限（块）', 说明: 字段说明.单笔预算上限, 值: 配置.单笔预算上限, onChange: (v) => 改('单笔预算上限', v) }),
        数字({ 标签: '每天最多办几件', 说明: 字段说明.每天最多办事, 值: 配置.每天最多办事, onChange: (v) => 改('每天最多办事', v) }),
        开关({ 标签: '下单前要我再点头', 说明: 字段说明.办事要确认, 值: 配置.办事要确认, onChange: (v) => 改('办事要确认', v) }),

        // 手上那件事
        h('div', { style: { ...S.row, alignItems: 'flex-start' } },
          h('div', { style: S.lab }, '它手上现在的事',
            h('div', { style: S.hint }, '试操作用：手动给它起一件事，看它会不会来问你'),
          ),
          h('div', { style: { ...S.ctl, display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { style: { ...S.dim, fontSize: 12, minHeight: 18 } }, 任务摘要 || '手上没活儿'),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('input', {
                style: { ...S.input, flex: '1 1 200px' },
                placeholder: '比如：想买个玩偶',
                value: 试任务,
                onChange: (e) => set试任务(e.target.value),
              }),
              h('button', { style: S.btn, onClick: 起一件事 }, '让它去做'),
              h('button', { style: S.btn, onClick: 停一件事 }, '叫停'),
            ),
          ),
        ),

        // ── 人格 ──
        h('div', { style: S.h }, '人格补充'),
        字段({
          标签: '追加到提示词末尾',
          说明: 字段说明.人格补充,
          孩子: h('textarea', {
            style: { ...S.input, minHeight: 90, resize: 'vertical', fontFamily: 'inherit' },
            value: 配置.人格补充 || '',
            onChange: (e) => 改('人格补充', e.target.value),
          }),
        }),

        // ── 手动试一句 ──
        h('div', { style: S.h }, '手动让它说一句'),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('input', {
            style: { ...S.input, flex: '1 1 260px' },
            placeholder: '要发的话（真发，绕过试运行）',
            value: 试说,
            onChange: (e) => set试说(e.target.value),
          }),
          h('button', {
            style: S.btn,
            disabled: !试说.trim() || 忙 === 'say',
            onClick: async () => {
              set忙('say')
              const r = await post('/say', { 话: 试说.trim(), 去哪: '群' })
              set忙('')
              set提示(r && r.ok ? '发出去了' : (r && r.说) || '没发出去')
              if (r && r.ok) set试说('')
            },
          }, 忙 === 'say' ? '发送中…' : '发到群里'),
        ),

        // ── 记录 ──
        h('div', { style: S.h }, '最近在想什么'),
        h('div', { style: S.card },
          h('div', { style: S.log },
            (状态.日志 || []).slice().reverse().map((x, i) => h('div', { key: i }, `${x.时间}  ${x.文本}`)),
          ),
        ),

        // ── 保存条 ──
        h('div', { style: S.保存条 },
          h('button', {
            style: { ...S.btn, borderColor: 脏 ? '#c0392b' : undefined, fontWeight: 脏 ? 600 : 400 },
            disabled: 忙 === 'save',
            onClick: 保存,
          }, 忙 === 'save' ? '保存中…' : (脏 ? '保存（有改动）' : '保存')),
          提示 ? h('span', { style: 提示.includes('好') || 提示.includes('发出去') || 提示.includes('做完') ? S.ok : S.bad }, 提示) : null,
          h('span', { style: S.dim }, 脏 ? '有改动还没保存' : '已同步'),
        ),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'qq-agency', order: 56, label: () => '它自己' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
