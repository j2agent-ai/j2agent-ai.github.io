import MarkdownIt from 'markdown-it'
import {renderDiagramInWorker} from './knowledge-qa/j2a/utils/diagramMarkdownRuntime'
import {normalizeMermaidSource} from './knowledge-qa/j2a/utils/diagramSourceNormalize'

let mermaidApiPromise = null
let mermaidRenderId = 0

const getMermaidApi = async () => {
  if (!mermaidApiPromise) {
    mermaidApiPromise = import('mermaid').then((module) => {
      const api = module.default || module
      api.initialize({startOnLoad: false, securityLevel: 'strict', theme: 'default', suppressErrorRendering: true})
      return api
    })
  }
  return mermaidApiPromise
}

const renderMermaidOnMainThread = async (source) => {
  const api = await getMermaidApi()
  const result = await api.render(`portal-mermaid-${Date.now()}-${++mermaidRenderId}`, source)
  return result.svg
}

const COPY_ICON = '<svg class="md-code-copy-icon" viewBox="0 0 1024 1024" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M768 832H256c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64h512c35.3 0 64 28.7 64 64v512c0 35.3-28.7 64-64 64zM704 192H320c-17.7 0-32 14.3-32 32v448c0 17.7 14.3 32 32 32h384c17.7 0 32-14.3 32-32V224c0-17.7-14.3-32-32-32zM448 320h128v64H448v-64z"/></svg>'

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const normalizePath = (value, currentPath) => {
  const clean = decodeURIComponent(value.split('#')[0].split('?')[0])
  const folder = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1) : ''
  const parts = `${folder}${clean.replace(/^\.\//, '')}`.split('/')
  const result = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') result.pop(); else result.push(part)
  }
  return result.join('/')
}

const assetUrl = (value, currentPath, baseUrl) => {
  if (/^(?:https?:|data:|blob:|\/)/i.test(value)) return value
  return `${baseUrl}${normalizePath(value, currentPath).split('/').map(encodeURIComponent).join('/')}`
}

const isInternalMarkdown = (href) =>
  !/^(?:https?:|mailto:|data:)/i.test(href) && /(?:^|\/)[^/?#]+\.md(?:#.*)?$/i.test(href)

const renderGeneratingHint = () => '<span class="md-block-generating">正在渲染…</span>'
const renderAsyncFence = (type, source) => {
  const escaped = escapeHtml(source)
  if (type === 'html') {
    return `<div class="md-html-block" data-md-render="html"><pre class="md-diagram-source" hidden>${escaped}</pre><div class="md-html-preview-wrap md-block-pending" role="region" aria-label="HTML 预览"><iframe class="md-html-preview" sandbox="allow-same-origin allow-scripts allow-forms allow-popups" scrolling="no" title="HTML 预览"></iframe>${renderGeneratingHint()}</div></div>`
  }
  return `<div class="md-diagram md-diagram-${type}" data-md-render="${type}"><pre class="md-diagram-source" hidden>${escaped}</pre><div class="md-diagram-body md-block-pending">${renderGeneratingHint()}</div></div>`
}

const codeFence = (html, language) => [
  '<div class="md-code-block">', '<div class="md-code-block-head">',
  `<span class="md-code-lang">${escapeHtml(language || 'text')}</span>`, '</div>', html,
  '<div class="md-code-block-foot">',
  `<button type="button" class="md-code-copy" aria-label="复制代码" title="复制">${COPY_ICON}</button>`,
  '</div>', '</div>'
].join('')

/** 门户文档的一次性静态 Markdown 渲染器，不参与聊天流式渲染生命周期。 */
export const createPortalMarkdownRenderer = ({baseUrl}) => {
  const markdown = new MarkdownIt({html: false, breaks: true, linkify: true, typographer: true})
  const defaultFence = markdown.renderer.rules.fence

  markdown.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index]
    token.attrSet('src', assetUrl(token.attrGet('src') || '', env?.docPath || '', baseUrl))
    token.attrSet('loading', 'lazy')
    token.attrSet('decoding', 'async')
    return self.renderToken(tokens, index, options)
  }

  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index]
    const href = token.attrGet('href') || ''
    if (isInternalMarkdown(href)) {
      token.attrSet('href', '#docs')
      token.attrSet('data-doc-path', normalizePath(href, env?.docPath || ''))
    } else if (/^(?:https?:|mailto:)/i.test(href)) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
    }
    return self.renderToken(tokens, index, options)
  }

  markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index]
    const language = (token.info || '').trim().split(/\s+/)[0].toLowerCase()
    const diagramType = language === 'puml' || language === 'plantuml'
      ? 'plantuml'
      : language === 'vega-lite'
        ? 'vegalite'
        : language
    if (['mermaid', 'plantuml', 'puml', 'vegalite', 'vega-lite', 'html'].includes(language)) {
      return renderAsyncFence(diagramType, token.content)
    }
    const rendered = defaultFence ? defaultFence(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
    return codeFence(rendered, language)
  }
  markdown.renderer.rules.paragraph_open = () => '<p style="line-height: var(--n-font-line-height-4);">'
  markdown.renderer.rules.table_open = () => '<div class="md-table-wrap"><table class="md-table">'
  markdown.renderer.rules.table_close = () => '</table></div>'
  markdown.renderer.rules.thead_open = () => '<thead class="md-thead">'
  markdown.renderer.rules.tbody_open = () => '<tbody class="md-tbody">'
  markdown.renderer.rules.tr_open = () => '<tr class="md-tr">'
  markdown.renderer.rules.th_open = () => '<th class="md-th">'
  markdown.renderer.rules.td_open = () => '<td class="md-td">'

  return (source, docPath) => markdown.render(source || '', {docPath})
}

