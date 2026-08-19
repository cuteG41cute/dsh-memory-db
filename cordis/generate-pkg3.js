// 生成 pkg3-host.js:修复分类子代理"空启动"缺陷
// 1) ensureClassifierChild(agent, firstInput, signal):把首次判定输入内嵌进 startContinuable 启动 prompt
//    返回 {childId, fresh} (复用 child 时 fresh=false)
// 2) askClassifierB 增加 fresh 参数:fresh 时跳过 followup(输入已在启动 prompt)
// 3) decideAndKeywords 适配新签名
const fs = require('fs')
const path = require('path')

const base = path.join(__dirname, 'pkg2-host.js')
const out = path.join(__dirname, 'pkg3-host.js')
let src = fs.readFileSync(base, 'utf8')

const replacements = [
  // --- 1a. ensureClassifierChild 签名 ---
  {
    old: 'async function ensureClassifierChild(agent, signal) {',
    new: 'async function ensureClassifierChild(agent, firstInput, signal) {',
  },
  // --- 1b. 复用分支返回 {childId, fresh:false} ---
  {
    old: 'if (existing && existing.childId) return existing.childId',
    new: 'if (existing && existing.childId) return { childId: existing.childId, fresh: false }',
  },
  // --- 1c. 启动 prompt 内嵌首次判定输入(替换"等待输入"空启动) ---
  {
    old: "prompt: [{ type: 'text', text: classifierSystemPrompt() + '\\n\\n（等待你的第一条判定输入…）' }],",
    new: "prompt: [\n              { type: 'text', text: classifierSystemPrompt() + '\\n\\n（当前回合的判定输入已随本启动消息下发，请直接输出判定 JSON，不要输出任何其他内容）' },\n              { type: 'text', text: String(firstInput || '') },\n            ],",
  },
  // --- 1d. 新创建返回 {childId, fresh:true} ---
  {
    old: "        debugLog('classifier child created: ' + childId + ' for ' + sid)\n        return childId",
    new: "        debugLog('classifier child created: ' + childId + ' for ' + sid + ' (first input embedded)')\n        return { childId, fresh: true }",
  },
  // --- 2a. askClassifierB 签名 ---
  {
    old: 'async function askClassifierB(agent, childId, text, signal) {',
    new: 'async function askClassifierB(agent, childId, text, signal, fresh) {',
  },
  // --- 2b. fresh(首回合)跳过 followup ---
  {
    old: `      try {\n        await subagents.followup(agent, childId, [{ type: "text", text }], {\n          source: { kind: 'coordinator', form: 'relay', senderSessionId: agent.session.header.id },\n          signal,\n        })\n      } catch (e) {\n        debugLog('classifier followup failed: ' + (e && e.message))\n        return null\n      }`,
    new: `      if (!fresh) {\n        try {\n          await subagents.followup(agent, childId, [{ type: "text", text }], {\n            source: { kind: 'coordinator', form: 'relay', senderSessionId: agent.session.header.id },\n            signal,\n          })\n        } catch (e) {\n          debugLog('classifier followup failed: ' + (e && e.message))\n          return null\n        }\n      }`,
  },
  // --- 3. decideAndKeywords 适配 ---
  {
    old: `          const childId = await ensureClassifierChild(agent, signal)\n          if (childId) {\n            const out = await askClassifierB(agent, childId, input, signal)`,
    new: `          const childRec = await ensureClassifierChild(agent, input, signal)\n          if (childRec && childRec.childId) {\n            const out = await askClassifierB(agent, childRec.childId, input, signal, childRec.fresh === true)`,
  },
]

let missing = []
for (const r of replacements) {
  const idx = src.indexOf(r.old)
  if (idx < 0) { missing.push(r.old.slice(0, 80)); continue }
  src = src.split(r.old).join(r.new)
}
if (missing.length > 0) {
  console.error('MISSING ANCHORS:')
  for (const m of missing) console.error('  - ' + m)
  process.exit(1)
}
fs.writeFileSync(out, src, 'utf8')
console.log('pkg3-host.js written, bytes=' + src.length)
