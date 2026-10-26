// dsh-memory-db — Client half (static / composition plugin)
//
// Browser bundle consumed by the client module loader (window.__ModuleLoader__).
// Talks to the Host through the plugin's own JSON API on the webServer route
// (POST /dsh-memory-db/api) via fetch — no settingsScope allowlist, no typert.
window.__ModuleLoader__.load({
  id: 'dsh-memory-db',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    let react = require('react');

    // ── plugin-owned JSON RPC over the host webServer route ──
    function rpc(method, args) {
      return fetch('/dsh-memory-db/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: method, args: args || {} }),
      }).then((r) => r.json()).catch((e) => ({ ok: false, reason: String(e && e.message !== undefined ? e.message : e) }));
    }

    function apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    const chipStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '3px 10px',
      borderRadius: 999,
      border: '1px solid var(--dsw-alias-divider, rgba(128,128,128,0.35))',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary, #8a8a8a)',
      fontSize: 12,
      lineHeight: '18px',
      cursor: 'pointer',
      fontFamily: 'inherit',
      whiteSpace: 'nowrap',
    }
    const menuItemStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      padding: '6px 10px',
      border: 'none',
      borderRadius: 6,
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: 13,
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-primary, #222)',
      textAlign: 'center',
      whiteSpace: 'nowrap',
    }

    // ── 设置行的原生外观 ──
    // 与产品「通用设置」里的行逐值对齐（实测：行 padding 16px 0 + 底部 1px 分隔线、
    // 文本列 gap 4 + 右侧留 48px、标题 14/22/400、说明 12/18 且用 label-tertiary）。
    const ROW = { display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))', width: '100%' }
    const ROW_TEXT = { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 auto', minWidth: 0, paddingRight: 48 }
    const ROW_TITLE = { fontSize: 14, lineHeight: '22px', fontWeight: 400, color: 'var(--dsw-alias-label-primary, #222)' }
    const ROW_DESC = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #999)' }

    slots.inject('conversation.session.header.utilities', () => slots.register(
      { name: 'conversation.session.header.utilities', id: 'memory-db-toggle', order: 20 },
      (props) => {
        const [state, setState] = react.useState(null)
        const [busy, setBusy] = react.useState(false)
        const [error, setError] = react.useState(null)
        const [menuOpen, setMenuOpen] = react.useState(false)
        const [menuHover, setMenuHover] = react.useState(false)
        const [panel, setPanel] = react.useState(null)
        const [purposeBusy, setPurposeBusy] = react.useState(false)
        const wrapRef = react.useRef(null)
        const menuRef = react.useRef(null)
        const bubbleRef = react.useRef(null)
        const followRef = react.useRef(true)
        react.useEffect(() => {
          let alive = true
          let retry = null
          setState(null)
          setError(null)
          // 启动初期会话可能尚未在 host 注册(workspaceId 为空),此时持续重试直到就绪
          const load = () => {
            rpc('state', { sessionId: props.sessionId }).then((r) => {
              if (!alive || !r || r.ok !== true) return
              setState(r)
              if (!r.workspaceId) retry = setTimeout(load, 2000)
            }).catch((e) => {
              console.error('[memory-db] state read failed', e)
              if (alive) { setError('状态读取失败'); retry = setTimeout(load, 2000) }
            })
          }
          load()
          return () => { alive = false; if (retry) clearTimeout(retry) }
        }, [props.sessionId])
        react.useEffect(() => {
          if (!menuOpen) return
          let alive = true
          setPanel(null)
          const load = () => {
            rpc('panel-state', { sessionId: props.sessionId }).then((r) => {
              if (!alive || !r || r.ok !== true) return
              // 仅在数据真正变化时更新，避免每 500ms 无谓重渲染
              setPanel(function (prev) {
                try {
                  if (prev && JSON.stringify(prev) === JSON.stringify(r)) return prev
                } catch { /* ignore */ }
                return r
              })
            }).catch((e) => { console.error('[memory-db] panel-state failed', e) })
          }
          load()
          const timer = setInterval(load, 500)
          return () => { alive = false; clearInterval(timer) }
        }, [menuOpen, props.sessionId])
        // 气泡区跟随最新：打开面板或在底部时自动滚到底部（用户手动上滚则不打扰）
        react.useEffect(() => {
          if (!menuOpen) return
          followRef.current = true
          const el = bubbleRef.current
          if (el) el.scrollTop = el.scrollHeight
        }, [menuOpen])
        react.useEffect(() => {
          if (!followRef.current) return
          const el = bubbleRef.current
          if (el) el.scrollTop = el.scrollHeight
        }, [panel])
        if (state === null) return null
        const enabled = state.enabled === true
        const purpose = panel ? panel.purposeMode === true : null
        // 会话刚启动时 state 可能先拿到 workspaceId=null；用面板数据兜底
        const wsId = state.workspaceId || (panel && panel.workspaceId) || null
        const scope = wsId ? (state.title || (panel && panel.title) || '当前项目') : '全局默认'
        const flip = () => {
          if (busy || !wsId) return
          setBusy(true)
          setError(null)
          rpc('set-enabled', { workspaceId: wsId, enabled: !enabled }).then((r) => {
            if (r && r.ok === true) {
              setState({ ...state, enabled: r.enabled })
            } else {
              setError((r && r.reason) || '写入失败')
              console.error('[memory-db] set-enabled rejected: ' + ((r && r.reason) || 'unknown'))
            }
          }).catch((e) => {
            setError('写入失败')
            console.error('[memory-db] set-enabled failed', e)
          }).then(() => setBusy(false))
        }
        const openAdmin = () => {
          rpc('open-admin', {}).then((r) => {
            if (!r || r.ok !== true) {
              console.error('[memory-db] open-admin failed: ' + ((r && r.reason) || 'unknown'))
            }
          }).catch((e) => {
            console.error('[memory-db] open-admin failed', e)
          })
        }
        const flipPurpose = () => {
          if (purposeBusy || purpose === null || !wsId) return
          setPurposeBusy(true)
          rpc('set-purpose', { workspaceId: wsId, enabled: !purpose }).then((r) => {
            if (r && r.ok === true) setPanel(function (p) { return p ? Object.assign({}, p, { purposeMode: r.purposeMode === true }) : p })
            else console.error('[memory-db] set-purpose rejected: ' + ((r && r.reason) || 'unknown'))
          }).catch((e) => {
            console.error('[memory-db] set-purpose failed', e)
          }).then(() => setPurposeBusy(false))
        }
        const dotColor = error ? 'var(--dsw-alias-state-error-primary, #d92d20)' : (enabled ? 'var(--dsw-static-deepseek-500, #4d6bfe)' : 'var(--dsw-alias-label-caption, #9a9a9a)')
        const pill = function (on) {
          return {
            ...chipStyle,
            flexShrink: 0,
            minWidth: 44,
            justifyContent: 'center',
            padding: '2px 12px',
            background: on ? 'var(--dsw-static-deepseek-500, #4d6bfe)' : 'transparent',
            color: on ? '#fff' : 'var(--dsw-alias-label-secondary, #8a8a8a)',
            borderColor: on ? 'transparent' : 'var(--dsw-alias-divider, rgba(128,128,128,0.35))',
          }
        }
        const fmtBytes = function (n) {
          if (n === undefined || n === null) return '—'
          if (n < 1024) return n + ' B'
          if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
          return (n / 1048576).toFixed(2) + ' MB'
        }
        const title = error
          ? '项目记忆库（' + scope + '）：' + error + '——点击重试'
          : '项目记忆库（' + scope + '）：当前' + (enabled ? '开' : '关') + '，点击切换。开启后自动收集该项目问答对话，并在每个任务前检索注入相关历史记忆。'
        return react.createElement('div', {
          key: 'wrap',
          ref: wrapRef,
          style: { position: 'relative', display: 'inline-flex' },
        }, [
          react.createElement('button', {
            key: 'chip',
            onClick: function () { setMenuOpen(!menuOpen) },
            disabled: busy,
            title: title,
            style: { ...chipStyle, background: menuOpen ? 'var(--dsw-alias-fill-secondary, #f0f2f5)' : 'transparent' },
          }, [
            react.createElement('span', { key: 'd', style: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flex: 'none', background: dotColor } }),
            react.createElement('span', { key: 't' }, error ? '写入失败' : ('记忆库 ' + (enabled ? '开' : '关'))),
          ]),
          menuOpen ? react.createElement('div', {
            key: 'menu',
            ref: menuRef,
            style: {
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              zIndex: 200,
              width: 300,
              background: '#fff',
              border: '1px solid var(--dsw-alias-divider, rgba(128,128,128,0.35))',
              borderRadius: 10,
              boxShadow: '0 6px 24px rgba(0,0,0,0.14)',
              overflow: 'hidden',
            },
          }, [
            react.createElement('div', {
              key: 'head',
              style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--dsw-alias-divider, rgba(128,128,128,0.2))' },
            }, [
              react.createElement('span', { key: 't', style: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #222)' } }, '记忆库'),
              react.createElement('button', {
                key: 'c',
                onClick: function () { setMenuOpen(false) },
                style: { ...chipStyle, padding: '2px 10px', fontSize: 11 },
              }, '关闭'),
            ]),
            react.createElement('div', {
              key: 'body',
              style: { padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 },
            }, [
              react.createElement('div', { key: 'r1', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } }, [
                react.createElement('span', { key: 'l', style: { fontSize: 13, color: 'var(--dsw-alias-label-primary, #222)' } }, '记忆库（' + scope + '）'),
                react.createElement('button', { key: 's', onClick: flip, disabled: busy, style: pill(enabled) }, busy ? '…' : (enabled ? '开' : '关')),
              ]),
              (wsId) ? react.createElement('div', { key: 'r2', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } }, [
                react.createElement('span', { key: 'l', title: '工况判定（本项目）：开启后每轮判定用户目的（闲聊陪伴/执行任务）并注入对应提示词；角色扮演等项目可关闭。', style: { fontSize: 13, color: 'var(--dsw-alias-label-primary, #222)', cursor: 'default' } }, '工况判定'),
                react.createElement('button', { key: 's', onClick: flipPurpose, disabled: purposeBusy || purpose === null, title: '工况判定（本项目）：' + (purpose ? '开' : '关'), style: pill(purpose) }, purpose === null ? '…' : (purpose ? '开' : '关')),
              ]) : null,
              react.createElement('div', { key: 'r3' }, [
                react.createElement('span', {
                  key: 'link',
                  onClick: openAdmin,
                  style: { fontSize: 13, color: 'var(--dsw-static-deepseek-500, #4d6bfe)', cursor: 'pointer' },
                }, '记忆管理 →'),
              ]),
              react.createElement('div', {
                key: 'sep',
                style: { borderTop: '1px solid var(--dsw-alias-divider, rgba(128,128,128,0.2))', margin: '2px 0' },
              }),
              react.createElement('div', {
                key: 'info',
                style: { fontSize: 12, lineHeight: '19px', color: 'var(--dsw-alias-label-secondary, #8a8a8a)' },
              }, panel ? [
                react.createElement('div', { key: 'i1' }, '记录条数: ' + panel.count + ' 条 · 数据: ' + fmtBytes(panel.dbBytes)),
                react.createElement('div', {
                  key: 'bubbles',
                  ref: bubbleRef,
                  onScroll: function (e) {
                    const el = e.currentTarget
                    followRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 48
                  },
                  style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 190, overflowY: 'auto', margin: '6px 0', paddingTop: 6, borderTop: '1px dashed var(--dsw-alias-divider, rgba(128,128,128,0.25))' },
                }, (panel.verdicts && panel.verdicts.length > 0) ? panel.verdicts.map(function (v, i) {
                  return react.createElement('div', { key: i, style: { display: 'flex', flexDirection: 'column', gap: 3 } }, [
                    react.createElement('div', {
                      key: 'q',
                      style: { alignSelf: 'flex-end', maxWidth: '88%', background: 'var(--dsw-static-deepseek-500, #4d6bfe)', color: '#fff', padding: '4px 10px', borderRadius: '10px 10px 2px 10px', fontSize: 12, lineHeight: '17px', wordBreak: 'break-all' },
                    }, String(v.q)),
                    react.createElement('div', {
                      key: 'a',
                      title: '通道: ' + (v.channel || '-'),
                      style: { alignSelf: 'flex-start', maxWidth: '94%', background: 'var(--dsw-alias-fill-secondary, #f0f2f5)', color: 'var(--dsw-alias-label-primary, #333)', padding: '4px 10px', borderRadius: '10px 10px 10px 2px', fontSize: 12, lineHeight: '17px', wordBreak: 'break-all' },
                    }, '【工况】' + (v.purpose === 'chat' ? '闲聊陪伴' : '执行任务') + '　【记忆】' + (v.intent === 'continue' ? '延续·不注入' : v.intent === 'recall' ? '回忆·强制注入' : '转向·注入') + (v.keywords && v.keywords.length > 0 ? '　【关键词】' + v.keywords.join('、') : '')),
                    (v.input || v.raw) ? react.createElement('details', {
                      key: 'dbg',
                      style: { alignSelf: 'flex-start', maxWidth: '94%', fontSize: 11, color: 'var(--dsw-alias-label-secondary, #8a8a8a)' },
                    }, [
                      react.createElement('summary', { key: 's', style: { cursor: 'pointer', userSelect: 'none' } }, '查看分类器输入'),
                      v.input ? react.createElement('div', {
                        key: 'in',
                        style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflowY: 'auto', background: 'var(--dsw-alias-fill-tertiary, #f7f8fa)', border: '1px solid var(--dsw-alias-divider, rgba(128,128,128,0.2))', borderRadius: 6, padding: '6px 8px', marginTop: 4, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-primary, #333)' },
                      }, v.input) : null,
                      v.raw ? react.createElement('div', {
                        key: 'out',
                        style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 100, overflowY: 'auto', background: 'var(--dsw-alias-fill-tertiary, #f7f8fa)', border: '1px solid var(--dsw-alias-divider, rgba(128,128,128,0.2))', borderRadius: 6, padding: '6px 8px', marginTop: 4, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-primary, #333)' },
                      }, '模型原始输出：\n' + v.raw) : null,
                    ]) : null,
                  ])
                }) : [
                  react.createElement('div', { key: 'empty', style: { color: 'var(--dsw-alias-label-caption, #b0b0b0)' } }, '暂无判定记录——发一条消息后，分类器的判定过程会显示在这里'),
                ]),
                react.createElement('div', { key: 'i3' }, '注入 ' + (panel.injections || 0) + ' 次 · 检索: ' + (panel.engine || '未知') + ' · 分类: ' + (panel.classifierMode === 'subagent' ? '子代理' : '内联')),
              ] : [
                react.createElement('div', { key: 'loading' }, '加载中…'),
              ]),
            ]),
          ]) : null,
        ])
      },
    ))

    slots.inject('settings.general.item', () => slots.register(
      { name: 'settings.general.item', id: 'memory-db-default', order: 40 },
      () => {
        const [enabled, setEnabled] = react.useState(null)
        const [busy, setBusy] = react.useState(false)
        const [error, setError] = react.useState(null)
        react.useEffect(() => {
          let alive = true
          rpc('get-default', {}).then((r) => {
            if (alive && r && r.ok === true) setEnabled(r.enabled === true)
          }).catch((e) => {
            console.error('[memory-db] get-default failed', e)
            if (alive) setError('读取失败')
          })
          return () => { alive = false }
        }, [])
        const flip = () => {
          if (busy || enabled === null) return
          setBusy(true)
          setError(null)
          rpc('set-default', { enabled: !enabled }).then((r) => {
            if (r && r.ok === true) {
              setEnabled(r.enabled === true)
            } else {
              setError((r && r.reason) || '写入失败')
              console.error('[memory-db] set-default rejected: ' + ((r && r.reason) || 'unknown'))
            }
          }).catch((e) => {
            setError('写入失败')
            console.error('[memory-db] set-default failed', e)
          }).then(() => setBusy(false))
        }
        return react.createElement('div', { style: ROW }, [
          react.createElement('div', { key: 'l', style: ROW_TEXT }, [
            react.createElement('span', { key: 't', style: ROW_TITLE }, '项目记忆库'),
            react.createElement('span', { key: 'd', style: error ? { ...ROW_DESC, color: 'var(--dsw-alias-state-error-primary, #d92d20)' } : ROW_DESC }, error ? (error + '——点击重试') : '自动收集项目问答对话并检索注入历史记忆（默认值；各项目可在会话顶部单独切换）'),
          ]),
          react.createElement('button', {
            key: 'b',
            onClick: flip,
            disabled: busy || enabled === null,
            title: error ? error : undefined,
            style: { ...chipStyle, flexShrink: 0, minWidth: 56, justifyContent: 'center', background: enabled ? 'var(--dsw-static-deepseek-500, #4d6bfe)' : 'transparent', color: enabled ? '#fff' : 'var(--dsw-alias-label-secondary, #8a8a8a)' },
          }, enabled === null ? '…' : (enabled ? '开' : '关')),
        ])
      },
    ))
  }

  exports.apply = apply;
  exports.inject = ['slots'];
  return module.exports;
  }
});