/**
 * 门户自己的图表挂载器。它不共享聊天页的全局队列/代际状态，
 * 文档切换时只取消当前文档的任务，避免一个卡住的文档阻塞后续文档。
 */
export const createPortalDiagramRenderer = () => {
  let controller = null

  const renderBlock = async (block, signal) => {
    const type = block.getAttribute('data-md-render')
    const source = block.querySelector('.md-diagram-source')?.textContent || ''
    const body = block.querySelector('.md-diagram-body')
    if (!source.trim()) return

    try {
      if (type === 'html') {
        const iframe = block.querySelector('.md-html-preview')
        const wrap = block.querySelector('.md-html-preview-wrap')
        if (!iframe || !wrap) return
        iframe.onload = () => wrap.classList.remove('md-block-pending')
        iframe.srcdoc = source
        return
      }
      if (!body) return
      const normalizedSource = type === 'mermaid' ? normalizeMermaidSource(source) : source
      const markup = type === 'mermaid'
        ? await renderMermaidOnMainThread(normalizedSource)
        : await renderDiagramInWorker(type, normalizedSource, signal)
      if (signal.aborted || !block.isConnected) return
      body.innerHTML = markup
      const svg = body.querySelector('svg')
      if (svg) {
        const viewBox = svg.viewBox?.baseVal
        const naturalWidth = viewBox?.width || Number.parseFloat(svg.getAttribute('width') || '') || 800
        const naturalHeight = viewBox?.height || Number.parseFloat(svg.getAttribute('height') || '') || 600
        const availableWidth = Math.max(120, body.clientWidth - 32)
        const availableHeight = 300
        const scale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight)
        svg.style.width = `${Math.max(1, Math.round(naturalWidth * scale))}px`
        svg.style.height = `${Math.max(1, Math.round(naturalHeight * scale))}px`
        svg.style.maxWidth = 'none'
        svg.style.maxHeight = 'none'
        svg.style.cursor = 'zoom-in'
      }
      body.classList.remove('md-block-pending')
      block.setAttribute('data-md-rendered', 'true')
    } catch (error) {
      if (signal.aborted) return
      block.classList.add('md-diagram-error')
      if (body) {
        body.classList.remove('md-block-pending')
        body.textContent = `图表渲染失败：${error?.message || '未知错误'}`
      }
    }
  }

  return {
    render(root) {
      controller?.abort()
      controller = new AbortController()
      const blocks = [...root.querySelectorAll('[data-md-render]')]
      return Promise.all(blocks.map((block) => renderBlock(block, controller.signal)))
    },
    cancel() {
      controller?.abort()
      controller = null
    }
  }
}
