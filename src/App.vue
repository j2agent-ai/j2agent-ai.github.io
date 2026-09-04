<script setup>
import {computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {
	renderMarkdown,
	renderMarkdownBlocks,
	cancelPendingMarkdownRenderWork,
	getMarkdownCodeBlockText,
	preloadDiagramRuntimes
} from './knowledge-qa/j2a/utils/markdownRenderer'
import './knowledge-qa/j2a/styles/markdown.scss'

const KbQaWidget = defineAsyncComponent(() => import('./knowledge-qa/KbQaWidget.vue'))

const copy = {
	docs: '文档中心',
	technology: '技术能力',
	product: '产品界面',
	architecture: '平台架构',
	experience: '进入体验',
	heroEyebrow: 'J2AGENT AI · INTELLIGENT WORK PLATFORM',
	heroTitle: ['把大模型的能力，', '接入真实工作。'],
	heroBody: 'J2Agent 将 Agent、工具、企业知识与可观测运行时连接起来，让 AI 从“会回答”走向“能完成”。',
	viewScreens: '查看产品界面',
	technologyEyebrow: 'ENGINEERED FOR REAL WORK',
	technologyTitle: ['不是简单接入模型，', '而是一套完整系统。'],
	technologyBody: '从检索质量到任务可靠性，每一层都为真实业务中的可控、可追溯与可扩展而设计。',
	productEyebrow: 'THE PLATFORM IN ACTION',
	productTitle: ['一眼看见，', '每一步都在发生。'],
	productBody: '统一的玻璃化工作台，承载对话、知识库、检索配置、智能体权限与审计能力。',
	architectureEyebrow: 'ONE TRACE, FULL CONTROL',
	architectureTitle: ['每一个回答，', '都有迹可循。'],
	architectureBody: '统一事件信封串起 THINKING、CALLING_TOOL、STREAMING_TEXT 到 COMPLETED 的完整状态迁移；来源、工具调用、Token 用量与会话记录，都可以被审计和复盘。',
	readArchitecture: '阅读架构文档',
	runtime: '正在执行任务',
	intent: '意图召回',
	knowledge: '调用知识库',
	answer: '流式生成答案',
	done: '完成',
	active: '进行中',
	input: '查找武汉到深圳的最优方案',
	footer: '智能体平台 · 让知识成为可执行的力量',
	noMatch: '没有匹配的文档',
	loading: '正在加载正文…',
	searchDocs: '搜索已收录文档',
	path: '输入任意 .md 路径',
	open: '打开',
	close: '关闭文档',
	github: '在 GitHub 查看',
	docsTitle: '文档中心'
}

const toast = ref('')
const activeFeature = ref('rag')
const readerOpen = ref(false)
const docSearch = ref('')
const docLoading = ref(false)
const docError = ref('')
const docs = ref([])
const getDocPathFromUrl = () => {
	if (location.hash.split('?')[0] !== '#docs') return ''
	try {
		return new URLSearchParams(location.hash.split('?')[1] || '').get('path') || ''
	} catch {
		return ''
	}
}
const selectedDoc = ref(getDocPathFromUrl() || 'README.md')
const docPath = ref('')
const docHtml = ref('')
const docContentRef = ref(null)
const previewImage = ref('')

const rawBase = 'https://j2agent-ai.jerryt92.top/j2agent-docs/'
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
	['agent开发/文档/工具.md', '工具开发'],
	['agent开发/文档/可选能力.md', '可选能力'],
	['agent开发/文档/README.md', 'Agent 开发入门'],
	['agent开发/agents/0_example-agent/README.md', '示例 Agent'],
	['平台/RAG机制/SimpleRag.md', 'SimpleRag'],
	['平台/RAG机制/静态文件展示机制.md', '静态文件展示'],
	['平台/RAG机制/检索/Query预处理.md', 'Query 预处理'],
	['平台/RAG机制/知识库维护/知识库维护.md', '知识库维护'],
	['平台/LLM提供商配置/README.md', 'LLM 提供商配置'],
	['平台/插件Agent接入与界面/README.md', '插件 Agent 接入'],
	['平台/文件管理与对象存储/README.md', '文件与对象存储'],
	['前端/智能体多任务机制/README.md', '智能体多任务'],
	['前端/md解析器/README.md', 'Markdown 解析器'],
	['基础设施/docker部署/README.md', 'Docker 部署'],
	['dev/rule.md', '开发规则'],
	['基础设施/docker部署/构建与启动.md', '构建与启动'],
	['基础设施/docker部署/离线镜像打包.md', '离线镜像打包'],
	['基础设施/docker部署/目录与数据卷.md', '目录与数据卷'],
	['基础设施/docker部署/前端静态资源更新.md', '前端静态资源更新'],
	['平台/agent记忆机制/README.md', 'Agent 记忆机制'],
	['平台/安全与用户/README.md', '安全与用户'],
	['平台/安全与用户/邮箱注册机制.md', '邮箱注册机制'],
	['平台/聊天图片附件/README.md', '聊天图片附件'],
	['平台/通用助手/子智能体调用与记忆.md', '子智能体调用与记忆'],
	['平台/RAG机制/知识库同步.md', '知识库同步'],
	['平台/RAG机制/检索/README.md', '检索模块'],
	['平台/RAG机制/知识库维护/README.md', '知识库维护模块'],
	['平台/RAG机制/知识库维护/content_segment_chunk_test.md', '知识库分片测试'],
	['前端/md解析器/架构与流程.md', 'Markdown 架构与流程'],
	['前端/md解析器/图表渲染.md', '图表渲染'],
	['前端/md解析器/图表渲染性能优化.md', '图表渲染性能优化'],
	['前端/md解析器/围栏与会话切换架构.md', '围栏与会话切换'],
	['前端/md解析器/渲染机制与Worker隔离.md', 'Worker 隔离渲染'],
	['前端/md解析器/样式约定.md', 'Markdown 样式约定'],
	['原始需求规格/README.md', '原始需求规格'],
]
const filteredDocs = computed(() => docs.value.filter((doc) => doc.title.toLowerCase().includes(docSearch.value.toLowerCase()) || doc.path.toLowerCase().includes(docSearch.value.toLowerCase())))
const collapsedDirs = ref(new Set())
const treeRows = computed(() => {
	const query = docSearch.value.trim().toLowerCase()
	if (query) {
		return filteredDocs.value.map((doc) => ({
			type: 'file',
			name: doc.title,
			path: doc.path,
			depth: 0,
			rootPath: ''
		}))
	}
	const root = {dirs: [], files: []}
	for (const doc of docs.value) {
		const parts = doc.path.split('/').filter(Boolean)
		const fileName = parts.pop() || doc.title
		let node = root
		let nodePath = ''
		for (const part of parts) {
			nodePath = nodePath ? `${nodePath}/${part}` : part
			let dir = node.dirs.find((item) => item.name === part)
			if (!dir) {
				dir = {name: part, path: nodePath, dirs: [], files: []}
				node.dirs.push(dir)
			}
			node = dir
		}
		node.files.push({name: doc.title || fileName, path: doc.path})
	}
	const rows = []
	const walk = (node, depth) => {
		for (const dir of node.dirs) {
			const expanded = !collapsedDirs.value.has(dir.path)
			rows.push({type: 'dir', name: dir.name, path: dir.path, depth, expanded})
			if (expanded) walk(dir, depth + 1)
		}
		for (const file of node.files) {
			rows.push({type: 'file', name: file.name, path: file.path, depth, rootPath: ''})
		}
	}
	walk(root, 0)
	return rows
})
const toggleDocDir = (path) => {
	const next = new Set(collapsedDirs.value)
	if (next.has(path)) next.delete(path); else next.add(path)
	collapsedDirs.value = next
}

