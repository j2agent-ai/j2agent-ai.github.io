<script setup>
import { computed, ref, watch } from 'vue'

const toast = ref('')
const activeFeature = ref('rag')
const readerOpen = ref(false)
const docSearch = ref('')
const docsLoading = ref(false)
const docLoading = ref(false)
const docError = ref('')
const docs = ref([])
const selectedDoc = ref('README.md')
const docHtml = ref('')

const repoApi = 'https://api.github.com/repos/j2agent-ai/j2agent-docs/git/trees/main?recursive=1'
const rawBase = 'https://raw.githubusercontent.com/j2agent-ai/j2agent-docs/main/'
const fallbackDocs = [
  ['README.md', '文档中心'],
  ['平台/RAG机制/README.md', 'RAG 机制'],
  ['平台/RAG机制/融合检索.md', '融合检索'],
  ['平台/通用助手/README.md', '平台通用助手'],
  ['平台/聊天后台任务与重连恢复/README.md', '流式聊天与断线恢复'],
  ['平台/agent记忆机制/对话记忆.md', '对话记忆'],
  ['平台/agent-ui交互机制/README.md', 'Agent-UI 交互机制'],
  ['平台/安全与用户/用户权限.md', '用户与权限'],
  ['平台/审计/README.md', 'Token 与聊天审计'],
  ['agent开发/文档/Agent开发.md', 'Agent 开发'],
  ['agent开发/文档/MCP.md', 'MCP 接入'],
  ['agent开发/文档/Skill.md', 'Skill 技能'],
]
const filteredDocs = computed(() => docs.value.filter((doc) => doc.title.toLowerCase().includes(docSearch.value.toLowerCase()) || doc.path.toLowerCase().includes(docSearch.value.toLowerCase())))

