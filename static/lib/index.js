// dsh-memory-db — Host half (static / composition plugin)
//
// A regular DSH plugin loaded from the composition (cordis.patch.yml row), so
// it survives process restarts — unlike the dynamic form in ../plugin.
//
// Responsibilities:
//  1. settings.register('memory-db') namespace (persisted in settings.yaml)
//     holding the global default and per-workspace overrides; legacy switches
//     (storageDomain 'memory_db' table + per-project config.json) are read as
//     fallback so existing state survives the migration.
//  2. agent/pre-step: three-state classifier (recall/continue/shift) via a
//     resident continuable subagent (B) with inline fallback (A), keyword
//     search, budgeted memory injection, byte-identical dedupe, and dynamic
//     history compaction on injection rounds only.
//  3. Session/event collection of question/answer pairs + title evolution.
//  4. webServer routes: POST /dsh-memory-db/api (client JSON API, replacing
//     the dynamic-plugin harness.handle channel) and /memory-db-admin
//     (management page).
//  5. tools.register: memory_search / memory_admin.
import { Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'

export const SETTINGS_NS = 'memory-db'
/** Source plugin name stamped into injected messages. */
export const PLUGIN = 'memory-db'
/** Exact webServer route serving the client JSON API. */
export const ROUTE_PATH = '/dsh-memory-db/api'

/** Settings namespace schema: global default + per-workspace overrides. */
// 注意:不设 default —— 未写入时 defaultEnabled 为 undefined,用于区分"未初始化"
// (此时回退旧 storageDomain/config.json 开关)与"显式设置过"
export const memoryDbSettingsSchema = s.object({
  defaultEnabled: s.boolean(),
  projects: s.dict(s.boolean()),
})


// ============================================================================
// 管理网页 HTML(标题演变面板优雅化:初始标题 + 于时间变更为)
// ============================================================================
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>记忆库管理</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif; background: #f5f6f8; color: #222; }
header { background: #fff; border-bottom: 1px solid #e3e6ea; padding: 14px 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
h1 { font-size: 18px; font-weight: 600; }
.stats { display: flex; gap: 18px; font-size: 13px; color: #555; }
.stats b { color: #4d6bfe; font-size: 15px; margin-right: 4px; }
main { padding: 16px 20px; max-width: 1280px; margin: 0 auto; }
.toolbar { background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 12px 14px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.toolbar label { font-size: 13px; color: #666; }
select, input, textarea, button { font: inherit; }
select, input[type=text], input[type=datetime-local] { padding: 6px 10px; border: 1px solid #d4d8de; border-radius: 6px; background: #fff; font-size: 13px; }
button { padding: 6px 14px; border: 1px solid #d4d8de; border-radius: 6px; background: #fff; cursor: pointer; font-size: 13px; }
button:hover { border-color: #4d6bfe; color: #4d6bfe; }
button.primary { background: #4d6bfe; border-color: #4d6bfe; color: #fff; }
button.primary:hover { background: #3d5bf0; color: #fff; }
button.danger { color: #d92d20; border-color: #eaa7a2; }
button.danger:hover { background: #fef3f2; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.q { flex: 1; min-width: 220px; }
.panel { background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; overflow: hidden; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #eef0f3; vertical-align: top; }
th { background: #fafbfc; color: #666; font-weight: 600; white-space: nowrap; }
td.time { white-space: nowrap; color: #888; font-size: 12px; }
td.proj { white-space: nowrap; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; background: #eef1ff; color: #4d6bfe; }
.badge.off { background: #f0f1f3; color: #888; }
.cell { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell:hover { white-space: normal; overflow: visible; background: #fafbfc; }
.empty { padding: 40px; text-align: center; color: #999; }
.pager { display: flex; gap: 8px; align-items: center; justify-content: center; padding: 10px; font-size: 13px; color: #666; }
.bulk { display: flex; gap: 10px; align-items: center; padding: 8px 12px; font-size: 13px; color: #555; }
.dialog-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: none; align-items: center; justify-content: center; z-index: 50; }
.dialog-mask.open { display: flex; }
.dialog { background: #fff; border-radius: 12px; width: 640px; max-width: 94vw; max-height: 88vh; overflow: auto; padding: 18px 20px; }
.dialog h3 { font-size: 16px; margin-bottom: 12px; }
.dialog label { display: block; font-size: 13px; color: #555; margin: 10px 0 4px; }
.dialog textarea { width: 100%; min-height: 72px; padding: 8px 10px; border: 1px solid #d4d8de; border-radius: 6px; resize: vertical; font-size: 13px; }
.dialog .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
.hint { font-size: 12px; color: #999; margin-top: 4px; }
.error { color: #d92d20; font-size: 13px; }
.ok { color: #12b76a; font-size: 13px; }
.msg { margin-left: auto; font-size: 13px; }
.project-card { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; background:#fff; border:1px solid #e3e6ea; border-radius:10px; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; color:#555; }
.project-card b { color: #222; }
.project-card .tag { color: #999; }
.title-item { margin: 8px 0; padding: 8px 10px; background: #fafbfc; border-radius: 8px; font-size: 13px; }
.title-item .cur { font-weight: 600; color: #222; }
.title-item .hist { color: #555; font-size: 12px; margin-top: 2px; line-height: 18px; }
.title-item .hist .t { color: #999; margin-right: 4px; }
</style>
</head>
<body>
<header>
  <h1>📚 记忆库管理</h1>
  <div class="stats" id="stats"></div>
  <span class="msg" id="msg"></span>
</header>
<main>
  <div class="project-card" id="projectCard"></div>
  <div class="toolbar">
    <label>项目</label>
    <select id="project"><option value="all">全部项目</option></select>
    <input class="q" type="text" id="q" placeholder="关键词模糊搜索(问题与回答)...">
    <label>时间从</label>
    <input type="datetime-local" id="from">
    <label>到</label>
    <input type="datetime-local" id="to">
    <button class="primary" id="searchBtn">搜索</button>
    <button id="resetBtn">重置</button>
    <button id="exportBtn">导出筛选结果</button>
    <button id="addBtn">添加问答</button>
    <button id="importBtn">批量导入</button>
    <button id="dedupeBtn">去重</button>
    <button class="danger" id="clearBtn">清空项目</button>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th style="width:32px"><input type="checkbox" id="selAll"></th><th>时间</th><th>项目</th><th>会话</th><th>问题</th><th>回答</th><th style="width:70px">操作</th></tr></thead>
      <tbody id="tbody"></tbody>
    </table>
    <div class="empty" id="empty" style="display:none">暂无数据</div>
    <div class="bulk" id="bulk" style="display:none">
      <span id="selCount">已选 0 条</span>
      <button class="danger" id="bulkDelBtn">删除选中</button>
    </div>
    <div class="pager">
      <button id="prevBtn">上一页</button>
      <span id="pageInfo"></span>
      <button id="nextBtn">下一页</button>
    </div>
  </div>
  <div class="panel" id="titlePanel" style="margin-top:14px; display:none;">
    <div style="padding:10px 14px; font-weight:600; font-size:14px;">会话标题变更历史</div>
    <div id="titleList" style="padding:0 14px 12px;"></div>
  </div>
</main>

<div class="dialog-mask" id="addMask">
  <div class="dialog">
    <h3>添加问答对</h3>
    <label>项目 <span class="error">*</span></label>
    <select id="addProject" style="width:100%"></select>
    <label>问题 <span class="error">*</span></label>
    <textarea id="addQuestion" placeholder="用户提问内容"></textarea>
    <label>回答 <span class="error">*</span></label>
    <textarea id="addAnswer" placeholder="模型回答内容"></textarea>
    <label>时间 <span class="error">*</span></label>
    <input type="datetime-local" id="addTime" style="width:100%">
    <div class="hint">带 <span class="error">*</span> 的为必填项,全部填写后才能添加。</div>
    <div class="actions">
      <button id="addCancel">取消</button>
      <button class="primary" id="addConfirm" disabled>添加</button>
    </div>
  </div>
</div>

<div class="dialog-mask" id="importMask">
  <div class="dialog">
    <h3>批量导入问答对</h3>
    <label>目标项目(可选,数据自带 projectId/projectPath 时优先)</label>
    <select id="importProject" style="width:100%"><option value="">(由数据自带)</option></select>
    <label>数据(JSON 数组,或导出文件的 entries 字段)</label>
    <textarea id="importData" placeholder="[{ &quot;question&quot;: &quot;...&quot;, &quot;answer&quot;: &quot;...&quot;, &quot;time&quot;: 1710000000000, &quot;projectPath&quot;: &quot;C:\\projects\\a&quot; }]"></textarea>
    <div class="hint">每条必须含 question、answer、time(毫秒时间戳或 ISO 字符串)。可直接选择文件:</div>
    <input type="file" id="importFile" accept=".json,application/json">
    <div class="actions">
      <button id="importCancel">取消</button>
      <button class="primary" id="importConfirm">导入</button>
    </div>
  </div>
</div>

<script>
'use strict';
var API = '/memory-db-admin/api';
var state = { project: 'all', q: '', from: null, to: null, page: 1, pageSize: 20, total: 0, entries: [], projects: [] };

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtTime(ms) { if (!ms) return '-'; try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return String(ms); } }
function fmtTimeS(ms) { if (!ms) return '-'; var d = new Date(ms); var p = function (n) { return n < 10 ? '0' + n : '' + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
function msg(text, isErr) { var el = $('msg'); el.textContent = text; el.className = isErr ? 'error msg' : 'ok msg'; if (text) setTimeout(function () { el.textContent = ''; }, 4000); }
function setMsg(t, e) { msg(t, e); }

function qs() {
  var s = 'project=' + encodeURIComponent(state.project);
  if (state.q) s += '&q=' + encodeURIComponent(state.q);
  if (state.from) s += '&from=' + state.from;
  if (state.to) s += '&to=' + state.to;
  s += '&page=' + state.page + '&pageSize=' + state.pageSize;
  return s;
}

function loadProjects() {
  return fetch(API + '/projects').then(function (r) { return r.json(); }).then(function (d) {
    state.projects = d.projects || [];
    var sel = $('project');
    var cur = sel.value || 'all';
    sel.innerHTML = '<option value="all">全部项目</option>';
    state.projects.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.workspaceId;
      o.textContent = p.title + ' (' + p.count + ')';
      sel.appendChild(o);
    });
    sel.value = cur;
    var addSel = $('addProject');
    addSel.innerHTML = '';
    state.projects.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.workspaceId;
      o.textContent = p.title;
      addSel.appendChild(o);
    });
    var impSel = $('importProject');
    impSel.innerHTML = '<option value="">(由数据自带)</option>';
    state.projects.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.workspaceId;
      o.textContent = p.title;
      impSel.appendChild(o);
    });
    var total = state.projects.reduce(function (s, p) { return s + p.count; }, 0);
    var enabled = state.projects.filter(function (p) { return p.enabled; }).length;
    $('stats').innerHTML = '<span>项目 <b>' + state.projects.length + '</b></span><span>已开启 <b>' + enabled + '</b></span><span>记忆条目 <b>' + total + '</b></span>';
    renderProjectCard();
  });
}

function renderProjectCard() {
  var el = $('projectCard');
  if (state.project === 'all') {
    el.innerHTML = '选择一个项目查看详情;开关与清空仅对单个项目生效;标题变更历史在下方面板显示。';
    return;
  }
  var p = state.projects.find(function (x) { return x.workspaceId === state.project; });
  if (!p) { el.innerHTML = ''; return; }
  el.innerHTML = '<div><b>' + esc(p.title) + '</b> <span class="tag">' + esc(p.path) + '</span></div>' +
    '<div>状态: <span class="badge' + (p.enabled ? '' : ' off') + '">' + (p.enabled ? '已开启' : '已关闭') + '</span></div>' +
    '<div>条目 <b>' + p.count + '</b> 条</div>' +
    '<div>最早 ' + fmtTime(p.firstTime) + '<br>最新 ' + fmtTime(p.lastTime) + '</div>' +
    '<div class="tag">' + esc(p.dbFile) + '</div>' +
    '<button id="toggleProjBtn">' + (p.enabled ? '关闭该项目' : '开启该项目') + '</button>';
  var btn = $('toggleProjBtn');
  if (btn) btn.onclick = function () {
    fetch(API + '/project-toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: p.workspaceId, enabled: !p.enabled }) })
      .then(function (r) { return r.json(); }).then(function (d) {
        setMsg(d.ok ? '已' + (d.enabled ? '开启' : '关闭') + ' ' + p.title : d.reason, !d.ok);
        loadProjects().then(loadEntries);
      });
  };
}

function loadEntries() {
  return fetch(API + '/entries?' + qs()).then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) { setMsg(d.reason || '加载失败', true); return; }
    state.total = d.total;
    state.entries = d.entries || [];
    renderTable();
  }).catch(function (e) { setMsg('加载失败: ' + e, true); });
}

function renderTable() {
  var tbody = $('tbody');
  tbody.innerHTML = '';
  if (state.entries.length === 0) { $('empty').style.display = 'block'; } else { $('empty').style.display = 'none'; }
  state.entries.forEach(function (en) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="checkbox" class="sel" data-id="' + esc(en.id) + '" data-proj="' + esc(en.projectId) + '"></td>' +
      '<td class="time">' + fmtTime(en.time) + '</td>' +
      '<td class="proj"><span class="badge">' + esc(en.projectTitle || en.projectPath) + '</span></td>' +
      '<td><div class="cell" title="' + esc(en.sessionTitle || '') + '">' + (en.sessionTitle ? esc(en.sessionTitle) : '-') + '</div></td>' +
      '<td><div class="cell" title="' + esc(en.question) + '">' + esc(en.question) + '</div></td>' +
      '<td><div class="cell" title="' + esc(en.answer) + '">' + esc(en.answer) + '</div></td>' +
      '<td><button class="danger del" data-id="' + esc(en.id) + '" data-proj="' + esc(en.projectId) + '">删除</button></td>';
    tbody.appendChild(tr);
  });
  var pageCount = Math.max(1, Math.ceil(state.total / state.pageSize));
  $('pageInfo').textContent = '第 ' + state.page + ' / ' + pageCount + ' 页,共 ' + state.total + ' 条';
  $('prevBtn').disabled = state.page <= 1;
  $('nextBtn').disabled = state.page >= pageCount;
  $('selAll').checked = false;
  updateBulk();
  Array.prototype.forEach.call(document.querySelectorAll('.del'), function (b) {
    b.onclick = function () {
      var id = b.getAttribute('data-id');
      var proj = b.getAttribute('data-proj');
      if (!confirm('确定删除这条问答记录?')) return;
      fetch(API + '/entries', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deletes: [{ projectId: proj, id: id }] }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          setMsg(d.ok ? '已删除 ' + d.removed + ' 条' : d.reason, !d.ok);
          loadEntries();
        });
    };
  });
}

// 标题变更历史面板:优雅表达「会话 abc 于 时间 变更为 def」
function loadTitles() {
  if (state.project === 'all') { $('titlePanel').style.display = 'none'; return; }
  fetch(API + '/titles?project=' + encodeURIComponent(state.project)).then(function (r) { return r.json(); }).then(function (d) {
    var list = d && d.ok ? (d.titles || []) : [];
    var panel = $('titlePanel');
    var box = $('titleList');
    if (list.length === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    var html = '';
    list.forEach(function (t) {
      var hist = t.history || [];
      html += '<div class="title-item">';
      html += '<div class="cur">' + esc(t.sessionTitle || '(未命名)') + ' <span class="tag">' + esc(t.sessionId) + '</span></div>';
      if (hist.length > 1) {
        html += '<div class="hist"><span class="t">·</span>初始标题:「' + esc(hist[0].title) + '」</div>';
        for (var i = 1; i < hist.length; i++) {
          html += '<div class="hist"><span class="t">·</span>' + fmtTimeS(hist[i].at) + ' 变更为:「' + esc(hist[i].title) + '」</div>';
        }
      } else if (hist.length === 1) {
        html += '<div class="hist"><span class="t">·</span>标题: ' + esc(hist[0].title) + ' @ ' + fmtTimeS(hist[0].at) + '</div>';
      }
      html += '</div>';
    });
    box.innerHTML = html;
  }).catch(function (e) { $('titlePanel').style.display = 'none'; });
}

function updateBulk() {
  var sels = document.querySelectorAll('.sel:checked');
  $('bulk').style.display = sels.length ? 'flex' : 'none';
  $('selCount').textContent = '已选 ' + sels.length + ' 条';
}

function collectSelected() {
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll('.sel:checked'), function (c) {
    out.push({ projectId: c.getAttribute('data-proj'), id: c.getAttribute('data-id') });
  });
  return out;
}

$('searchBtn').onclick = function () {
  state.project = $('project').value;
  state.q = $('q').value.trim();
  var f = $('from').value, t = $('to').value;
  state.from = f ? new Date(f).getTime() : null;
  state.to = t ? new Date(t).getTime() : null;
  state.page = 1;
  loadEntries();
  loadTitles();
};
$('resetBtn').onclick = function () {
  $('project').value = 'all'; $('q').value = ''; $('from').value = ''; $('to').value = '';
  state.project = 'all'; state.q = ''; state.from = null; state.to = null; state.page = 1;
  loadEntries();
  loadTitles();
};
$('prevBtn').onclick = function () { if (state.page > 1) { state.page--; loadEntries(); } };
$('nextBtn').onclick = function () {
  if (state.page < Math.ceil(state.total / state.pageSize)) { state.page++; loadEntries(); }
};
$('selAll').onchange = function () {
  Array.prototype.forEach.call(document.querySelectorAll('.sel'), function (c) { c.checked = $('selAll').checked; });
  updateBulk();
};
document.querySelector('#tbody').addEventListener('change', function (e) { if (e.target && e.target.classList && e.target.classList.contains('sel')) updateBulk(); });
$('bulkDelBtn').onclick = function () {
  var sels = collectSelected();
  if (!sels.length) return;
  if (!confirm('确定删除选中的 ' + sels.length + ' 条问答记录?')) return;
  fetch(API + '/entries', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deletes: sels }) })
    .then(function (r) { return r.json(); }).then(function (d) {
      setMsg(d.ok ? '已删除 ' + d.removed + ' 条' : d.reason, !d.ok);
      loadEntries();
    });
};
$('exportBtn').onclick = function () {
  state.project = $('project').value;
  state.q = $('q').value.trim();
  var f = $('from').value, t = $('to').value;
  state.from = f ? new Date(f).getTime() : null;
  state.to = t ? new Date(t).getTime() : null;
  window.location.href = API + '/export?' + qs();
};
$('dedupeBtn').onclick = function () {
  var scope = state.project === 'all' ? '全部项目' : state.projects.find(function (x) { return x.workspaceId === state.project; }).title;
  if (!confirm('按「问题+回答」完全相同去重(保留最早),范围: ' + scope + '。继续?')) return;
  fetch(API + '/dedupe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: state.project }) })
    .then(function (r) { return r.json(); }).then(function (d) {
      setMsg(d.ok ? '去重完成,删除 ' + d.removed + ' 条' : d.reason, !d.ok);
      loadProjects().then(loadEntries);
    });
};
$('clearBtn').onclick = function () {
  if (state.project === 'all') { setMsg('请先选择单个项目再清空', true); return; }
  var p = state.projects.find(function (x) { return x.workspaceId === state.project; });
  if (!confirm('确定清空项目「' + p.title + '」的全部 ' + p.count + ' 条记忆?此操作不可恢复!')) return;
  fetch(API + '/clear', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: state.project }) })
    .then(function (r) { return r.json(); }).then(function (d) {
      setMsg(d.ok ? '已清空 ' + d.removed + ' 条' : d.reason, !d.ok);
      loadProjects().then(loadEntries);
    });
};

// ---- 添加问答(必填校验) ----
$('addBtn').onclick = function () { openAdd(); };
$('addCancel').onclick = function () { $('addMask').classList.remove('open'); };
function openAdd() {
  if (state.projects.length === 0) { setMsg('没有可用项目', true); return; }
  var addSel = $('addProject');
  if (state.project !== 'all') addSel.value = state.project;
  var now = new Date();
  var p = function (n) { return n < 10 ? '0' + n : '' + n; };
  $('addTime').value = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate()) + 'T' + p(now.getHours()) + ':' + p(now.getMinutes());
  $('addQuestion').value = '';
  $('addAnswer').value = '';
  $('addMask').classList.add('open');
  updateAddButton();
}
function updateAddButton() {
  var ok = $('addProject').value !== '' && $('addQuestion').value.trim() !== '' && $('addAnswer').value.trim() !== '' && $('addTime').value !== '';
  $('addConfirm').disabled = !ok;
}
['addProject', 'addQuestion', 'addAnswer', 'addTime'].forEach(function (id) {
  $(id).addEventListener('input', updateAddButton);
  $(id).addEventListener('change', updateAddButton);
});
$('addConfirm').onclick = function () {
  var body = {
    projectId: $('addProject').value,
    question: $('addQuestion').value.trim(),
    answer: $('addAnswer').value.trim(),
    time: new Date($('addTime').value).getTime(),
  };
  fetch(API + '/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        setMsg('已添加 1 条');
        $('addMask').classList.remove('open');
        loadProjects().then(loadEntries);
      } else {
        setMsg(d.reason || '添加失败', true);
      }
    });
};

// ---- 批量导入 ----
$('importBtn').onclick = function () { $('importMask').classList.add('open'); $('importData').value = ''; $('importFile').value = ''; };
$('importCancel').onclick = function () { $('importMask').classList.remove('open'); };
$('importFile').onchange = function () {
  var file = $('importFile').files && $('importFile').files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () { $('importData').value = String(reader.result); };
  reader.readAsText(file, 'utf-8');
};
$('importConfirm').onclick = function () {
  var raw = $('importData').value.trim();
  if (!raw) { setMsg('请粘贴数据或选择文件', true); return; }
  var parsed;
  try { parsed = JSON.parse(raw); } catch (e) { setMsg('JSON 解析失败: ' + e.message, true); return; }
  var items = Array.isArray(parsed) ? parsed : (parsed.entries || null);
  if (!items || !items.length) { setMsg('没有可导入的数据', true); return; }
  fetch(API + '/entries/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: $('importProject').value, items: items }) })
    .then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        setMsg('导入完成: 新增 ' + d.added + ' 条,跳过 ' + d.skipped + ' 条');
        $('importMask').classList.remove('open');
        loadProjects().then(loadEntries);
      } else {
        setMsg(d.reason || '导入失败', true);
      }
    });
};

// ---- 初始化 ----
loadProjects().then(loadEntries);
loadTitles();
</script>
</body>
</html>`

export class MemoryDbService extends Service {
  static inject = ['settings', 'workspaceRegistry', 'agents', 'webServer', 'timer']

  constructor(ctx) {
    super(ctx, 'memoryDb')
  }

  async [Service.init]() {
    const ctx = this.ctx
    ctx.settings.register(SETTINGS_NS, memoryDbSettingsSchema)

    const PLUGIN = 'memory-db'
    const CONFIG_REL = '.dsh/memory-db/config.json'
    const DB_REL = '.dsh/memory-db/memory.json'
    const DEBUG_REL = '.dsh/memory-db/debug.log'
    const KEY_DEFAULT = '__default__'
    const DEFAULT_ENABLED = false
    const REFRESH_MS = 15000
    const CONFIG_TTL_MS = 10000
    const MAX_ENTRIES = 5000
    const STRIP_MIN = 30
    const DEBUG_MAX_LINES = 300
    const ADMIN_PATH = '/memory-db-admin'

    // ---- pkg-27 上下文优化: 预算常量 ----
    const CONTENT_RATIO = 0.6
    const BUDGET_RATIO = 0.4
    const SINGLE_RATIO = 0.05
    const SAFETY_MARGIN = 0.12
    const DEFAULT_CONTEXT_WINDOW = 32768
    const DEFAULT_MAX_TOKENS = 2048
    const SYSTEM_PROMPT_EST = 4000

    // ---- pkg-28 分类器常量 ----
    const CLASSIFY_TIMEOUT_MS = 12000
    const CLASSIFY_POLL_MS = 300
    const CLASSIFY_ROUNDS = 5
    const CLASSIFIER_LABEL = "memory-db 话题分类器"

    const workspaces = []
    const enabled = new Map()
    const states = new Map()
    const configCache = new Map()
    const pendingTurns = new Map()
    const surfaced = new Map()
    const debugChains = new Map()
    let debugRoot = null
    let wsSnapshot = ''
    let msgCounter = 0
    let refreshing = false
    const stats = new Map()

    const classifierBySession = new Map()
    const classifierChildIds = new Set()
    const compactState = new Map()
    let classifierProviderName = null

    const fs = ctx.get('fs')
    const workspaceRegistry = ctx.get('workspaceRegistry')
    const sessionQuery = ctx.get('sessionQuery')
    const sessionsSvc = ctx.get('sessions')
    const agents = ctx.get('agents')
    const systemPrompt = ctx.get('systemPrompt')
    const storageDomain = ctx.get('storageDomain')
    const webServer = ctx.get('webServer')
    const subprocess = ctx.get('subprocess')
    const sessionTitle = ctx.get('sessionTitle')
    const llm = ctx.get('llm')
    const subagents = ctx.get('subagents')
    const compaction = ctx.get('compaction')

    let table = null
    let openError = null
    if (storageDomain !== undefined) {
      try {
        const passthrough = { parse: (v) => v, safeParse: (v) => ({ success: true, data: v }) }
        const domain = await storageDomain.open({
          name: 'memory_db',
          version: 1,
          tables: { projects: { valueSchema: passthrough } },
        })
        table = domain.table('projects')
        let closed = false
        ctx.effect(() => () => {
          if (closed) return
          closed = true
          domain.close().catch(() => {})
        })
      } catch (error) {
        openError = error instanceof Error ? error.message : String(error)
        console.error('[memory-db] storage domain unavailable: ' + openError)
      }
    } else {
      openError = 'storageDomain service not mounted'
    }
    // 旧配置回退(storageDomain memory_db 域 + 项目 config.json)——静态版迁移期兼容
    const legacyEnabled = async (workspaceId, wpath) => {
      if (table !== null) {
        const rec = workspaceId !== undefined ? table.get(workspaceId) : undefined
        if (rec !== undefined && typeof rec.enabled === 'boolean') return rec.enabled
        const def = table.get(KEY_DEFAULT)
        if (def !== undefined && typeof def.enabled === 'boolean') return def.enabled
      }
      if (wpath !== undefined) {
        const cfg = await readConfig(wpath)
        if (cfg.exists && typeof cfg.enabled === 'boolean') return cfg.enabled
      }
      return undefined
    }
    // 开关解析:settings.yaml 优先,未设置时回退旧配置
    const tableEnabled = async (workspaceId, wpath) => {
      const raw = ctx.settings.get(SETTINGS_NS)
      const projects = raw && typeof raw.projects === 'object' && raw.projects !== null ? raw.projects : {}
      if (workspaceId !== undefined && typeof projects[workspaceId] === 'boolean') return projects[workspaceId]
      if (raw && typeof raw.defaultEnabled === 'boolean') return raw.defaultEnabled
      return await legacyEnabled(workspaceId, wpath)
    }
    const readDefaultEnabled = async () => {
      const d = await tableEnabled(undefined, undefined)
      return d === undefined ? DEFAULT_ENABLED : d
    }
    // 首启迁移:settings 未初始化时,把旧开关(storageDomain memory_db 表 + 项目 config.json)写入 settings.yaml
    async function migrateLegacySettings() {
      try {
        const raw = ctx.settings.get(SETTINGS_NS)
        const projects = raw && typeof raw.projects === 'object' && raw.projects !== null ? raw.projects : {}
        if (raw && typeof raw.defaultEnabled === 'boolean') return
        if (Object.keys(projects).length > 0) return
        const ops = []
        if (table !== null) {
          const def = table.get(KEY_DEFAULT)
          if (def !== undefined && typeof def.enabled === 'boolean') ops.push({ op: 'set', path: ['defaultEnabled'], value: def.enabled })
        }
        for (const w of workspaces) {
          let v
          if (table !== null) {
            const rec = table.get(w.id)
            if (rec !== undefined && typeof rec.enabled === 'boolean') v = rec.enabled
          }
          if (v === undefined) {
            const cfg = await readConfig(w.path)
            if (cfg.exists && typeof cfg.enabled === 'boolean') v = cfg.enabled
          }
          if (v !== undefined) ops.push({ op: 'set', path: ['projects', w.id], value: v })
        }
        if (ops.length > 0) {
          await ctx.settings.mutate(SETTINGS_NS, ops)
          debugLog('migrated legacy switches to settings: ' + ops.length + ' ops')
        }
      } catch (e) {
        debugLog('legacy migration failed: ' + (e && e.message))
      }
    }

    function writePolicy(wpath) {
      return { mode: 'workspace-write', workspaceRoot: wpath }
    }
    function debugLog(line) {
      try {
        console.log('[memory-db] ' + line)
        if (!fs || !debugRoot) return
        const prev = debugChains.get('debug') ?? Promise.resolve()
        const chain = prev.then(async () => {
          const target = await fs.resolve(joinPath(debugRoot, DEBUG_REL))
          const info = await fs.stat(target).catch(() => undefined)
          let existing = info ? await fs.readText(target).catch(() => '') : ''
          const lines = existing.split('\n')
          if (lines.length > DEBUG_MAX_LINES) existing = lines.slice(lines.length - DEBUG_MAX_LINES).join('\n')
          const stamp = new Date().toISOString()
          await fs.writeText(target, (existing ? existing + '\n' : '') + '[' + stamp + '] ' + line, undefined, undefined, writePolicy(debugRoot))
        }).catch((e) => { console.error('memory-db debug write failed:', e) })
        debugChains.set('debug', chain)
      } catch (e) { /* ignore */ }
    }

    function joinPath(root, rel) {
      return String(root).replace(/[\\/]+$/, '') + '/' + rel
    }
    function keyOf(en) {
      return en && en.sessionId && en.turn !== undefined
        ? en.sessionId + ':' + en.turn
        : 'id:' + (en && en.id)
    }
    function textOf(content) {
      if (!Array.isArray(content)) return ''
      const parts = []
      for (const b of content) {
        if (b && b.type === 'text' && typeof b.text === 'string' && b.text) parts.push(b.text)
      }
      return parts.join('\n').trim()
    }
    function iso(ms) {
      try {
        const d = new Date(ms)
        const p = (n) => (n < 10 ? '0' + n : '' + n)
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
          ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
      } catch (e) { return String(ms) }
    }
    function clampInt(v, min, max, dflt) {
      return Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : dflt
    }
    function workspaceFor(cwd) {
      if (typeof cwd !== 'string' || !cwd) return undefined
      let best
      for (const w of workspaces) {
        if (cwd === w.path || cwd.startsWith(w.path + '/') || cwd.startsWith(w.path + '\\')) {
          if (!best || w.path.length > best.path.length) best = w
        }
      }
      return best ? best.path : undefined
    }
    // 仅主会话生效:子代理会话(origin='subagent' 或 delegationDepth>0)不参与
    // 分类判定 / 记忆注入 / 问答收集 / 工作流提示段 —— 避免在功能性子代理身上重复生效
    function isSubagentSession(session) {
      try {
        const header = session && session.header
        if (!header) return false
        if (header.origin === 'subagent') return true
        if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return true
        return false
      } catch (e) {
        return false
      }
    }
    function ensureState(wpath) {
      let s = states.get(wpath)
      if (!s) {
        s = { backfilled: false, db: null, writeChain: Promise.resolve() }
        states.set(wpath, s)
      }
      return s
    }
    function wsById(id) {
      return workspaces.find((w) => w.id === id)
    }
    // 会话标题演变文本(优雅表达;无演变返回 null)
    function titleEvolutionText(db, sessionId) {
      const hist = db && db.titleHistory ? db.titleHistory.get(sessionId) : undefined
      if (!hist || hist.length <= 1) return null
      const parts = []
      parts.push('初始「' + hist[0].title + '」')
      for (let i = 1; i < hist.length; i++) {
        parts.push(iso(hist[i].at) + ' 变更为「' + hist[i].title + '」')
      }
      return '该会话标题变更历史: ' + parts.join('; ')
    }

    async function readConfig(wpath) {
      const out = { exists: false, enabled: false, backfilled: false }
      try {
        if (!fs) return out
        const target = await fs.resolve(joinPath(wpath, CONFIG_REL))
        const info = await fs.stat(target)
        if (!info) return out
        out.exists = true
        const raw = await fs.readText(target)
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (parsed.enabled === true) out.enabled = true
          if (parsed.backfilled === true) out.backfilled = true
        }
      } catch (e) { /* ignore */ }
      return out
    }
    async function writeConfig(wpath, cfg) {
      if (!fs) return
      const target = await fs.resolve(joinPath(wpath, CONFIG_REL))
      await fs.writeText(target, JSON.stringify({
        enabled: cfg.enabled === true,
        backfilled: cfg.backfilled === true,
      }, null, 2), undefined, undefined, writePolicy(wpath))
    }
    async function loadDb(wpath) {
      const state = ensureState(wpath)
      if (state.db) return state.db
      let entries = []
      let titleHistoryRaw = {}
      try {
        if (fs) {
          const target = await fs.resolve(joinPath(wpath, DB_REL))
          const info = await fs.stat(target)
          if (info) {
            const raw = await fs.readText(target)
            const parsed = JSON.parse(raw)
            if (parsed && Array.isArray(parsed.entries)) entries = parsed.entries
            if (parsed && parsed.titleHistory && typeof parsed.titleHistory === 'object' && !Array.isArray(parsed.titleHistory)) {
              titleHistoryRaw = parsed.titleHistory
            }
          }
        }
      } catch (e) { entries = [] }
      const keys = new Set()
      for (const en of entries) keys.add(keyOf(en))
      const titleHistory = new Map()
      for (const sid of Object.keys(titleHistoryRaw)) {
        if (Array.isArray(titleHistoryRaw[sid])) titleHistory.set(sid, titleHistoryRaw[sid])
      }
      state.db = { entries, keys, titleHistory, sessionTitles: new Map() }
      return state.db
    }
    function queueSave(wpath) {
      const state = ensureState(wpath)
      state.writeChain = state.writeChain.then(async () => {
        if (!fs || !state.db) return
        const target = await fs.resolve(joinPath(wpath, DB_REL))
        const th = {}
        for (const [sid, arr] of state.db.titleHistory) th[sid] = arr
        await fs.writeText(target, JSON.stringify({ version: 1, entries: state.db.entries, titleHistory: th }, null, 2), undefined, undefined, writePolicy(wpath))
      }).catch((e) => { console.error('memory-db save failed:', e); debugLog('save failed: ' + e.message) })
    }
    function trimDb(state) {
      if (!state.db || state.db.entries.length <= MAX_ENTRIES) return
      const sorted = [...state.db.entries].sort((a, b) => (a.time || 0) - (b.time || 0))
      const cut = sorted.slice(0, state.db.entries.length - MAX_ENTRIES)
      const cutSet = new Set(cut)
      state.db.entries = state.db.entries.filter((en) => !cutSet.has(en))
      for (const en of cut) state.db.keys.delete(keyOf(en))
      debugLog('trimmed ' + cut.length + ' oldest entries')
    }

    // 会话标题事件:更新演变链 + 该会话全部条目 sessionTitle 同步为最新标题
    async function handleTitleEvent(wpath, sessionId, event) {
      const db = await loadDb(wpath)
      const title = event && event.data && typeof event.data.title === 'string' ? event.data.title : ''
      if (!title) return
      const cur = db.sessionTitles.get(sessionId)
      if (cur && cur.title === title) {
        db.sessionTitles.set(sessionId, { title, at: event.time })
        return
      }
      const hist = db.titleHistory.get(sessionId) || []
      hist.push({ title, at: event.time, seq: event.seq })
      db.titleHistory.set(sessionId, hist)
      db.sessionTitles.set(sessionId, { title, at: event.time })
      // 会话标题变化 => 该会话所有记录的会话标题随之更新
      let changed = false
      for (const en of db.entries) {
        if (en.sessionId === sessionId && en.sessionTitle !== title) {
          en.sessionTitle = title
          changed = true
        }
      }
      queueSave(wpath)
      if (changed) debugLog('title changed: ' + sessionId + ' -> ' + title + ' (updated ' + db.entries.filter((en) => en.sessionId === sessionId).length + ' entries)')
    }

    async function refreshProject(wpath) {
      const ws = workspaces.find((w) => w.path === wpath)
      const cfg = await readConfig(wpath)
      const state = ensureState(wpath)
      const prev = configCache.get(wpath)
      const wasEnabled = prev ? prev.enabled : false
      state.backfilled = cfg.backfilled
      const resolved = (await tableEnabled(ws ? ws.id : undefined, wpath)) ?? DEFAULT_ENABLED
      enabled.set(wpath, resolved)
      configCache.set(wpath, { enabled: resolved, at: Date.now() })
      if (resolved && (!wasEnabled || !cfg.backfilled)) {
        debugLog('refresh: enabling ' + wpath)
        backfill(wpath).catch((e) => debugLog('backfill trigger failed: ' + (e && e.message)))
      }
    }
    async function setProjectEnabled(wpath, enabledNow) {
      const ws = workspaces.find((w) => w.path === wpath)
      if (ws) {
        await ctx.settings.mutate(SETTINGS_NS, [{ op: 'set', path: ['projects', ws.id], value: enabledNow }])
      } else if (fs) {
        const cfg = await readConfig(wpath)
        cfg.enabled = enabledNow
        await writeConfig(wpath, cfg)
      }
      enabled.set(wpath, enabledNow)
      configCache.set(wpath, { enabled: enabledNow, at: Date.now() })
      const cfg2 = await readConfig(wpath)
      if (enabledNow && !cfg2.backfilled) {
        backfill(wpath).catch((e) => debugLog('backfill trigger failed: ' + (e && e.message)))
      }
      if (!enabledNow) {
        // 记忆库关闭 → 清除该项目的全部分类器子代理
        cleanupClassifiersForProject(wpath).catch((e) => debugLog('classifier cleanup trigger failed: ' + (e && e.message)))
      }
    }

    async function backfill(wpath) {
      try {
        const state = ensureState(wpath)
        await loadDb(wpath)
        if (!sessionQuery || !fs) { debugLog('backfill skip: sessionQuery=' + !!sessionQuery + ' fs=' + !!fs); return }
        const ws = workspaces.find((w) => w.path === wpath)
        if (!ws) { debugLog('backfill skip: workspace not found for ' + wpath); return }
        debugLog('backfill start: ' + wpath + ' sessions=' + ws.sessionIds.length)
        let count = 0
        let patched = false
        for (const sid of ws.sessionIds) {
          try {
            const snap = await sessionQuery.readSession(sid)
            const hdr = snap && snap.session ? snap.session : undefined
            if (hdr && (hdr.origin === 'subagent' || (typeof hdr.delegationDepth === 'number' && hdr.delegationDepth > 0))) {
              debugLog('backfill skip subagent session ' + sid)
              continue
            }
            const events = snap && Array.isArray(snap.events) ? snap.events : []
            debugLog('backfill session ' + sid + ' events=' + events.length)
            const titleChain = []
            for (const ev of events) {
              if (ev && ev.type === 'session/title' && ev.data && typeof ev.data.title === 'string') {
                titleChain.push({ title: ev.data.title, at: ev.time, seq: ev.seq })
              }
            }
            if (titleChain.length > 0) {
              state.db.titleHistory.set(sid, titleChain)
              const finalTitle = titleChain[titleChain.length - 1].title
              state.db.sessionTitles.set(sid, { title: finalTitle, at: titleChain[titleChain.length - 1].at })
              // 该会话全部条目 sessionTitle 统一为最终标题
              for (const en of state.db.entries) {
                if (en.sessionId === sid && en.sessionTitle !== finalTitle) {
                  en.sessionTitle = finalTitle
                  patched = true
                }
              }
            }
            let pend = null
            for (const ev of events) {
              if (!ev || typeof ev !== 'object') continue
              if (ev.type === 'turn/start') {
                pend = { turn: ev.data && ev.data.turn, question: '', answer: '', time: 0 }
                continue
              }
              if (!pend) continue
              if (ev.surfaceOp !== undefined && ev.surfaceOp !== 'append') continue
              if (ev.type === 'user/message') {
                const m = ev.data
                if (m && m.source && m.source.kind === 'user') {
                  const t = textOf(m.content)
                  if (t) pend.question = pend.question ? pend.question + '\n' + t : t
                }
              } else if (ev.type === 'assistant/message') {
                const m = ev.data && ev.data.message
                if (m && m.source && m.source.kind === 'model') {
                  const t = textOf(m.content)
                  if (t) { pend.answer = t; pend.time = ev.time }
                }
              } else if (ev.type === 'turn/end' && ev.data && ev.data.turn === pend.turn) {
                const q = (pend.question || '').trim()
                const a = (pend.answer || '').trim()
                if (q && a && pend.time) {
                  const finalTitle = titleChain.length > 0 ? titleChain[titleChain.length - 1].title : undefined
                  if (recordPair(wpath, sid, pend.turn, q, a, pend.time, finalTitle)) count++
                }
                pend = null
              }
            }
          } catch (e) {
            debugLog('backfill session failed ' + sid + ': ' + e.message)
          }
        }
        if (patched) queueSave(wpath)
        debugLog('backfill done: ' + wpath + ' recorded=' + count + ' patchedTitles=' + patched)
        const cfg = await readConfig(wpath)
        if (!cfg.backfilled) {
          await writeConfig(wpath, { enabled: cfg.enabled, backfilled: true }).catch((e) => debugLog('backfill flag write failed: ' + e.message))
        }
        ensureState(wpath).backfilled = true
      } catch (e) {
        debugLog('backfill crashed: ' + (e && e.message))
      }
    }
    async function refreshProjects() {
      if (refreshing) return
      refreshing = true
      try {
        if (workspaceRegistry) {
          workspaces.length = 0
          for (const w of workspaceRegistry.list()) {
            workspaces.push({ path: w.path, id: w.id, title: w.title, sessionIds: w.sessionIds })
          }
        }
        // 日志根目录优先跟随当前会话所属项目(便于按项目排查),取不到时用第一个开启的项目
        try {
          const initiator = agents && typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : undefined
          const cwd = initiator && initiator.session && initiator.session.header ? initiator.session.header.cwd : undefined
          const picked = typeof cwd === 'string' ? workspaceFor(cwd) : undefined
          if (picked) debugRoot = picked
        } catch (e) { /* ignore */ }
        if (!debugRoot && workspaces.length > 0) {
          const active = workspaces.find((w) => enabled.get(w.path) === true)
          debugRoot = active ? active.path : workspaces[0].path
        }
        const snap = JSON.stringify(workspaces.map((w) => ({ path: w.path, sessions: w.sessionIds.length })))
        if (snap !== wsSnapshot) {
          wsSnapshot = snap
          debugLog('workspaces=' + snap)
        }
        for (const w of workspaces) await refreshProject(w.path)
      } catch (e) {
        debugLog('refresh crashed: ' + (e && e.message))
      } finally {
        refreshing = false
      }
    }
    async function isEnabledFresh(wpath) {
      const cached = configCache.get(wpath)
      if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.enabled
      const ws = workspaces.find((w) => w.path === wpath)
      const cfg = await readConfig(wpath)
      const state = ensureState(wpath)
      const prev = configCache.get(wpath)
      const wasEnabled = prev ? prev.enabled : false
      state.backfilled = cfg.backfilled
      const resolved = (await tableEnabled(ws ? ws.id : undefined, wpath)) ?? DEFAULT_ENABLED
      enabled.set(wpath, resolved)
      configCache.set(wpath, { enabled: resolved, at: Date.now() })
      if (resolved && (!wasEnabled || !cfg.backfilled)) {
        backfill(wpath).catch((e) => debugLog('backfill trigger failed: ' + (e && e.message)))
      }
      return resolved
    }
    function primeLiveSessions() {
      if (!sessionsSvc) return
      try {
        for (const s of sessionsSvc.list()) {
          const header = s && s.header
          if (!header) continue
          if (isSubagentSession(s)) continue
          const wpath = workspaceFor(header.cwd)
          if (!wpath || !enabled.get(wpath)) continue
          const state = ensureState(wpath)
          if (!state.db) continue
          const events = s.events
          if (!events || typeof events.entries !== 'function') continue
          let pend = null
          for (const [, ev] of events.entries()) {
            if (!ev || typeof ev !== 'object') continue
            if (ev.type === 'session/title' && ev.data && typeof ev.data.title === 'string') {
              state.db.sessionTitles.set(header.id, { title: ev.data.title, at: ev.time })
              continue
            }
            if (ev.type === 'turn/start') {
              pend = { turn: ev.data && ev.data.turn, question: '', answer: '', time: 0 }
            } else if (pend && ev.type === 'user/message') {
              const m = ev.data
              if (m && m.source && m.source.kind === 'user') {
                const t = textOf(m.content)
                if (t) pend.question = pend.question ? pend.question + '\n' + t : t
              }
            } else if (pend && ev.type === 'assistant/message') {
              const m = ev.data && ev.data.message
              if (m && m.source && m.source.kind === 'model') {
                const t = textOf(m.content)
                if (t) { pend.answer = t; pend.time = ev.time }
              }
            } else if (pend && ev.type === 'turn/end' && ev.data && ev.data.turn === pend.turn) {
              pend = null
            }
          }
          if (pend) pendingTurns.set(header.id, pend)
        }
      } catch (e) {
        debugLog('prime sessions failed: ' + (e && e.message))
      }
    }

    function addSurfaced(sessionId, kind, texts) {
      if (!sessionId || !texts || texts.length === 0) return
      let entry = surfaced.get(sessionId)
      if (!entry) { entry = { memory: [], web: [] }; surfaced.set(sessionId, entry) }
      const list = kind === 'web' ? entry.web : entry.memory
      const cap = kind === 'web' ? 8 : 16
      const maxLen = kind === 'web' ? 8000 : 3000
      const now = Date.now()
      for (const t of texts) {
        if (typeof t !== 'string' || !t) continue
        list.push({ t: t.slice(0, maxLen), at: now })
      }
      const keep = list.filter((f) => now - f.at < 7200000)
      while (keep.length > cap) keep.shift()
      if (kind === 'web') entry.web = keep
      else entry.memory = keep
    }
    function stripFragments(text, frags) {
      if (!text || !frags || frags.length === 0) return text
      const sorted = frags
        .filter((f) => typeof f === 'string' && f.length >= STRIP_MIN)
        .sort((a, b) => b.length - a.length)
      if (sorted.length === 0) return text
      let out = text
      for (const f of sorted) {
        if (out.includes(f)) out = out.split(f).join('')
      }
      out = out.replace(/\n{3,}/g, '\n\n').trim()
      if (out.length < Math.max(1, text.length * 0.15)) return text
      return out
    }
    function recordPair(wpath, sessionId, turn, question, answer, time, sessionTitle) {
      const state = ensureState(wpath)
      if (!state.db) return false
      const key = sessionId + ':' + turn
      if (state.db.keys.has(key)) return false
      const frags = surfaced.get(sessionId)
      const strips = []
      if (frags) {
        for (const f of frags.memory) strips.push(f.t)
        for (const f of frags.web) strips.push(f.t)
      }
      const clean = stripFragments(answer, strips)
      if (!clean) return false
      const entry = {
        id: 'm' + (++msgCounter) + '-' + Date.now().toString(36),
        question: String(question).slice(0, 8000),
        answer: clean.slice(0, 20000),
        time,
        sessionId,
        turn,
      }
      if (typeof sessionTitle === 'string' && sessionTitle) entry.sessionTitle = sessionTitle
      state.db.entries.push(entry)
      state.db.keys.add(key)
      trimDb(state)
      queueSave(wpath)
      return true
    }

    function tokenize(q) {
      const s = String(q).toLowerCase().trim()
      if (!s) return []
      const tokens = []
      for (const m of s.matchAll(/[a-z0-9]+/g)) if (m[0].length >= 2) tokens.push(m[0])
      for (const m of s.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/g)) {
        const run = m[0]
        if (run.length >= 2) for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
      }
      if (tokens.length === 0) tokens.push(s)
      return [...new Set(tokens)]
    }
    function searchEntriesScored(entries, query) {
      const tokens = tokenize(query)
      if (tokens.length === 0) return []
      const scored = []
      for (const en of entries) {
        const ql = String(en.question || '').toLowerCase()
        const al = String(en.answer || '').toLowerCase()
        let score = 0
        for (const t of tokens) {
          if (ql.includes(t)) score += t.length * 3
          else if (al.includes(t)) score += t.length
        }
        if (score > 0) scored.push({ en, score })
      }
      scored.sort((a, b) => b.score - a.score || (b.en.time || 0) - (a.en.time || 0))
      return scored
    }
    function searchEntries(entries, query, limit) {
      const scored = searchEntriesScored(entries, query)
      return scored.slice(0, limit > 0 ? limit : scored.length).map((s) => s.en)
    }


    // ---- pkg-29 关键词直接匹配检索 + 记忆资料构造 ----
    function searchByKeywords(entries, keywords) {
      const kws = (keywords || []).filter((k) => typeof k === "string" && k.trim()).map((k) => k.trim().toLowerCase())
      if (kws.length === 0) return []
      const hits = []
      for (const en of entries) {
        const ql = String(en.question || "").toLowerCase()
        const al = String(en.answer || "").toLowerCase()
        let score = 0
        for (const k of kws) {
          if (ql.includes(k)) score += k.length * 3
          else if (al.includes(k)) score += k.length
        }
        if (score > 0) hits.push({ en, score })
      }
      hits.sort((a, b) => (b.en.time || 0) - (a.en.time || 0))
      return hits.map((h) => h.en)
    }
    function renderMemoryEntry(db, h) {
      const lines = []
      lines.push("")
      lines.push('时间: ' + iso(h.time))
      if (h.sessionTitle) {
        const evo = titleEvolutionText(db, h.sessionId)
        lines.push('会话: ' + h.sessionTitle + (evo ? '（' + evo + '）' : ''))
      }
      lines.push('问: ' + String(h.question).slice(0, 800))
      lines.push('答: ' + String(h.answer).slice(0, 1500))
      return lines.join('\n')
    }
    function memoryHead(keywords) {
      return '【历史记忆参考 · 项目记忆库】以下是根据你提炼的关键词「' + keywords.join('、') + '」从项目记忆库中检索到的相关记忆资料，请结合这些记忆作答：'
    }
    function memoryTail() {
      return '\n\n请以以上记忆资料为参考判断用户意图，再回答用户当前的问题；若记忆与当前问题无关则忽略。'
    }
    function lastInjectedText(agent) {
      try {
        const events = agent && agent.session && agent.session.events
        if (!events || typeof events.entries !== 'function') return null
        let last = null
        for (const [, ev] of events.entries()) {
          if (ev && ev.type === 'user/message') {
            const m = ev.data
            if (m && m.source && m.source.kind === 'plugin' && m.source.plugin === PLUGIN) {
              const t = textOf(m.content)
              if (t) last = t
            }
          }
        }
        return last
      } catch (e) { return null }
    }
    async function summarizeChunk(text, agent, signal) {
      const prompt = '把下面的历史问答记忆压缩成简明摘要，保留关键信息（时间、主题、结论、约定、数据）。只输出摘要正文，不要任何前言：\n\n' + text
      return await askClassifierA(agent, prompt, signal, 1024)
    }
    function splitText(text, maxLen) {
      const parts = []
      let cur = ""
      for (const line of String(text).split("\n")) {
        if (cur.length + line.length + 1 > maxLen && cur) { parts.push(cur); cur = line }
        else cur = cur ? cur + "\n" + line : line
      }
      if (cur) parts.push(cur)
      return parts
    }
    async function summarizeRemaining(rest, db, budgets, agent, signal) {
      const target = Math.min(Math.round(budgets.window * 0.2), budgets.injectCap)
      if (target <= 0) return null
      let chunks = []
      let cur = ""
      for (const h of rest) {
        const block = renderMemoryEntry(db, h)
        if (cur.length + block.length > 8000 && cur) { chunks.push(cur); cur = block }
        else cur += block
      }
      if (cur) chunks.push(cur)
      if (chunks.length === 0) return null
      let merged = ""
      for (const c of chunks) {
        const s = await summarizeChunk(c, agent, signal)
        if (!s) return null
        merged += (merged ? "\n" : "") + s
      }
      let guard = 0
      while (estimateTokens(merged) > target && guard < 3) {
        const parts = splitText(merged, 8000)
        if (parts.length <= 1) break
        let next = ""
        let ok = true
        for (const p of parts) {
          const s = await summarizeChunk(p, agent, signal)
          if (!s) { ok = false; break }
          next += (next ? "\n" : "") + s
        }
        if (!ok || !next) break
        merged = next
        guard++
      }
      return merged
    }
    async function buildStandardText(db, hits, budgets, keywords, agent, signal) {
      const head = memoryHead(keywords)
      const tail = memoryTail()
      const originalCap = Math.min(Math.round(budgets.window * 0.2), budgets.injectCap)
      let used = estimateTokens(head) + estimateTokens(tail)
      const originals = []
      for (const h of hits) {
        const block = renderMemoryEntry(db, h)
        const t = estimateTokens(block)
        if (used + t > originalCap) break
        originals.push(block)
        used += t
      }
      let text = head + originals.join("") + tail
      if (originals.length < hits.length) {
        const rest = hits.slice(originals.length)
        const summary = await summarizeRemaining(rest, db, budgets, agent, signal)
        if (summary) text = head + originals.join("") + "\n\n【较早的相关记忆摘要】\n" + summary + tail
      }
      return text
    }
    function buildLightText(db, hits, budgets, keywords) {
      const cap = Math.min(Math.round(budgets.window * 0.05), budgets.available)
      const head = memoryHead(keywords)
      const tail = memoryTail()
      let used = estimateTokens(head) + estimateTokens(tail)
      let body = ""
      for (const h of hits) {
        const block = renderMemoryEntry(db, h)
        const t = estimateTokens(block)
        if (used + t > cap) break
        body += block
        used += t
      }
      if (!body) return null
      return head + body + tail
    }
    async function buildInjection(agent, wpath, verdict, query, signal) {
      const state = ensureState(wpath)
      await loadDb(wpath)
      const keywords = verdict.keywords && verdict.keywords.length > 0 ? verdict.keywords : tokenize(query).slice(0, 10)
      const hits = searchByKeywords(state.db.entries, keywords)
      if (hits.length === 0) return null
      addSurfaced(agent.session.header.id, "memory", hits.map((h) => h.question + "\n" + h.answer))
      const mode = verdict.task === 'single' ? 'single' : 'normal'
      const budgets = await computeBudgets(agent, mode)
      let text = null
      if (mode === 'single') {
        text = buildLightText(state.db, hits, budgets, keywords)
      } else {
        text = await buildStandardText(state.db, hits, budgets, keywords, agent, signal)
      }
      if (!text) return null
      return { text, mode, budgets }
    }


    // ---- pkg-30 动态历史压缩(仅注入回合触发) ----
    async function maybeCompact(agent, wpath, budgets, injectText, signal) {
      try {
        if (compaction === undefined) return
        const injectEst = estimateTokens(injectText || "")
        const historyCap = Math.max(0, budgets.contentCap - injectEst)
        const historyEst = Math.max(0, estimateUsedTokens(agent) - SYSTEM_PROMPT_EST)
        if (historyEst <= historyCap) return
        const prev = compactState.get(wpath)
        if (prev && Date.now() - prev < 60000) { debugLog("compact skipped (recent)") ; return }
        await compaction.compactNow(agent, signal)
        compactState.set(wpath, Date.now())
        const c4 = stats.get(wpath) || {}
        bumpStats(wpath, { compactions: (c4.compactions || 0) + 1, lastCompactAt: Date.now() })
        debugLog('compactNow triggered: historyEst=' + historyEst + ' cap=' + historyCap)
      } catch (e) {
        debugLog('compactNow failed(下回合重试): ' + (e && e.message))
      }
    }

    // ---- pkg-27 上下文优化: 估算器 / 窗口解析 / 动态预算 ----
    function estimateTokens(text) {
      if (!text) return 0
      let cjk = 0
      let other = 0
      for (const ch of String(text)) {
        const code = ch.codePointAt(0)
        if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0xf900 && code <= 0xfaff)) cjk++
        else other++
      }
      return Math.ceil(cjk + other / 4)
    }
    function estimateMessageTokens(message) {
      let total = 0
      const blocks = message && message.content
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b && typeof b.text === 'string' && b.text) total += estimateTokens(b.text)
        }
      }
      return total
    }
    async function resolveContextWindow(agent) {
      try {
        const options = agent && agent.options
        const provider = options && typeof options.provider === 'string' ? options.provider : undefined
        const model = options && typeof options.model === 'string' ? options.model : undefined
        if (llm !== undefined && provider && model) {
          const info = await llm.resolveModelInfo(provider, model)
          if (info && info.context && typeof info.context.contextWindow === 'number' && info.context.contextWindow > 0) {
            return { window: info.context.contextWindow, source: 'model:' + provider + '/' + model }
          }
        }
      } catch (e) {
        debugLog('resolveContextWindow failed: ' + (e && e.message))
      }
      return { window: DEFAULT_CONTEXT_WINDOW, source: 'default:' + DEFAULT_CONTEXT_WINDOW }
    }
    function estimateUsedTokens(agent) {
      let used = SYSTEM_PROMPT_EST
      try {
        const session = agent && agent.session
        const events = session && session.events
        if (events && typeof events.entries === 'function') {
          for (const [, ev] of events.entries()) {
            if (!ev || typeof ev !== 'object') continue
            if (ev.type === 'user/message' || ev.type === 'assistant/message') {
              const data = ev.data
              const msg = data && data.message ? data.message : data
              used += estimateMessageTokens(msg)
            }
          }
        }
      } catch (e) {
        debugLog('estimateUsedTokens failed: ' + (e && e.message))
      }
      return used
    }
    async function computeBudgets(agent, mode) {
      const resolved = await resolveContextWindow(agent)
      const window = resolved.window
      const used = estimateUsedTokens(agent)
      const options = agent && agent.options
      const maxTokens = options && typeof options.maxTokens === 'number' ? options.maxTokens : DEFAULT_MAX_TOKENS
      const safety = Math.round(window * SAFETY_MARGIN)
      const available = Math.max(0, window - used - maxTokens - safety)
      const contentCap = Math.min(Math.round(window * CONTENT_RATIO), available)
      const ratio = mode === 'single' ? SINGLE_RATIO : BUDGET_RATIO
      const injectCap = Math.min(Math.round(window * ratio), available)
      return {
        window,
        windowSource: resolved.source,
        used,
        maxTokens,
        safety,
        available,
        contentCap,
        injectCap,
        historyCap: Math.max(0, contentCap - injectCap),
      }
    }
    function bumpStats(wpath, patch) {
      const cur = stats.get(wpath) || { injections: 0, dedupeHits: 0, intents: {}, lastDecision: null, lastMode: null }
      stats.set(wpath, Object.assign(cur, patch))
    }

    // ---- pkg-28 分类器: 三态判定(recall/continue/shift) + 关键词提炼 ----
    function classifierSystemPrompt() {
      return '你是「话题延续性分类器」。根据最近对话与当前问题判断用户意图，只输出 JSON。\n' +
      '判断规则（按优先级，短路）：\n' +
      '1. 回忆需求 recall：用户是否在引用、询问或依赖过往对话信息。显式如"我们之前…""上次你说过…""之前我跟你说过…""你记不记得…""回忆一下…"（仅示例）；更常见是隐式——问题引用了此前讨论过的概念/决定/数据/人名而未重新解释，或含"上次/之前/曾经/当时"等回溯语义。不确定时倾向 recall。\n' +
      '2. 延续 continue：当前问题在推进上一轮话题（同主题追问/补充/修正）。\n' +
      '3. 转向 shift：新话题。此时再判任务类型：single=单次任务（如"今天天气如何？"）；normal=常规话题。\n' +
      '输出仅 JSON（不要任何其他文字）：{"intent":"recall|continue|shift","task":"single|normal","keywords":["..."]}\n' +
      'keywords：intent=recall 或 shift 时从当前问题提炼 3~10 个检索关键词（中英文均可）；intent=continue 时为空数组。\n' +
      '会话首问（无历史）时不存在 continue，只输出 recall 或 shift。'
    }
    function parseClassifierOutput(text) {
      if (!text) return null
      let obj = null
      const m = String(text).match(/\{[\s\S]*\}/)
      if (m) {
        try { obj = JSON.parse(m[0]) } catch (e) { obj = null }
      }
      if (!obj || typeof obj !== "object") return null
      const intent = obj.intent === 'recall' || obj.intent === 'continue' || obj.intent === 'shift' ? obj.intent : null
      if (!intent) return null
      const task = obj.task === 'single' ? 'single' : 'normal'
      let keywords = []
      if (Array.isArray(obj.keywords)) {
        keywords = obj.keywords.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 40)).slice(0, 10)
      }
      if (intent !== 'continue' && keywords.length === 0) return null
      return { intent, task, keywords }
    }
    function recentRoundsText(agent, k) {
      try {
        const session = agent && agent.session
        const events = session && session.events
        if (!events || typeof events.entries !== 'function') return ''
        const rounds = []
        let cur = null
        for (const [, ev] of events.entries()) {
          if (!ev || typeof ev !== 'object') continue
          if (ev.type === 'user/message') {
            const m = ev.data
            if (m && m.source && m.source.kind === 'user') {
              const t = textOf(m.content)
              if (t) { cur = { q: t, a: '' }; rounds.push(cur) }
            }
          } else if (ev.type === 'assistant/message' && cur) {
            const m = ev.data && ev.data.message
            if (m && m.source && m.source.kind === 'model') {
              const t = textOf(m.content)
              if (t && !cur.a) cur.a = t
            }
          }
        }
        const last = rounds.slice(-k)
        if (last.length === 0) return ''
        const parts = []
        for (let i = 0; i < last.length; i++) {
          parts.push('用户: ' + last[i].q.slice(0, 500))
          if (last[i].a) parts.push('助手: ' + last[i].a.slice(0, 800))
        }
        return parts.join('\n')
      } catch (e) {
        return ''
      }
    }
    function hasPreviousUser(agent) {
      try {
        const session = agent && agent.session
        const events = session && session.events
        if (!events || typeof events.entries !== 'function') return false
        for (const [, ev] of events.entries()) {
          if (ev && ev.type === 'user/message') {
            const m = ev.data
            if (m && m.source && m.source.kind === 'user' && textOf(m.content)) return true
          }
        }
      } catch (e) { /* ignore */ }
      return false
    }
    function buildClassifierInput(query, recent, isFirst) {
      const parts = []
      if (recent) parts.push('最近对话:\n' + recent)
      parts.push(isFirst ? '当前问题(会话首问):\n' + query : '当前问题:\n' + query)
      return parts.join('\n\n')
    }
    function sleepMs(ms) {
      return new Promise((resolve) => { ctx.timeout(() => resolve(), ms) })
    }
    function withTimeout(promise, ms) {
      return new Promise((resolve) => {
        let settled = false
        const done = (v) => { if (!settled) { settled = true; resolve(v) } }
        const t = ctx.timeout(() => done(null), ms)
        Promise.resolve(promise).then((v) => { t(); done(v) }, () => { t(); done(null) })
      })
    }
    // 从持久层查找已存在的分类器子代理(跨插件重启/版本更新仍有效)
    // listChildren 按 createdAt 排序 → 最后一个即"最近建立"的一个
    async function findExistingClassifierChild(parentSessionId, signal) {
      try {
        if (subagents === undefined || typeof subagents.listChildren !== 'function') return null
        const list = await subagents.listChildren(parentSessionId, signal)
        const matches = []
        for (const e of Array.isArray(list) ? list : []) {
          if (!e || e.kind !== 'child') continue
          if (e.mode !== 'continuable') continue
          if (e.label !== CLASSIFIER_LABEL) continue
          matches.push(e)
        }
        if (matches.length === 0) return null
        const keep = matches[matches.length - 1]
        return {
          childId: keep.id,
          duplicates: matches.slice(0, matches.length - 1).map((e) => e.id),
          count: matches.length,
        }
      } catch (e) {
        debugLog('classifier listChildren failed: ' + (e && e.message))
        return null
      }
    }
    // 记忆库关闭时清除该项目的全部分类器子代理
    async function cleanupClassifiersForProject(wpath) {
      try {
        if (subagents === undefined || typeof subagents.listChildren !== 'function') return 0
        const ws = workspaces.find((w) => w.path === wpath)
        const sessionIds = new Set(ws ? ws.sessionIds : [])
        if (agents !== undefined && typeof agents.list === 'function') {
          for (const a of agents.list()) {
            const cwd = a && a.session && a.session.header ? a.session.header.cwd : undefined
            if (typeof cwd === 'string' && workspaceFor(cwd) === wpath && a.session.header.id) sessionIds.add(a.session.header.id)
          }
        }
        let released = 0
        for (const sid of sessionIds) {
          let list = []
          try { list = await subagents.listChildren(sid) } catch (e) { continue }
          const ids = []
          for (const e of Array.isArray(list) ? list : []) {
            if (e && e.kind === 'child' && e.mode === 'continuable' && e.label === CLASSIFIER_LABEL) ids.push(e.id)
          }
          if (ids.length === 0) continue
          for (const id of ids) {
            try { subagents.interrupt(id, { kind: 'user', parentSessionId: sid }) } catch (e) { /* noop */ }
          }
          const parentAgent = agents !== undefined && typeof agents.get === 'function' ? agents.get(sid) : undefined
          if (parentAgent && typeof subagents.drainContinuableChildren === 'function') {
            try {
              await subagents.drainContinuableChildren(parentAgent, ids)
              released += ids.length
            } catch (e) {
              debugLog('classifier drain failed for ' + sid + ': ' + (e && e.message))
            }
          }
          classifierBySession.delete(sid)
          for (const id of ids) classifierChildIds.delete(id)
        }
        debugLog('classifier cleanup on disable: released=' + released + ' project=' + wpath)
        return released
      } catch (e) {
        debugLog('classifier cleanup failed: ' + (e && e.message))
        return 0
      }
    }
    async function ensureClassifierChild(agent, firstInput, signal) {
      const sid = agent && agent.session && agent.session.header ? agent.session.header.id : null
      if (!sid) return null
      if (classifierChildIds.has(sid)) return null
      const existing = classifierBySession.get(sid)
      if (existing && existing.childId) return { childId: existing.childId, fresh: false }
      // 启动前先查是否已存在分类器子代理:存在则沿用最近的一个,多余的就地清理,不存在才新建
      const found = await findExistingClassifierChild(sid, signal)
      if (found) {
        classifierBySession.set(sid, { childId: found.childId, lastCount: 0 })
        classifierChildIds.add(found.childId)
        debugLog('classifier reuse: found ' + found.count + ' existing child(ren), keep latest ' + found.childId)
        if (found.duplicates.length > 0 && typeof subagents.drainContinuableChildren === 'function') {
          try {
            await subagents.drainContinuableChildren(agent, found.duplicates)
            debugLog('classifier cleanup: released ' + found.duplicates.length + ' duplicate child(ren)')
          } catch (e) {
            debugLog('classifier duplicate cleanup failed: ' + (e && e.message))
          }
        }
        return { childId: found.childId, fresh: false }
      }
      if (classifierProviderName === null) {
        const names = typeof subagents.list === 'function' ? subagents.list() : []
        classifierProviderName = names.length > 0 ? names[0] : 'default'
        debugLog('classifier provider: ' + classifierProviderName)
      }
      try {
        const start = await subagents.startContinuable({
          provider: classifierProviderName,
          label: CLASSIFIER_LABEL,
          request: {
            prompt: [
              { type: 'text', text: classifierSystemPrompt() + '\n\n（当前回合的判定输入已随本启动消息下发，请直接输出判定 JSON，不要输出任何其他内容）' },
              { type: 'text', text: String(firstInput || '') },
            ],
            parent: agent,
          },
          signal,
        })
        const childId = start && start.childId
        if (!childId) return null
        classifierBySession.set(sid, { childId, lastCount: 0 })
        classifierChildIds.add(childId)
        debugLog('classifier child created: ' + childId + ' for ' + sid + ' (first input embedded)')
        return { childId, fresh: true }
      } catch (e) {
        debugLog('classifier child create failed: ' + (e && e.message))
        return null
      }
    }
    async function readChildAssistant(childId) {
      try {
        if (!sessionQuery) return { count: 0, lastText: "" }
        const snap = await sessionQuery.readSession(childId)
        const events = snap && Array.isArray(snap.events) ? snap.events : []
        let count = 0
        let lastText = ""
        for (const ev of events) {
          if (ev && ev.type === 'assistant/message') {
            const m = ev.data && ev.data.message
            if (m && m.source && m.source.kind === 'model') {
              count++
              const t = textOf(m.content)
              if (t) lastText = t
            }
          }
        }
        return { count, lastText }
      } catch (e) {
        return { count: 0, lastText: "" }
      }
    }
    async function askClassifierB(agent, childId, text, signal, fresh) {
      if (!fresh) {
        try {
          // DSH 新版 subagents 已把 followup 更名为 sendMessage(sender, targetId, content, { signal })
          if (typeof subagents.sendMessage === 'function') {
            await subagents.sendMessage(agent, childId, [{ type: "text", text }], { signal })
          } else if (typeof subagents.followup === 'function') {
            await subagents.followup(agent, childId, [{ type: "text", text }], {
              source: { kind: 'coordinator', form: 'relay', senderSessionId: agent.session.header.id },
              signal,
            })
          } else {
            debugLog('classifier deliver unavailable: neither sendMessage nor followup exists')
            return null
          }
        } catch (e) {
          debugLog('classifier followup failed: ' + (e && e.message))
          return null
        }
      }
      const deadline = Date.now() + CLASSIFY_TIMEOUT_MS
      let last = await readChildAssistant(childId)
      for (;;) {
        if (Date.now() > deadline) {
          // 超时:中断子代理的悬空回合,避免残留第二次判定/白跑模型调用
          try {
            if (subagents !== undefined && typeof subagents.interrupt === 'function') {
              subagents.interrupt(childId, { kind: 'ancestor', agent })
              debugLog('classifier B timeout: interrupted child ' + childId)
            }
          } catch (e2) {
            debugLog('classifier interrupt failed: ' + (e2 && e2.message))
          }
          return null
        }
        await sleepMs(CLASSIFY_POLL_MS)
        const cur = await readChildAssistant(childId)
        if (cur.count > last.count || (cur.count > 0 && cur.lastText !== last.lastText)) return cur.lastText
        last = cur
      }
    }
    async function askClassifierA(agent, text, signal, maxTokens) {
      if (llm === undefined) return null
      const options = agent && agent.options
      const provider = options && typeof options.provider === 'string' ? options.provider : undefined
      const model = options && typeof options.model === 'string' ? options.model : undefined
      if (!provider || !model) return null
      const consumed = (async () => {
        let out = ""
        const kinds = {}
        let chunkCount = 0
        try {
          for await (const chunk of llm.stream({
            provider,
            model,
            messages: [{ role: 'user', content: [{ type: 'text', text }] }],
            reasoningEffort: 'off',
            maxTokens: maxTokens || 200,
            signal,
          })) {
            chunkCount++
            if (chunk && typeof chunk.type === 'string') kinds[chunk.type] = (kinds[chunk.type] || 0) + 1
            if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
            if (chunk && chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string' && !out) out += chunk.block.text
            if (chunk && chunk.type === 'finish') break
          }
        } catch (e) {
          debugLog('classifier A stream failed: ' + (e && e.message))
        }
        const trimmed = out.trim()
        if (!trimmed) {
          debugLog('classifier A empty: chunks=' + chunkCount + ' kinds=' + JSON.stringify(kinds))
        } else if (chunkCount > 0) {
          debugLog('classifier A output len=' + trimmed.length + ' head=' + JSON.stringify(trimmed.slice(0, 120)))
        }
        return trimmed || null
      })()
      return await withTimeout(consumed, CLASSIFY_TIMEOUT_MS)
    }
    async function decideAndKeywords(agent, query, signal) {
      const recent = recentRoundsText(agent, CLASSIFY_ROUNDS)
      const isFirst = !hasPreviousUser(agent)
      const input = buildClassifierInput(query, recent, isFirst)
      if (subagents !== undefined) {
        try {
          const childRec = await ensureClassifierChild(agent, input, signal)
          if (childRec && childRec.childId) {
            const out = await askClassifierB(agent, childRec.childId, input, signal, childRec.fresh === true)
            const parsed = out ? parseClassifierOutput(out) : null
            if (parsed) return Object.assign(parsed, { channel: 'subagent' })
            debugLog('classifier B unparsable, fallback A')
          }
        } catch (e) {
          debugLog('classifier B failed: ' + (e && e.message))
        }
      }
      if (llm !== undefined) {
        const out = await askClassifierA(agent, input, signal)
        const parsed = out ? parseClassifierOutput(out) : null
        if (parsed) return Object.assign(parsed, { channel: 'inline' })
        debugLog('classifier A unparsable, fallback')
      }
      return { intent: 'shift', task: 'normal', keywords: tokenize(query).slice(0, 10), channel: 'fallback' }
    }

    async function buildMemoryContext(agent, query, limit) {
      if (!agent || !agent.session || !agent.session.header) return null
      const wpath = workspaceFor(agent.session.header.cwd)
      if (!wpath) return null
      if (!(await isEnabledFresh(wpath))) return null
      const state = ensureState(wpath)
      await loadDb(wpath)
      const hits = searchEntries(state.db.entries, query, limit)
      if (hits.length === 0) return null
      addSurfaced(agent.session.header.id, 'memory', hits.map((h) => h.question + '\n' + h.answer))
      const lines = []
      lines.push('【历史记忆参考 · 项目记忆库】以下是从本项目记忆库中自动检索到的相关历史问答，请先阅读：')
      hits.forEach((h, i) => {
        lines.push('')
        lines.push('[' + (i + 1) + '] 时间: ' + iso(h.time))
        if (h.sessionTitle) {
          const evo = titleEvolutionText(state.db, h.sessionId)
          lines.push('会话: ' + h.sessionTitle + (evo ? '（' + evo + '）' : ''))
        }
        lines.push('问: ' + String(h.question).slice(0, 800))
        lines.push('答: ' + String(h.answer).slice(0, 1500))
      })
      lines.push('')
      lines.push('请以以上记忆为背景参考判断用户意图，再回答用户当前的问题；若记忆与当前问题无关则忽略。')
      return {
        id: PLUGIN + '-' + agent.id + '-' + Date.now().toString(36) + '-' + (++msgCounter),
        role: 'user',
        content: [{ type: 'text', text: lines.join('\n') }],
        source: { kind: 'plugin', plugin: PLUGIN, form: 'recall' },
      }
    }

    async function projectListData() {
      const out = []
      for (const w of workspaces) {
        await refreshProject(w.path)
        const state = ensureState(w.path)
        await loadDb(w.path)
        const entries = state.db ? state.db.entries : []
        let first = null
        let last = null
        for (const e of entries) {
          if (first === null || e.time < first) first = e.time
          if (last === null || e.time > last) last = e.time
        }
        out.push({
          workspaceId: w.id,
          title: w.title,
          path: w.path,
          enabled: enabled.get(w.path) === true,
          count: entries.length,
          firstTime: first,
          lastTime: last,
          dbFile: joinPath(w.path, DB_REL),
        })
      }
      return out
    }
    async function collectEntries(projectId, query, from, to) {
      const picked = projectId && projectId !== '' && projectId !== 'all'
        ? workspaces.filter((w) => w.id === projectId)
        : workspaces
      const results = []
      for (const ws of picked) {
        await refreshProject(ws.path)
        const state = ensureState(ws.path)
        await loadDb(ws.path)
        const entries = state.db ? state.db.entries : []
        const scored = query && query.trim() !== ''
          ? searchEntriesScored(entries, query)
          : entries.map((en) => ({ en, score: 0 }))
        for (const s of scored) {
          const t = s.en.time || 0
          if (from !== undefined && t < from) continue
          if (to !== undefined && t > to) continue
          results.push({ en: s.en, score: s.score, ws })
        }
      }
      results.sort((a, b) => b.score - a.score || (b.en.time || 0) - (a.en.time || 0))
      return results
    }
    function parseTimeValue(v) {
      if (v === undefined || v === null || v === '') return undefined
      if (typeof v === 'number') return v
      const n = Number(v)
      if (!Number.isNaN(n)) return n
      const d = Date.parse(String(v))
      return Number.isNaN(d) ? undefined : d
    }
    function addManagedEntry(wpath, question, answer, time, sessionTitle) {
      const state = ensureState(wpath)
      if (!state.db) return null
      const entry = {
        id: 'm' + (++msgCounter) + '-' + Date.now().toString(36) + '-a',
        question: String(question).slice(0, 8000),
        answer: String(answer).slice(0, 20000),
        time,
      }
      if (typeof sessionTitle === 'string' && sessionTitle) entry.sessionTitle = sessionTitle
      state.db.entries.push(entry)
      state.db.keys.add(keyOf(entry))
      trimDb(state)
      queueSave(wpath)
      return entry
    }

    if (webServer) {
      const disposeRoute = webServer.register({
        kind: 'prefix',
        path: ADMIN_PATH,
        handler: async (req, res) => {
          try {
            const rawUrl = req.url || '/'
            const qIndex = rawUrl.indexOf('?')
            const path = qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl
            const queryStr = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : ''
            const query = {}
            for (const pair of queryStr.split('&')) {
              if (!pair) continue
              const eq = pair.indexOf('=')
              const k = eq >= 0 ? pair.slice(0, eq) : pair
              const v = eq >= 0 ? pair.slice(eq + 1) : ''
              try { query[decodeURIComponent(k)] = decodeURIComponent(v) } catch (e) { query[k] = v }
            }
            const method = req.method || 'GET'
            const sendJson = (status, obj) => {
              const body = JSON.stringify(obj)
              res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
              res.end(body)
            }
            const readBody = async () => {
              const parts = []
              for await (const chunk of req) parts.push(chunk.toString('utf8'))
              return parts.join('')
            }
            const readJson = async () => {
              const raw = await readBody()
              if (!raw || raw.trim() === '') return {}
              try { return JSON.parse(raw) } catch (e) { return null }
            }

            if (path === ADMIN_PATH && method === 'GET') {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
              res.end(ADMIN_HTML)
              return
            }
            if (path === ADMIN_PATH + '/api/projects' && method === 'GET') {
              sendJson(200, { ok: true, projects: await projectListData() })
              return
            }
            if (path === ADMIN_PATH + '/api/stats' && method === 'GET') {
              const projects = await projectListData()
              const entries = projects.reduce((s, p) => s + p.count, 0)
              sendJson(200, { ok: true, stats: { projects: projects.length, enabled: projects.filter((p) => p.enabled).length, entries } })
              return
            }
            if (path === ADMIN_PATH + '/api/entries' && method === 'GET') {
              const projectId = typeof query.project === 'string' ? query.project : ''
              const q = typeof query.q === 'string' ? query.q : ''
              const from = parseTimeValue(query.from)
              const to = parseTimeValue(query.to)
              const page = clampInt(Number(query.page), 1, 1000000, 1)
              const pageSize = clampInt(Number(query.pageSize), 1, 100, 20)
              const all = await collectEntries(projectId, q, from, to)
              const total = all.length
              const slice = all.slice((page - 1) * pageSize, page * pageSize)
              sendJson(200, {
                ok: true,
                total,
                page,
                pageSize,
                entries: slice.map((r) => ({
                  id: r.en.id,
                  question: r.en.question,
                  answer: r.en.answer,
                  time: r.en.time,
                  score: r.score,
                  sessionTitle: r.en.sessionTitle || null,
                  projectId: r.ws.id,
                  projectTitle: r.ws.title,
                  projectPath: r.ws.path,
                })),
              })
              return
            }
            if (path === ADMIN_PATH + '/api/entries' && method === 'POST') {
              const body = await readJson()
              if (body === null) { sendJson(400, { ok: false, reason: 'JSON 解析失败' }); return }
              const ws = body && typeof body.projectId === 'string' ? wsById(body.projectId) : undefined
              const question = body && typeof body.question === 'string' ? body.question.trim() : ''
              const answer = body && typeof body.answer === 'string' ? body.answer.trim() : ''
              const time = parseTimeValue(body ? body.time : undefined)
              const missing = []
              if (ws === undefined) missing.push('项目')
              if (!question) missing.push('问题')
              if (!answer) missing.push('回答')
              if (time === undefined) missing.push('时间')
              if (missing.length > 0) { sendJson(400, { ok: false, reason: '缺少必填项: ' + missing.join('、') }); return }
              const entry = addManagedEntry(ws.path, question, answer, time, body && typeof body.sessionTitle === 'string' ? body.sessionTitle : undefined)
              debugLog('admin add: ' + ws.path + ' id=' + entry.id)
              sendJson(200, { ok: true, id: entry.id })
              return
            }
            if (path === ADMIN_PATH + '/api/entries' && method === 'DELETE') {
              const body = await readJson()
              if (body === null || !Array.isArray(body.deletes)) { sendJson(400, { ok: false, reason: '缺少 deletes 数组' }); return }
              let removed = 0
              const byProject = {}
              for (const d of body.deletes) {
                if (!d || typeof d.projectId !== 'string' || typeof d.id !== 'string') continue
                const ws = wsById(d.projectId)
                if (!ws) continue
                if (!byProject[ws.path]) byProject[ws.path] = []
                byProject[ws.path].push(d.id)
              }
              for (const wpath of Object.keys(byProject)) {
                const state = ensureState(wpath)
                await loadDb(wpath)
                const ids = new Set(byProject[wpath])
                const before = state.db.entries.length
                const kept = state.db.entries.filter((en) => !ids.has(en.id))
                removed += before - kept.length
                if (kept.length !== before) {
                  state.db.entries = kept
                  state.db.keys.clear()
                  for (const en of kept) state.db.keys.add(keyOf(en))
                  queueSave(wpath)
                }
              }
              debugLog('admin delete: removed=' + removed)
              sendJson(200, { ok: true, removed })
              return
            }
            if (path === ADMIN_PATH + '/api/entries/import' && method === 'POST') {
              const body = await readJson()
              if (body === null || !body) { sendJson(400, { ok: false, reason: 'JSON 解析失败' }); return }
              const items = Array.isArray(body.items) ? body.items : (Array.isArray(body.entries) ? body.entries : null)
              if (items === null) { sendJson(400, { ok: false, reason: '缺少 items 数组(导出文件请取 entries 字段,或直接提交数组)' }); return }
              let added = 0
              let skipped = 0
              const skippedReasons = []
              for (const item of items) {
                if (!item || typeof item !== 'object') { skipped++; continue }
                const question = typeof item.question === 'string' ? item.question.trim() : ''
                const answer = typeof item.answer === 'string' ? item.answer.trim() : ''
                const time = parseTimeValue(item.time)
                if (!question || !answer || time === undefined) { skipped++; skippedReasons.push('缺少必填项'); continue }
                let ws = body.projectId ? wsById(body.projectId) : undefined
                if (ws === undefined && typeof item.projectId === 'string') ws = wsById(item.projectId)
                if (ws === undefined && typeof item.projectPath === 'string') {
                  ws = workspaces.find((w) => w.path === item.projectPath) || workspaces.find((w) => item.projectPath.startsWith(w.path + '/') || item.projectPath.startsWith(w.path + '\\'))
                }
                if (ws === undefined) { skipped++; skippedReasons.push('无法确定目标项目'); continue }
                await loadDb(ws.path)
                addManagedEntry(ws.path, question, answer, time, typeof item.sessionTitle === 'string' ? item.sessionTitle : undefined)
                added++
              }
              debugLog('admin import: added=' + added + ' skipped=' + skipped)
              sendJson(200, { ok: true, added, skipped, skippedReasons })
              return
            }
            if (path === ADMIN_PATH + '/api/export' && method === 'GET') {
              const projectId = typeof query.project === 'string' ? query.project : ''
              const q = typeof query.q === 'string' ? query.q : ''
              const from = parseTimeValue(query.from)
              const to = parseTimeValue(query.to)
              const all = await collectEntries(projectId, q, from, to)
              const payload = {
                exportedAt: new Date().toISOString(),
                source: 'memory-db-admin',
                count: all.length,
                entries: all.map((r) => {
                  const en = {
                    question: r.en.question,
                    answer: r.en.answer,
                    time: r.en.time,
                    projectId: r.ws.id,
                    projectPath: r.ws.path,
                    projectTitle: r.ws.title,
                  }
                  if (r.en.sessionTitle) en.sessionTitle = r.en.sessionTitle
                  return en
                }),
              }
              const stamp = new Date().toISOString().replace(/[:.]/g, '-')
              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': 'attachment; filename="memory-db-export-' + stamp + '.json"',
              })
              res.end(JSON.stringify(payload, null, 2))
              return
            }
            if (path === ADMIN_PATH + '/api/titles' && method === 'GET') {
              const projectId = typeof query.project === 'string' ? query.project : ''
              const picked = projectId && projectId !== '' && projectId !== 'all'
                ? workspaces.filter((w) => w.id === projectId)
                : workspaces
              const out = []
              for (const ws of picked) {
                const state = ensureState(ws.path)
                await loadDb(ws.path)
                const history = state.db ? state.db.titleHistory : new Map()
                for (const [sid, arr] of history) {
                  const cur = state.db.sessionTitles.get(sid)
                  out.push({
                    sessionId: sid,
                    sessionTitle: cur ? cur.title : (arr.length > 0 ? arr[arr.length - 1].title : null),
                    history: arr,
                  })
                }
              }
              sendJson(200, { ok: true, titles: out })
              return
            }
            if (path === ADMIN_PATH + '/api/dedupe' && method === 'POST') {
              const body = await readJson()
              const targets = body && typeof body.projectId === 'string' && body.projectId !== '' && body.projectId !== 'all'
                ? workspaces.filter((w) => w.id === body.projectId)
                : workspaces
              let removed = 0
              for (const ws of targets) {
                const state = ensureState(ws.path)
                await loadDb(ws.path)
                const seen = new Map()
                const keep = []
                for (const en of state.db.entries) {
                  const k = String(en.question || '') + '\u0000' + String(en.answer || '')
                  if (seen.has(k)) { removed++ }
                  else { seen.set(k, en); keep.push(en) }
                }
                if (keep.length !== state.db.entries.length) {
                  state.db.entries = keep
                  state.db.keys.clear()
                  for (const en of keep) state.db.keys.add(keyOf(en))
                  queueSave(ws.path)
                }
              }
              debugLog('admin dedupe: removed=' + removed)
              sendJson(200, { ok: true, removed })
              return
            }
            if (path === ADMIN_PATH + '/api/clear' && method === 'DELETE') {
              const body = await readJson()
              const ws = body && typeof body.projectId === 'string' ? wsById(body.projectId) : undefined
              if (ws === undefined) { sendJson(400, { ok: false, reason: '缺少 projectId' }); return }
              const state = ensureState(ws.path)
              await loadDb(ws.path)
              const removed = state.db.entries.length
              state.db.entries = []
              state.db.keys.clear()
              state.db.titleHistory.clear()
              state.db.sessionTitles.clear()
              queueSave(ws.path)
              debugLog('admin clear: ' + ws.path + ' removed=' + removed)
              sendJson(200, { ok: true, removed })
              return
            }
            if (path === ADMIN_PATH + '/api/project-toggle' && method === 'POST') {
              const body = await readJson()
              const ws = body && typeof body.projectId === 'string' ? wsById(body.projectId) : undefined
              const enabledNow = body && typeof body.enabled === 'boolean' ? body.enabled : undefined
              if (ws === undefined || enabledNow === undefined) { sendJson(400, { ok: false, reason: '缺少 projectId 或 enabled' }); return }
              await setProjectEnabled(ws.path, enabledNow)
              sendJson(200, { ok: true, enabled: enabledNow })
              return
            }
            sendJson(404, { ok: false, reason: 'not found: ' + path })
          } catch (e) {
            try {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, reason: e instanceof Error ? e.message : String(e) }))
            } catch (e2) { /* ignore */ }
          }
        },
      })
      ctx.effect(() => disposeRoute)
      debugLog('admin route registered at ' + ADMIN_PATH)
    } else {
      debugLog('webServer not mounted, admin page unavailable')
    }

    // ── 客户端 JSON API:静态版客户端通道(替代动态版 harness.handle) ──
    if (webServer) {
      const disposeApi = webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          const send = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(body))
          }
          if ((req.method || 'GET') !== 'POST') { send(405, { ok: false, reason: 'method-not-allowed' }); return }
          let raw = ''
          try { for await (const chunk of req) raw += chunk } catch { send(400, { ok: false, reason: 'read-failed' }); return }
          let request
          try { request = JSON.parse(raw) } catch { send(400, { ok: false, reason: 'bad-json' }); return }
          const method = request && typeof request.method === 'string' ? request.method : ''
          const args = request && typeof request.args === 'object' && request.args !== null ? request.args : {}
          try { send(200, await dispatch(method, args)) } catch (error) { send(200, { ok: false, reason: error instanceof Error ? error.message : String(error) }) }
        },
      })
      ctx.effect(() => disposeApi)
      debugLog('client api route registered at ' + ROUTE_PATH)
    }
    async function dispatch(method, args) {
      switch (method) {
        case 'state': {
          const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined
          const agent = sessionId !== undefined && agents !== undefined ? agents.get(sessionId) : undefined
          const cwd = agent && agent.session && agent.session.header ? agent.session.header.cwd : undefined
          const wpath = typeof cwd === 'string' ? workspaceFor(cwd) : undefined
          const ws = wpath !== undefined ? workspaces.find((w) => w.path === wpath) : undefined
          if (wpath !== undefined) await refreshProject(wpath)
          const resolved = ws ? ((await tableEnabled(ws.id, wpath)) ?? ((configCache.get(wpath) || {}).enabled) ?? DEFAULT_ENABLED) : (await readDefaultEnabled())
          let title = null
          if (ws && workspaceRegistry) {
            const rec = workspaceRegistry.get(ws.id)
            if (rec) title = rec.title
          }
          return { ok: true, workspaceId: ws ? ws.id : null, title, enabled: resolved, defaultEnabled: await readDefaultEnabled(), storage: table === null ? (openError || 'unavailable') : 'ok' }
        }
        case 'set-enabled': {
          const wsId = typeof args.workspaceId === 'string' && args.workspaceId !== '' ? args.workspaceId : undefined
          const enabledNow = typeof args.enabled === 'boolean' ? args.enabled : undefined
          if (enabledNow === undefined) return { ok: false, reason: 'bad args' }
          const ws = wsId !== undefined ? workspaces.find((w) => w.id === wsId) : undefined
          if (ws === undefined) return { ok: false, reason: 'workspace not found' }
          await setProjectEnabled(ws.path, enabledNow)
          return { ok: true, enabled: enabledNow }
        }
        case 'get-default':
          return { ok: true, enabled: await readDefaultEnabled(), storage: table === null ? (openError || 'unavailable') : 'ok' }
        case 'set-default': {
          const enabledNow = typeof args.enabled === 'boolean' ? args.enabled : undefined
          if (enabledNow === undefined) return { ok: false, reason: 'bad args' }
          await ctx.settings.mutate(SETTINGS_NS, [{ op: 'set', path: ['defaultEnabled'], value: enabledNow }])
          if (!enabledNow) {
            for (const w of workspaces) {
              const eff = await tableEnabled(w.id, w.path)
              if (eff !== true) cleanupClassifiersForProject(w.path).catch((e) => debugLog('classifier cleanup trigger failed: ' + (e && e.message)))
            }
          }
          return { ok: true, enabled: enabledNow }
        }
        case 'open-admin': {
          if (subprocess === undefined) return { ok: false, reason: 'subprocess 服务不可用' }
          const host = webServer !== undefined ? webServer.host : '127.0.0.1'
          const port = webServer !== undefined ? webServer.port : 3080
          const url = 'http://' + host + ':' + port + ADMIN_PATH
          const cwd = workspaces.length > 0 ? workspaces[0].path : 'C:\\'
          subprocess.spawn({ argv: ['cmd.exe', '/c', 'start', '', url], cwd, stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' }, graceMs: 2000 })
          debugLog('open-admin: ' + url)
          return { ok: true, url }
        }
        default:
          return { ok: false, reason: 'unknown method: ' + method }
      }
    }


    const memorySearchTool = {
      name: 'memory_search',
      description: '在本项目记忆库中按关键词直接搜索历史问答记录(用户提问、模型回答、发生时间、会话标题及标题变更历史)。关键词支持中英文词语/短语，命中即返回、按时间近到远排序。项目未开启记忆库时返回 enabled=false。',
      parameters: {
        type: 'object',
        properties: {
          keywords: { type: 'string', description: '搜索关键词，可以是词语、短语或句子片段' },
          limit: { type: 'integer', description: '返回的最大记录数，默认 20' },
        },
        required: ['keywords'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            project: { type: 'string' },
            count: { type: 'integer' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  question: { type: 'string' },
                  answer: { type: 'string' },
                  time: { type: 'string' },
                  sessionTitle: { type: 'string' },
                  titleHistoryText: { type: 'string' },
                },
                required: ['question', 'answer', 'time'],
              },
            },
          },
          required: ['enabled', 'project', 'count', 'results'],
        },
        render(args, value) {
          const lines = []
          if (!value.enabled) {
            lines.push('当前项目未开启记忆数据库(enabled=false)。')
            lines.push('开启方式: 点击会话顶部「记忆库」开关，或在项目根目录 .dsh/memory-db/config.json 写入 {"enabled": true}。')
            return [{ type: 'text', text: lines.join('\n') }]
          }
          lines.push('记忆库检索结果(项目: ' + value.project + '，共 ' + value.count + ' 条):')
          value.results.forEach((r, i) => {
            lines.push('')
            lines.push('[' + (i + 1) + '] 时间: ' + r.time + (r.sessionTitle ? ' ｜ 会话: ' + r.sessionTitle : ''))
            if (r.titleHistoryText) lines.push('  ' + r.titleHistoryText)
            lines.push('问: ' + r.question)
            lines.push('答: ' + r.answer)
          })
          if (value.count === 0) lines.push('未找到相关记录，可尝试更换关键词。')
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const empty = { enabled: false, project: '', count: 0, results: [] }
        const agent = exec.agent
        if (!agent || !agent.session || !agent.session.header) return empty
        const wpath = workspaceFor(agent.session.header.cwd)
        if (!wpath) return empty
        if (!(await isEnabledFresh(wpath))) return { enabled: false, project: wpath, count: 0, results: [] }
        exec.signal.throwIfAborted()
        const state = ensureState(wpath)
        await loadDb(wpath)
        exec.signal.throwIfAborted()
        const kw = typeof args.keywords === 'string' ? args.keywords : ''
        const limit = clampInt(args.limit, 1, 50, 20)
        const kws = kw.split(/[,，;；、\s]+/).filter(Boolean).slice(0, 10)
        const hits = searchByKeywords(state.db.entries, kws)
        addSurfaced(agent.session.header.id, 'memory', hits.map((h) => h.question + '\n' + h.answer))
        return {
          enabled: true,
          project: wpath,
          count: hits.length,
          results: hits.map((h) => {
            const r = {
              question: String(h.question).slice(0, 4000),
              answer: String(h.answer).slice(0, 8000),
              time: iso(h.time),
            }
            if (h.sessionTitle) r.sessionTitle = h.sessionTitle
            const evo = titleEvolutionText(state.db, h.sessionId)
            if (evo) r.titleHistoryText = evo
            return r
          }),
        }
      },
    }
    ctx.tools.register(memorySearchTool)

    const memoryAdminTool = {
      name: 'memory_admin',
      description: '管理当前项目的记忆数据库开关: enable 开启、disable 关闭、status 查看状态。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['enable', 'disable', 'status'], description: '操作: enable / disable / status' },
        },
        required: ['action'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string' },
            project: { type: 'string' },
            enabled: { type: 'boolean' },
            note: { type: 'string' },
          },
          required: ['action', 'project', 'enabled', 'note'],
        },
        render(args, value) {
          const lines = []
          lines.push('记忆库: ' + (value.enabled ? '已开启' : '已关闭'))
          lines.push('项目: ' + value.project)
          if (value.note) lines.push(value.note)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const action = args.action === 'enable' || args.action === 'disable' ? args.action : 'status'
        const agent = exec.agent
        const noProject = { action, project: '', enabled: false, note: '无法确定当前项目(未找到所属工作区)' }
        if (!agent || !agent.session || !agent.session.header) return noProject
        const wpath = workspaceFor(agent.session.header.cwd)
        if (!wpath) return { action, project: String(agent.session.header.cwd), enabled: false, note: '当前目录不属于任何已注册工作区' }
        const cfg = await readConfig(wpath)
        if (action === 'status') {
          const resolved = (await isEnabledFresh(wpath))
          const budgets = await computeBudgets(agent, 'normal')
          const lightCap = Math.min(Math.round(budgets.window * SINGLE_RATIO), budgets.available)
          const st = stats.get(wpath) || {}
          const intentKeys = Object.keys(st.intents || {})
          const intentText = intentKeys.length > 0 ? intentKeys.map((k) => k + '=' + st.intents[k]).join(',') : '暂无'
          const budgetText = [
            '生效窗口 ' + budgets.window + '(' + budgets.windowSource + ')',
            '已用≈' + budgets.used + ' 可用=' + budgets.available,
            '内容预算(历史+记忆)=' + budgets.contentCap + '(60%×窗口)',
            '标准注入上限=' + budgets.injectCap + '(40%∩可用)',
            '轻量注入上限=' + lightCap + '(5%∩可用)',
            '历史预算=' + budgets.historyCap + '(内容上限−注入量)',
            '分类通道: B=' + (subagents !== undefined ? (classifierProviderName || 'pending') : 'unavailable') + ' A=' + (llm !== undefined ? 'ok' : 'unavailable') + ' 子代理=' + classifierChildIds.size + ' 最近判定=' + ((st.lastDecision) || '-'),
            '压缩: ' + (st.compactions || 0) + ' 次' + (st.lastCompactAt ? (' 最近 ' + new Date(st.lastCompactAt).toLocaleTimeString()) : '') + ' 历史预算=' + budgets.historyCap + '(内容上限−注入量)',
            '统计: 注入' + (st.injections || 0) + ' 去重' + (st.dedupeHits || 0) + ' 判定[' + intentText + ']',
          ].join('; ')
          const note = (resolved
            ? '记忆库已开启，数据库文件: .dsh/memory-db/memory.json；开关存储: ' + (table === null ? (openError || '不可用(回退文件配置)') : 'memory_db 域') + '；管理网页: http://127.0.0.1:3080/memory-db-admin'
            : '记忆库未开启。开启: 点击会话顶部「记忆库」开关，或用本工具 enable。开关存储: ' + (table === null ? (openError || '不可用(回退文件配置)') : 'memory_db 域') + (cfg.exists ? '' : '；旧配置文件不存在')) + '；预算: ' + budgetText
          return {
            action,
            project: wpath,
            enabled: resolved,
            note,
          }
        }
        await setProjectEnabled(wpath, action === 'enable')
        return {
          action,
          project: wpath,
          enabled: action === 'enable',
          note: action === 'enable' ? '已开启：开始自动收集对话，并回填该项目历史会话' : '已关闭：停止收集。记忆数据保留在 .dsh/memory-db/memory.json',
        }
      },
    }
    ctx.tools.register(memoryAdminTool)



    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (!decision || decision.kind === 'reject') return decision
      try {
        if (payload.step !== 1) return decision
        const agent = payload.agent
        const sid = agent && agent.session && agent.session.header ? agent.session.header.id : ''
        if (sid && classifierChildIds.has(sid)) return decision
        // 仅主会话:子代理会话不跑分类器、不注入记忆
        if (isSubagentSession(agent && agent.session)) return decision
        const query = userTextOf(payload.messages)
        if (!query) return decision
        const wpath = workspaceFor(agent.session.header.cwd)
        if (!wpath) return decision
        // 日志根目录跟随最近活跃会话的项目(定时器回调里拿不到 initiator,故在此更新)
        if (wpath !== debugRoot) debugRoot = wpath
        if (!(await isEnabledFresh(wpath))) return decision
        const verdict = await decideAndKeywords(agent, query, payload.signal)
        const curSt = stats.get(wpath) || {}
        const intents = Object.assign({}, curSt.intents)
        intents[verdict.intent] = (intents[verdict.intent] || 0) + 1
        bumpStats(wpath, {
          lastDecision: verdict.intent + (verdict.intent === 'shift' ? '/' + verdict.task : ''),
          lastChannel: verdict.channel,
          lastKeywords: verdict.keywords,
          intents,
        })
        debugLog('classifier: ' + verdict.intent + (verdict.intent === 'shift' ? '/' + verdict.task : '') + ' via ' + verdict.channel)
        if (verdict.intent === 'continue') return decision
        const inject = await buildInjection(agent, wpath, verdict, query, payload.signal)
        if (!inject || !inject.text) return decision
        await maybeCompact(agent, wpath, inject.budgets, inject.text, payload.signal)
        const prevInj = lastInjectedText(agent)
        if (prevInj === inject.text) {
          const c3 = stats.get(wpath) || {}
          bumpStats(wpath, { dedupeHits: (c3.dedupeHits || 0) + 1 })
          debugLog('pre-step: dedupe reuse (no append) for ' + agent.id)
          return decision
        }
        const ctxMsg = {
          id: PLUGIN + '-' + agent.id + '-' + Date.now().toString(36) + '-' + (++msgCounter),
          role: 'user',
          content: [{ type: 'text', text: inject.text }],
          source: { kind: 'plugin', plugin: PLUGIN, form: 'recall' },
        }
        const already = decision.messages.some((m) => m && m.source && m.source.kind === 'plugin' && m.source.plugin === PLUGIN)
        if (already) return decision
        let idx = decision.messages.length - 1
        for (let i = decision.messages.length - 1; i >= 0; i--) {
          if (payload.messages.includes(decision.messages[i])) { idx = i; break }
        }
        const messages = [...decision.messages]
        messages.splice(idx + 1, 0, ctxMsg)
        const cur2 = stats.get(wpath) || {}
        bumpStats(wpath, { injections: (cur2.injections || 0) + 1, lastMode: inject.mode })
        debugLog('pre-step: injected memory context for ' + agent.id)
        return { kind: 'enter', messages }
      } catch (e) {
        debugLog('pre-step injection failed: ' + (e && e.message))
        return decision
      }
    })

    ctx.on('session/event', (session, event) => {
      try {
        const header = session && session.header
        if (!header || !event || !event.data) return
        if (classifierChildIds.has(header.id)) return
        // 仅主会话:子代理会话的问答不入库
        if (isSubagentSession(session)) return
        const wpath = workspaceFor(header.cwd)
        if (!wpath || !enabled.get(wpath)) return
        if (wpath !== debugRoot) debugRoot = wpath
        if (event.type === 'session/title') {
          handleTitleEvent(wpath, header.id, event).catch((e) => debugLog('title event failed: ' + (e && e.message)))
          return
        }
        if (event.type === 'turn/start') {
          pendingTurns.set(header.id, { turn: event.data.turn, question: '', answer: '', time: 0 })
          loadDb(wpath).catch(() => {})
          return
        }
        if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') return
        const pending = pendingTurns.get(header.id)
        if (!pending) return
        if (event.type === 'user/message') {
          const m = event.data
          if (m && m.source && m.source.kind === 'user') {
            const t = textOf(m.content)
            if (t) pending.question = pending.question ? pending.question + '\n' + t : t
          }
        } else if (event.type === 'assistant/message') {
          const m = event.data.message
          if (m && m.source && m.source.kind === 'model') {
            const t = textOf(m.content)
            if (t) { pending.answer = t; pending.time = event.time }
          }
        } else if (event.type === 'turn/end' && event.data.turn === pending.turn) {
          const q = (pending.question || '').trim()
          const a = (pending.answer || '').trim()
          let titleNow
          const db = ensureState(wpath).db
          if (db) {
            const st = db.sessionTitles.get(header.id)
            if (st) titleNow = st.title
          }
          if (titleNow === undefined && sessionTitle !== undefined && session !== undefined) {
            const snap = sessionTitle.get(session)
            if (snap) titleNow = snap.title
          }
          const ok = !!(q && a && pending.time) && recordPair(wpath, header.id, pending.turn, q, a, pending.time, titleNow)
          if (ok) debugLog('collected pair: ' + header.id + ' turn=' + pending.turn)
          pendingTurns.delete(header.id)
        }
      } catch (e) {
        debugLog('collect failed: ' + (e && e.message))
      }
    })

    ctx.on('tools/result', (exec, result) => {
      try {
        const name = exec && exec.name
        if (!name || !(name === 'web_search' || name === 'web_fetch' || name.startsWith('web_'))) return
        const agent = exec.agent
        if (!agent || !agent.session || !agent.session.header) return
        if (isSubagentSession(agent.session)) return
        const frags = textOf(result && result.content)
        if (frags) addSurfaced(agent.session.header.id, 'web', frags)
      } catch (e) {
        debugLog('web fragment tracking failed: ' + (e && e.message))
      }
    })

    if (systemPrompt) {
      systemPrompt.section({
        name: 'memory-db:workflow',
        order: 150,
        text: (context) => {
          try {
            const agent = context && context.agent
            if (!agent || !agent.session || !agent.session.header) return ''
            const csid = agent && agent.session && agent.session.header ? agent.session.header.id : ''
            if (csid && classifierChildIds.has(csid)) return ''
            // 仅主会话:子代理不注入记忆库工作流提示段
            if (isSubagentSession(agent.session)) return ''
            const wpath = workspaceFor(agent.session.header.cwd)
            if (!wpath || !enabled.get(wpath)) return ''
            return [
              '## 项目记忆库工作流',
              '当前项目已开启「记忆数据库」功能。处理用户的每个任务时遵循以下工作流：',
              '1. 接到用户任务；',
              '2. 每个用户回合开始时，系统会自动检索记忆库并注入一条「历史记忆参考」消息，请优先阅读；如需更深入的检索，使用 memory_search 工具按关键词模糊搜索；',
              '3. 阅读检索到的历史问答对及其发生时间、会话标题与标题变更历史；',
              '4. 以历史记忆为背景参考，判断用户意图，结合记忆内容回答用户的问题。',
              '要求：',
              '- 记忆与当前问题无关或不足时，正常回答即可，不要虚构记忆；',
              '- 不要将记忆检索的中间过程写入最终答案。',
              '- 记忆库管理网页: http://127.0.0.1:3080/memory-db-admin',
            ].join('\n')
          } catch (e) {
            return ''
          }
        },
      })
    }

    await refreshProjects()
    await migrateLegacySettings().catch((e) => debugLog('migrate trigger failed: ' + (e && e.message)))
    try {
      const initiator = agents && typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : undefined
      debugLog('apply: initiator=' + (initiator ? initiator.id : 'none'))
      if (initiator && initiator.session && initiator.session.header && initiator.session.header.cwd) {
        const wpath = workspaceFor(initiator.session.header.cwd)
        if (wpath) {
          const ws = workspaces.find((w) => w.path === wpath)
          const cfg = await readConfig(wpath)
          const decided = ws ? tableEnabled(ws.id) : undefined
          if (decided === undefined && !cfg.exists) {
            await setProjectEnabled(wpath, true)
            debugLog('auto-enabled for project ' + wpath)
          } else if (decided === undefined && cfg.exists && !cfg.enabled) {
            debugLog('project ' + wpath + ' has legacy config enabled=false, left untouched')
          }
        }
      }
    } catch (e) {
      debugLog('auto-enable failed: ' + (e && e.message))
    }
    await refreshProjects()
    for (const w of workspaces) {
      if (enabled.get(w.path) === true) await loadDb(w.path).catch(() => {})
    }
    primeLiveSessions()
    ctx.interval(() => {
      refreshProjects().catch((e) => debugLog('interval refresh failed: ' + (e && e.message)))
    }, REFRESH_MS)
    debugLog('plugin active. storage=' + (table === null ? (openError || 'unavailable') : 'memory_db ok') + ' web=' + (webServer !== undefined ? ADMIN_PATH : 'unavailable'))
  }
}

export default MemoryDbService

// 提取 pre-step 消息中真实用户的提问
function userTextOf(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  const parts = []
  for (const m of messages) {
    if (m && m.source && m.source.kind === 'user') {
      const t = textOf2(m.content)
      if (t) parts.push(t)
    }
  }
  return parts.join('\n')
}
function textOf2(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const b of content) {
    if (b && b.type === 'text' && typeof b.text === 'string' && b.text) parts.push(b.text)
  }
  return parts.join('\n').trim()
}