const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const resolveDocAsset = (value, docPath) => {
	if (/^(https?:|data:|\/)/.test(value)) return value
	const folder = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/') + 1) : ''
	return rawBase + (folder + value.replace(/^\.\//, '')).split('/').map(encodeURIComponent).join('/')
}
const resolveDocLink = (value, docPath) => {
	const clean = decodeURIComponent(value.split('#')[0].split('?')[0])
	const folder = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/') + 1) : ''
	const parts = (folder + clean.replace(/^\.\//, '')).split('/')
	const normalized = []
	for (const part of parts) {
		if (!part || part === '.') continue;
		if (part === '..') normalized.pop(); else normalized.push(part)
	}
	return normalized.join('/')
}
const prepareDocMarkdown = (source, docPath) => source.replace(
	/!\[([^\]]*)\]\(([^)]+)\)/g,
	(match, alt, url) => `![${alt}](${resolveDocAsset(url.trim(), docPath)})`
)

const renderDocMarkdown = (source, docPath) => {
	let html = renderMarkdown(prepareDocMarkdown(source, docPath))
	// 保留文档中心的站内 Markdown 跳转行为；普通外链仍由 markdownRenderer 处理。
	html = html.replace(/href="([^\"]+\.md(?:#[^\"]*)?)"/gi, (_, url) =>
		`href="#docs" data-doc-path="${escapeHtml(resolveDocLink(url, docPath))}"`
	)
	return html
}
const copyMarkdownBlock = async (button) => {
	const block = button.closest('.md-code-block')
	if (!block) return
	const content = getMarkdownCodeBlockText(block).trimEnd()
	if (!content) return
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(content)
		} else {
			const textarea = document.createElement('textarea')
			textarea.value = content
			textarea.setAttribute('readonly', '')
			textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
			document.body.appendChild(textarea)
			textarea.select()
			if (!document.execCommand('copy')) throw new Error('copy command failed')
			textarea.remove()
		}
		notify('已复制')
	} catch {
		notify('复制失败，请检查浏览器权限')
	}
}
const loadDocIndex = () => {
	if (!docs.value.length) docs.value = fallbackDocs.map(([path, title]) => ({path, title}))
}
const loadDoc = async (path) => {
	selectedDoc.value = path;
	if (location.hash.split('?')[0] === '#docs') {
		history.replaceState(null, '', `#docs?path=${encodeURIComponent(path)}`)
	}
	docLoading.value = true;
	docError.value = ''
	try {
		const response = await fetch(rawBase + path.split('/').map(encodeURIComponent).join('/'));
		if (!response.ok) throw new Error('Document unavailable');
		docHtml.value = renderDocMarkdown(await response.text(), path)
		await nextTick()
		if (docContentRef.value) {
			await renderMarkdownBlocks(docContentRef.value, {
				scrollRoot: docContentRef.value.parentElement,
				concurrency: 4,
				backgroundConcurrency: 2,
				lazy: true,
				prefetchRootMargin: '1600px 0px'
			})
		}
	} catch {
		docHtml.value = '<p>文档加载失败，请稍后重试，或直接打开 GitHub 文档仓库。</p>';
		docError.value = '正文加载失败';
	} finally {
		docLoading.value = false
	}
}
const loadDocByPath = () => {
	const path = docPath.value.trim().replace(/^\//, '')
	if (!path) return
	if (!path.toLowerCase().endsWith('.md')) {
		docError.value = '请输入以 .md 结尾的仓库文件路径';
		return
	}
	if (!docs.value.some((doc) => doc.path === path)) docs.value.unshift({
		path,
		title: path.split('/').pop().replace(/\.md$/i, '')
	})
	loadDoc(path)
}
const handleMarkdownClick = (event) => {
	const clicked = event.target instanceof Element ? event.target : null
	const target = clicked?.closest('.md-code-copy')
	if (target) {
		event.preventDefault()
		void copyMarkdownBlock(target)
		return
	}
	const link = clicked?.closest('a[data-doc-path]')
	if (!link) return
	event.preventDefault()
	loadDoc(link.dataset.docPath)
}
const openReader = () => {
	readerOpen.value = true;
	if (location.hash !== `#docs?path=${encodeURIComponent(selectedDoc.value)}`) {
		history.pushState(null, '', `#docs?path=${encodeURIComponent(selectedDoc.value)}`)
	}
	loadDocIndex()
}
const openDocFromAi = (path) => {
	readerOpen.value = true;
	history.pushState(null, '', `#docs?path=${encodeURIComponent(path)}`)
	loadDocIndex();
	if (!docs.value.some((doc) => doc.path === path)) docs.value.unshift({
		path,
		title: path.split('/').pop().replace(/\.md$/i, '')
	});
	loadDoc(path)
}
const syncReaderRoute = () => {
	readerOpen.value = location.hash.split('?')[0] === '#docs'
	const path = getDocPathFromUrl()
	if (path) selectedDoc.value = path
}
watch(readerOpen, (open) => {
	if (open) {
		loadDocIndex();
		if (!docHtml.value) loadDoc(selectedDoc.value)
	}
})
onMounted(() => {
	syncReaderRoute();
	preloadDiagramRuntimes()
	window.addEventListener('hashchange', syncReaderRoute)
	window.addEventListener('keydown', handleGlobalKeydown)
})
onBeforeUnmount(() => {
	window.removeEventListener('hashchange', syncReaderRoute)
	window.removeEventListener('keydown', handleGlobalKeydown)
	cancelPendingMarkdownRenderWork(docContentRef.value)
})
const notify = (message) => {
	toast.value = message
	window.setTimeout(() => (toast.value = ''), 2400)
}
const jump = (id) => document.getElementById(id)?.scrollIntoView({behavior: 'smooth'})
const openImagePreview = (event) => {
	const image = event.target.closest?.('.screen-card img')
	if (image) previewImage.value = image.currentSrc || image.src
}
const closeImagePreview = () => { previewImage.value = '' }
const handleGlobalKeydown = (event) => { if (event.key === 'Escape') closeImagePreview() }

const features = {
	rag: {
		label: 'RAG 检索增强',
		title: '让答案有据可依',
		body: '从文档入库、切片、向量化到召回与来源展示，构成一条完整的知识增强链路。',
		chips: ['稠密向量', 'BM25 稀疏检索', 'Milvus 融合排序']
	},
	agent: {
		label: 'Agent 编排',
		title: '让智能体协同完成',
		body: '通用助手先做意图召回与决策，再按需委派专业子智能体，结果通过同一条流式链路回到用户。',
		chips: ['多智能体编排', 'ReAct 工具循环', 'Skill / MCP 扩展']
	},
	runtime: {
		label: '可靠运行时',
		title: '让任务持续可追踪',
		body: 'UI 只是观察者。任务进入后台队列后，即使刷新、断网或切换页面，Agent 仍会继续执行并支持快照恢复。',
		chips: ['WebSocket 事件状态机', 'Redis 队列与 Pub/Sub', 'Snapshot 断线恢复']
	}
}
</script>

<template>
	<div class="site-shell" :class="{ 'docs-mode': readerOpen }">
		<header class="topbar glass-panel">
			<a href="#top" class="brand"><img src="/logo-b.svg" alt="J2Agent AI"/></a>
			<nav><a href="#technology">{{ copy.technology }}</a><a href="#product">{{ copy.product }}</a><a
				href="#architecture">{{ copy.architecture }}</a></nav>
			<div class="topbar-actions">
				<button class="glass-button blue docs-entry" type="button" @click="openReader"><svg class="document-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.75h7.1L18 8.2v12.05H6.5zM13.5 3.75V8.2H18M9 12h6M9 15.5h6"/></svg><span>{{ copy.docs }}</span><span aria-hidden="true">↗</span></button>
			</div>
		</header>

		<main id="top">
			<section class="hero section-wrap">
				<div class="hero-copy">
					<div class="eyebrow"><i></i> {{ copy.heroEyebrow }}</div>
					<h1>{{ copy.heroTitle[0] }}<br/><span>{{ copy.heroTitle[1] }}</span></h1>
					<p>{{ copy.heroBody }}</p>
					<div class="hero-actions"><a class="glass-button blue large" href="https://j2agent.jerryt92.top/" target="_blank"
					                             rel="noreferrer">{{ copy.experience }} <b>↗</b></a>
						<button class="link-button" @click="jump('product')">{{ copy.viewScreens }} <b>↓</b></button>
					</div>
					<div class="proof-row"><span>SPRING AI</span><span>WEBSOCKET</span><span>MILVUS</span><span>REDIS</span></div>
				</div>
				<div class="hero-art">
					<div class="orb orb-blue"></div>
					<div class="orb orb-orange"></div>
					<div class="hero-glass glass-panel">
						<div class="hero-glass-head"><span class="live-dot"></span> AGENT RUNTIME <em>LIVE</em></div>
						<div class="runtime-state">
							<div class="state-ring">✦</div>
							<div><strong>{{ copy.runtime }}</strong><small>universal_assistant · turn_2048</small></div>
							<span class="state-time">00:12</span></div>
						<div class="trace">
							<div class="trace-item done"><i>✓</i><span>{{ copy.intent }}</span><b>{{ copy.done }}</b></div>
							<div class="trace-item done"><i>✓</i><span>{{ copy.knowledge }}</span><b>48 docs</b></div>
							<div class="trace-item active"><i>↗</i><span>{{ copy.answer }}</span><b>{{ copy.active }}</b></div>
						</div>
						<div class="runtime-input">{{ copy.input }}
							<button>↑</button>
						</div>
					</div>
				</div>
			</section>

			<section id="technology" class="technology section-wrap">
				<div class="section-intro">
					<div>
						<div class="eyebrow">{{ copy.technologyEyebrow }}</div>
						<h2>{{ copy.technologyTitle[0] }}<br/><span>{{ copy.technologyTitle[1] }}</span></h2></div>
					<p>{{ copy.technologyBody }}</p></div>
				<div class="tech-layout">
					<div class="tech-tabs">
						<button v-for="(feature, key) in features" :key="key" :class="{ selected: activeFeature === key }"
						        @click="activeFeature = key"><span>0{{
								Object.keys(features).indexOf(key) + 1
							}}</span><strong>{{ feature.label }}</strong><b>↗</b></button>
					</div>
					<div class="tech-detail glass-panel">
						<div class="detail-kicker">{{ features[activeFeature].label }}</div>
						<h3>{{ features[activeFeature].title }}</h3>
						<p>{{ features[activeFeature].body }}</p>
						<div class="chip-row"><span v-for="chip in features[activeFeature].chips" :key="chip">{{ chip }}</span></div>
						<div class="detail-diagram">
							<div class="diagram-node">输入</div>
							<i>→</i>
							<div class="diagram-node blue-node">{{
									activeFeature === 'rag' ? 'Hybrid Retrieval' : activeFeature === 'agent' ? 'Orchestrator' : 'Background Turn'
								}}
							</div>
							<i>→</i>
							<div class="diagram-node">结果</div>
						</div>
					</div>
				</div>
			</section>

			<section id="product" class="product section-wrap">
				<div class="section-intro">
					<div>
						<div class="eyebrow">{{ copy.productEyebrow }}</div>
						<h2>{{ copy.productTitle[0] }}<br/><span>{{ copy.productTitle[1] }}</span></h2></div>
					<p>{{ copy.productBody }}</p></div>
				<div class="screen-grid" @click="openImagePreview">
					<figure class="screen-card wide"><img src="/screens/02-chat-analysis.png"
					                                      alt="J2Agent 通用 AI 助手与分析结果界面"/>
						<figcaption><strong>通用 AI 助手</strong><span>调用工具，流式输出分析结果</span></figcaption>
					</figure>
					<figure class="screen-card"><img src="/screens/01-task-list.png" alt="J2Agent 智能体任务列表界面"/>
						<figcaption><strong>任务与执行轨迹</strong><span>多任务状态实时可见</span></figcaption>
					</figure>
					<figure class="screen-card"><img src="/screens/03-kb-list.png" alt="J2Agent 知识库列表界面"/>
						<figcaption><strong>知识库管理</strong><span>远程仓库与访问权限统一管理</span></figcaption>
					</figure>
					<figure class="screen-card"><img src="/screens/04-kb-sync.png" alt="J2Agent 知识库同步状态界面"/>
						<figcaption><strong>知识库同步</strong><span>增量维护，状态清晰可追溯</span></figcaption>
					</figure>
					<figure class="screen-card"><img src="/screens/05-chat-audit.png" alt="J2Agent RAG 检索设置界面"/>
						<figcaption><strong>RAG 参数配置</strong><span>稠密与稀疏权重可调</span></figcaption>
					</figure>
					<figure class="screen-card"><img src="/screens/06-rag-settings.png" alt="J2Agent 聊天审计界面"/>
						<figcaption><strong>Token 与会话审计</strong><span>跨用户记录可查询、可复盘</span></figcaption>
					</figure>
					<figure class="screen-card"><img src="/screens/07-agent-management.png" alt="J2Agent 智能体管理界面"/>
						<figcaption><strong>智能体管理</strong><span>权限、插件与全局配置集中维护</span></figcaption>
					</figure>
				</div>
			</section>
			<div v-if="previewImage" class="image-preview-overlay" role="dialog" aria-modal="true"
			     @click.self="closeImagePreview">
				<button class="image-preview-close" type="button" aria-label="Close image preview"
				        @click="closeImagePreview">×</button>
				<img :src="previewImage" alt="J2Agent product screenshot preview" @click.stop/>
			</div>

			<section id="architecture" class="architecture section-wrap">
				<div class="arch-copy">
					<div class="eyebrow">{{ copy.architectureEyebrow }}</div>
					<h2>{{ copy.architectureTitle[0] }}<br/><span>{{ copy.architectureTitle[1] }}</span></h2>
					<p>{{ copy.architectureBody }}</p>
					<button class="glass-button" @click="openReader">{{ copy.readArchitecture }} <span>↗</span></button>
				</div>
				<div class="arch-stack">
					<div class="stack-card"><span class="stack-num">01</span><strong>Agent Layer</strong><small>AiAgent · ReAct ·
						子智能体编排</small></div>
					<div class="stack-card offset"><span class="stack-num">02</span><strong>Knowledge Layer</strong><small>Query
						Transformer · Hybrid Retrieval · RAG</small></div>
					<div class="stack-card"><span class="stack-num">03</span><strong>Runtime Layer</strong><small>WebSocket · Redis
						Queue · Snapshot Resume</small></div>
				</div>
			</section>
		</main>
		<section v-if="readerOpen" id="docs" class="reader-overlay" aria-label="J2Agent 文档中心">
			<div class="reader-shell glass-panel">
				<header class="reader-head">
					<div>
						<div class="eyebrow">J2AGENT DOCS · GITHUB</div>
						<h2>{{ copy.docsTitle }}</h2></div>
					<div class="reader-actions"><a href="https://github.com/j2agent-ai/j2agent-docs" target="_blank" rel="noreferrer"
					                               class="repo-link"><svg class="github-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.3 11.3 0 0 0-3.57 22.02c.57.1.78-.25.78-.55v-2.1c-3.18.7-3.85-1.35-3.85-1.35-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.33.96.1-.74.4-1.25.73-1.54-2.54-.29-5.2-1.27-5.2-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.45.11-3.03 0 0 .96-.31 3.12 1.17a10.8 10.8 0 0 1 5.68 0c2.16-1.48 3.12-1.17 3.12-1.17.62 1.58.23 2.74.11 3.03.73.8 1.18 1.82 1.18 3.07 0 4.4-2.67 5.36-5.22 5.64.41.36.78 1.08.78 2.18v3.23c0 .3.2.66.79.55A11.3 11.3 0 0 0 12 .7Z"/></svg><span>{{ copy.github }}</span><span aria-hidden="true">↗</span></a></div>
				</header>
				<div class="reader-body">
					<aside class="doc-nav"><input v-model="docSearch" type="search" :placeholder="copy.searchDocs"
					                              :aria-label="copy.searchDocs"/>
						<div class="path-loader"><input v-model="docPath" type="text" :placeholder="copy.path"
						                                aria-label="输入任意 Markdown 路径" @keyup.enter="loadDocByPath"/>
							<button @click="loadDocByPath">{{ copy.open }}</button>
						</div>
						<template v-for="row in treeRows" :key="`${row.type}:${row.path}`">
							<button v-if="row.type === 'dir'" class="doc-tree-row doc-tree-dir" :style="{ '--tree-depth': row.depth }"
							        :aria-expanded="row.expanded" @click="toggleDocDir(row.path)"><span class="doc-tree-chevron">{{ row.expanded ? '⌄' : '›' }}</span>{{ row.name }}</button>
							<button v-else class="doc-tree-row doc-tree-file" :class="{ active: selectedDoc === row.path }" :style="{ '--tree-depth': row.depth }"
							        @click="loadDoc(row.path)"><span class="doc-tree-file-icon">·</span>{{ row.name }}</button>
						</template>
						<div v-if="!treeRows.length" class="doc-state">{{ copy.noMatch }}</div>
					</aside>
					<article class="markdown-view message-md" @click="handleMarkdownClick">
						<div v-if="docError" class="doc-notice">{{ docError }}</div>
						<div v-if="docLoading" class="doc-state">{{ copy.loading }}</div>
						<div v-else ref="docContentRef" v-html="docHtml"></div>
					</article>
				</div>
			</div>
		</section>
		<footer><img src="/logo-b.svg" alt="J2Agent AI"/><span>{{ copy.footer }}</span><span class="footer-right">© 2026 J2Agent</span>
		</footer>
		<KbQaWidget @open-doc="openDocFromAi"/>
		<transition name="toast">
			<div v-if="toast" class="toast">{{ toast }}</div>
		</transition>
	</div>
</template>