const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const renderMarkdown = (source) => {
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  let html = '', inCode = false, code = [], list = false
  const closeList = () => { if (list) { html += '</ul>'; list = false } }
  const inline = (text) => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  for (const line of lines) {
    if (line.startsWith('```')) { if (inCode) { html += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`; code = [] } inCode = !inCode; continue }
    if (inCode) { code.push(line); continue }
    if (!line.trim()) { closeList(); continue }
    if (line.startsWith('|')) { closeList(); const cells = line.split('|').slice(1, -1).map((cell) => cell.trim()); if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue; html += `<div class="md-table-row">${cells.map((cell) => `<span>${inline(cell)}</span>`).join('')}</div>`; continue }
    const heading = line.match(/^(#{1,4})\s+(.+)/); if (heading) { closeList(); const level = heading[1].length; html += `<h${level}>${inline(heading[2])}</h${level}>`; continue }
    const quote = line.match(/^>\s?(.*)/); if (quote) { closeList(); html += `<blockquote>${inline(quote[1])}</blockquote>`; continue }
    const item = line.match(/^\s*[-*]\s+(.+)/); if (item) { if (!list) { html += '<ul>'; list = true } html += `<li>${inline(item[1])}</li>`; continue }
    closeList(); html += `<p>${inline(line)}</p>`
  }
  closeList(); if (inCode) html += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`
  return html
}
const loadDocIndex = async () => {
  if (docs.value.length || docsLoading.value) return
  docsLoading.value = true
  try {
    const response = await fetch(repoApi, { headers: { Accept: 'application/vnd.github+json' } })
    if (!response.ok) throw new Error('GitHub API unavailable')
    const data = await response.json()
    docs.value = data.tree.filter((item) => item.type === 'blob' && item.path.toLowerCase().endsWith('.md')).map((item) => ({ path: item.path, title: item.path.split('/').pop().replace(/\.md$/i, '') }))
  } catch { docs.value = fallbackDocs.map(([path, title]) => ({ path, title })); docError.value = 'GitHub 目录暂时不可用，已切换到内置文档目录。' } finally { docsLoading.value = false }
}
const openReader = () => { readerOpen.value = true; loadDocIndex() }
const loadDoc = async (path) => {
  selectedDoc.value = path; docLoading.value = true; docError.value = ''
  try { const response = await fetch(rawBase + path.split('/').map(encodeURIComponent).join('/')); if (!response.ok) throw new Error('Document unavailable'); docHtml.value = renderMarkdown(await response.text()) } catch { docHtml.value = '<p>文档加载失败，请稍后重试，或直接打开 GitHub 文档仓库。</p>'; docError.value = '正文加载失败'; } finally { docLoading.value = false }
}
watch(readerOpen, (open) => { if (open) { loadDocIndex(); if (!docHtml.value) loadDoc(selectedDoc.value) } })
const notify = (message) => {
  toast.value = message
  window.setTimeout(() => (toast.value = ''), 2400)
}
const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

const features = {
  rag: { label: 'RAG 检索增强', title: '让答案有据可依', body: '从文档入库、切片、向量化到召回与来源展示，构成一条完整的知识增强链路。', chips: ['稠密向量', 'BM25 稀疏检索', 'Milvus 融合排序'] },
  agent: { label: 'Agent 编排', title: '让智能体协同完成', body: '通用助手先做意图召回与决策，再按需委派专业子智能体，结果通过同一条流式链路回到用户。', chips: ['多智能体编排', 'ReAct 工具循环', 'Skill / MCP 扩展'] },
  runtime: { label: '可靠运行时', title: '让任务持续可追踪', body: 'UI 只是观察者。任务进入后台队列后，即使刷新、断网或切换页面，Agent 仍会继续执行并支持快照恢复。', chips: ['WebSocket 事件状态机', 'Redis 队列与 Pub/Sub', 'Snapshot 断线恢复'] },
}
</script>

<template>
  <div class="site-shell">
    <header class="topbar glass-panel">
      <a href="#top" class="brand"><img src="/logo-b.svg" alt="J2Agent AI" /></a>
      <nav><a href="#technology">技术能力</a><a href="#product">产品界面</a><a href="#architecture">平台架构</a><a href="#docs" @click.prevent="openReader">文档中心</a></nav>
      <a class="glass-button blue" href="https://j2agent.jerryt92.top/" target="_blank" rel="noreferrer">进入体验 <span>↗</span></a>
    </header>

    <main id="top">
      <section class="hero section-wrap">
        <div class="hero-copy"><div class="eyebrow"><i></i> J2AGENT AI · INTELLIGENT WORK PLATFORM</div><h1>把大模型的能力，<br /><span>接入真实工作。</span></h1><p>J2Agent 将 Agent、工具、企业知识与可观测运行时连接起来，让 AI 从“会回答”走向“能完成”。</p><div class="hero-actions"><a class="glass-button blue large" href="https://j2agent.jerryt92.top/" target="_blank" rel="noreferrer">进入体验 <b>↗</b></a><button class="link-button" @click="jump('product')">查看产品界面 <b>↓</b></button></div><div class="proof-row"><span>SPRING AI</span><span>WEBSOCKET</span><span>MILVUS</span><span>REDIS</span></div></div>
        <div class="hero-art"><div class="orb orb-blue"></div><div class="orb orb-orange"></div><div class="hero-glass glass-panel"><div class="hero-glass-head"><span class="live-dot"></span> AGENT RUNTIME <em>LIVE</em></div><div class="runtime-state"><div class="state-ring">✦</div><div><strong>正在执行任务</strong><small>universal_assistant · turn_2048</small></div><span class="state-time">00:12</span></div><div class="trace"><div class="trace-item done"><i>✓</i><span>意图召回</span><b>完成</b></div><div class="trace-item done"><i>✓</i><span>调用知识库</span><b>48 docs</b></div><div class="trace-item active"><i>↗</i><span>流式生成答案</span><b>进行中</b></div></div><div class="runtime-input">查找武汉到深圳的最优方案 <button>↑</button></div></div></div>
      </section>

      <section id="technology" class="technology section-wrap"><div class="section-intro"><div><div class="eyebrow">ENGINEERED FOR REAL WORK</div><h2>不是简单接入模型，<br /><span>而是一套完整系统。</span></h2></div><p>从检索质量到任务可靠性，每一层都为真实业务中的可控、可追溯与可扩展而设计。</p></div><div class="tech-layout"><div class="tech-tabs"><button v-for="(feature, key) in features" :key="key" :class="{ selected: activeFeature === key }" @click="activeFeature = key"><span>0{{ Object.keys(features).indexOf(key) + 1 }}</span><strong>{{ feature.label }}</strong><b>↗</b></button></div><div class="tech-detail glass-panel"><div class="detail-kicker">{{ features[activeFeature].label }}</div><h3>{{ features[activeFeature].title }}</h3><p>{{ features[activeFeature].body }}</p><div class="chip-row"><span v-for="chip in features[activeFeature].chips" :key="chip">{{ chip }}</span></div><div class="detail-diagram"><div class="diagram-node">输入</div><i>→</i><div class="diagram-node blue-node">{{ activeFeature === 'rag' ? 'Hybrid Retrieval' : activeFeature === 'agent' ? 'Orchestrator' : 'Background Turn' }}</div><i>→</i><div class="diagram-node">结果</div></div></div></div></section>

      <section id="product" class="product section-wrap"><div class="section-intro"><div><div class="eyebrow">THE PLATFORM IN ACTION</div><h2>一眼看见，<br /><span>每一步都在发生。</span></h2></div><p>统一的玻璃化工作台，承载对话、知识库、检索配置、智能体权限与审计能力。</p></div><div class="screen-grid"><figure class="screen-card wide"><img src="/screens/02-chat-analysis.png" alt="J2Agent 通用 AI 助手与分析结果界面" /><figcaption><strong>通用 AI 助手</strong><span>调用工具，流式输出分析结果</span></figcaption></figure><figure class="screen-card"><img src="/screens/01-task-list.png" alt="J2Agent 智能体任务列表界面" /><figcaption><strong>任务与执行轨迹</strong><span>多任务状态实时可见</span></figcaption></figure><figure class="screen-card"><img src="/screens/04-kb-sync.png" alt="J2Agent 知识库同步状态界面" /><figcaption><strong>知识库同步</strong><span>增量维护，状态清晰可追溯</span></figcaption></figure><figure class="screen-card"><img src="/screens/06-rag-settings.png" alt="J2Agent RAG 检索设置界面" /><figcaption><strong>RAG 参数配置</strong><span>稠密与稀疏权重可调</span></figcaption></figure><figure class="screen-card"><img src="/screens/03-kb-list.png" alt="J2Agent 知识库列表界面" /><figcaption><strong>知识库管理</strong><span>远程仓库与访问权限统一管理</span></figcaption></figure><figure class="screen-card"><img src="/screens/05-chat-audit.png" alt="J2Agent 聊天审计界面" /><figcaption><strong>Token 与会话审计</strong><span>跨用户记录可查询、可复盘</span></figcaption></figure><figure class="screen-card"><img src="/screens/07-agent-management.png" alt="J2Agent 智能体管理界面" /><figcaption><strong>智能体管理</strong><span>权限、插件与全局配置集中维护</span></figcaption></figure></div></section>

      <section id="architecture" class="architecture section-wrap"><div class="arch-copy"><div class="eyebrow">ONE TRACE, FULL CONTROL</div><h2>每一个回答，<br /><span>都有迹可循。</span></h2><p>统一事件信封串起 THINKING、CALLING_TOOL、STREAMING_TEXT 到 COMPLETED 的完整状态迁移；来源、工具调用、Token 用量与会话记录，都可以被审计和复盘。</p><button class="glass-button" @click="openReader">阅读架构文档 <span>↗</span></button></div><div class="arch-stack"><div class="stack-card"><span class="stack-num">01</span><strong>Agent Layer</strong><small>AiAgent · ReAct · 子智能体编排</small></div><div class="stack-card offset"><span class="stack-num">02</span><strong>Knowledge Layer</strong><small>Query Transformer · Hybrid Retrieval · RAG</small></div><div class="stack-card"><span class="stack-num">03</span><strong>Runtime Layer</strong><small>WebSocket · Redis Queue · Snapshot Resume</small></div></div></section>
    </main>
    <section v-if="readerOpen" id="docs" class="reader-overlay" role="dialog" aria-modal="true" aria-label="J2Agent 文档中心">
      <div class="reader-shell glass-panel">
        <header class="reader-head"><div><div class="eyebrow">J2AGENT DOCS · GITHUB</div><h2>文档中心</h2></div><div class="reader-actions"><a href="https://github.com/j2agent-ai/j2agent-docs" target="_blank" rel="noreferrer" class="repo-link">在 GitHub 查看 ↗</a><button class="close-reader" aria-label="关闭文档中心" @click="readerOpen = false">×</button></div></header>
        <div class="reader-body"><aside class="doc-nav"><input v-model="docSearch" type="search" placeholder="搜索文档" aria-label="搜索文档" /><div v-if="docsLoading" class="doc-state">正在读取文档目录…</div><button v-for="doc in filteredDocs" :key="doc.path" :class="{ active: selectedDoc === doc.path }" @click="loadDoc(doc.path)"><span>{{ doc.path.includes('/') ? '·' : '⌂' }}</span>{{ doc.title }}</button><div v-if="!docsLoading && !filteredDocs.length" class="doc-state">没有匹配的文档</div></aside><article class="markdown-view"><div v-if="docError" class="doc-notice">{{ docError }}</div><div v-if="docLoading" class="doc-state">正在加载正文…</div><div v-else v-html="docHtml"></div></article></div>
      </div>
    </section>
    <footer><img src="/logo-b.svg" alt="J2Agent AI" /><span>智能体平台 · 让知识成为可执行的力量</span><span class="footer-right">© 2026 J2Agent</span></footer>
    <transition name="toast"><div v-if="toast" class="toast">{{ toast }}</div></transition>
  </div>
</template>
