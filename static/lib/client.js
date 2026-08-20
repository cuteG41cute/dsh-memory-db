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

    slots.inject('conversation.session.header.utilities', () => slots.register(
      { name: 'conversation.session.header.utilities', id: 'memory-db-toggle', order: 20 },
      (props) => {
        const [state, setState] = react.useState(null)
        const [busy, setBusy] = react.useState(false)
        const [error, setError] = react.useState(null)
        const [menuOpen, setMenuOpen] = react.useState(false)
        const [menuHover, setMenuHover] = react.useState(false)
        const wrapRef = react.useRef(null)
        const menuRef = react.useRef(null)
        const openMenu = () => { setMenuOpen(true) }
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
        if (state === null) return null
        const enabled = state.enabled === true
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
          setMenuOpen(false)
          rpc('open-admin', {}).then((r) => {
            if (!r || r.ok !== true) {
              console.error('[memory-db] open-admin failed: ' + ((r && r.reason) || 'unknown'))
            }
          }).catch((e) => {
            console.error('[memory-db] open-admin failed', e)
          })
        }
        const dotColor = error ? 'var(--dsw-alias-state-error-primary, #d92d20)' : (enabled ? 'var(--dsw-static-deepseek-500, #4d6bfe)' : 'var(--dsw-alias-label-caption, #9a9a9a)')
        const title = error
          ? '项目记忆库（' + scope + '）：' + error + '——点击重试'
          : '项目记忆库（' + scope + '）：当前' + (enabled ? '开' : '关') + '，点击切换。开启后自动收集该项目问答对话，并在每个任务前检索注入相关历史记忆。'
        return react.createElement('div', {
          key: 'wrap',
          ref: wrapRef,
          style: { position: 'relative', display: 'inline-flex' },
          onMouseEnter: openMenu,
        }, [
          react.createElement('button', {
            key: 'chip',
            onClick: flip,
            disabled: busy,
            title: title,
            style: chipStyle,
          }, [
            react.createElement('span', { key: 'd', style: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flex: 'none', background: dotColor } }),
            react.createElement('span', { key: 't' }, error ? '写入失败' : ('记忆库 ' + (enabled ? '开' : '关'))),
          ]),
          menuOpen ? react.createElement('div', {
            key: 'menu',
            ref: menuRef,
            style: {
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 200,
              background: '#fff',
              border: '1px solid var(--dsw-alias-divider, rgba(128,128,128,0.35))',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              padding: 4,
              display: 'flex',
              flexDirection: 'column',
            },
          }, [
            react.createElement('button', {
              key: 'admin',
              onClick: openAdmin,
              onMouseEnter: function () { setMenuHover(true) },
              onMouseLeave: function () { setMenuHover(false) },
              style: {
                ...menuItemStyle,
                background: menuHover ? 'var(--dsw-alias-fill-secondary, #f0f2f5)' : 'transparent',
              },
            }, [
              react.createElement('span', { key: 't' }, '记忆管理'),
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
        return react.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, width: '100%' } }, [
          react.createElement('div', { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } }, [
            react.createElement('span', { key: 't', style: { fontSize: 14, lineHeight: '20px', color: 'var(--dsw-alias-label-primary, #222)' } }, '项目记忆库'),
            react.createElement('span', { key: 'd', style: { fontSize: 12, lineHeight: '16px', color: error ? 'var(--dsw-alias-state-error-primary, #d92d20)' : 'var(--dsw-alias-label-tertiary, #999)' } }, error ? (error + '——点击重试') : '自动收集项目问答对话并检索注入历史记忆（默认值；各项目可在会话顶部单独切换）'),
          ]),
          react.createElement('button', {
            key: 'b',
            onClick: flip,
            disabled: busy || enabled === null,
            title: error ? error : undefined,
            style: { ...chipStyle, minWidth: 56, justifyContent: 'center', background: enabled ? 'var(--dsw-static-deepseek-500, #4d6bfe)' : 'transparent', color: enabled ? '#fff' : 'var(--dsw-alias-label-secondary, #8a8a8a)' },
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
