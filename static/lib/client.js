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
        react.useEffect(() => {
          const onMove = function (e) {
            const wrap = wrapRef.current
            if (!wrap) return
            const pad = 3
            const wr = wrap.getBoundingClientRect()
            let inside = e.clientX >= wr.left - pad && e.clientX <= wr.right + pad &&
              e.clientY >= wr.top - pad && e.clientY <= wr.bottom + pad
            if (!inside) {
              const menu = menuRef.current
              if (menu) {
                const mr = menu.getBoundingClientRect()
                inside = e.clientX >= mr.left - pad && e.clientX <= mr.right + pad &&
                  e.clientY >= mr.top - pad && e.clientY <= mr.bottom + pad
              }
            }
            if (!inside) {
              setMenuOpen(false)
              setMenuHover(false)
            }
          }
          document.addEventListener('mousemove', onMove)
          return function () { document.removeEventListener('mousemove', onMove) }
        }, [])
        react.useEffect(() => {
          let alive = true
          setState(null)
          setError(null)
          rpc('state', { sessionId: props.sessionId }).then((r) => {
            if (alive && r && r.ok === true) setState(r)
          }).catch((e) => {
            console.error('[memory-db] state read failed', e)
            if (alive) setError('状态读取失败')
          })
          return () => { alive = false }
        }, [props.sessionId])
        react.useEffect(() => {
          if (!menuOpen) return
          let alive = true
          setPanel(null)
          rpc('panel-state', { sessionId: props.sessionId }).then((r) => {
            if (alive && r && r.ok === true) setPanel(r)
          }).catch((e) => { console.error('[memory-db] panel-state failed', e) })
          return () => { alive = false }
        }, [menuOpen, props.sessionId])
        if (state === null) return null
        const enabled = state.enabled === true
        const purpose = panel ? panel.purposeMode === true : null
        const scope = state.workspaceId ? (state.title || '当前项目') : '全局默认'
        const flip = () => {
          if (busy) return
          setBusy(true)
          setError(null)
          rpc('set-enabled', { workspaceId: state.workspaceId, enabled: !enabled }).then((r) => {
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
          if (purposeBusy || purpose === null || !state.workspaceId) return
          setPurposeBusy(true)
          rpc('set-purpose', { workspaceId: state.workspaceId, enabled: !purpose }).then((r) => {
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
              (state.workspaceId) ? react.createElement('div', { key: 'r2', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } }, [
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
                react.createElement('div', { key: 'i2' }, '最近判定: ' + (panel.lastDecision ? (panel.lastDecision + ' · ' + (panel.lastChannel || '-')) : '暂无')),
                react.createElement('div', { key: 'i3' }, '注入 ' + (panel.injections || 0) + ' 次 · 检索: ' + (panel.engine || '未知')),
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
