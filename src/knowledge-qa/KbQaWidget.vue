<script setup lang="ts">
/**
 * 通用知识库问答悬浮框：对接 knowledge_qa_assistant，
 * Markdown / 来源预览复用 j2a（MdViewerOverlay + markdownRenderer）。
 * 支持最小化形变成球、Powered by J2Agent 品牌条。
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/image-viewer/style/css'
import 'element-plus/es/components/icon/style/css'
import { formatSrcFileLabel, fetchQaTemplate, type KbHotQuestion } from './api'
import { knowledgeQaConfig } from './config'
import { kbQaText, type KbQaLang } from './i18n'
import KbAgentThinkingBlock from './components/KbAgentThinkingBlock.vue'
import KbAskQuestionCard from './components/KbAskQuestionCard.vue'
import MdViewerOverlay, {
  type MdViewerSource
} from './j2a/components/MdViewerOverlay.vue'
import {
  isMarkdownFile,
  resolveMarkdownFileName
} from './j2a/utils/repoFileUrl'
import {
  MARKDOWN_RENDERER_REVISION,
  buildMarkdownPrefetchRootMargin,
  hasPendingMarkdownBlocks,
  normalizeMarkdownImageParagraphs,
  renderMarkdownBlocks,
  scheduleUpdateStreamTailSegmentInPlace
} from './j2a/utils/markdownRenderer'
import './j2a/styles/markdown.scss'
import {
  createKbQaSession,
  cutSessionImmediately,
  getActiveTurnAssistantMessageIndex,
  resetSession,
  startTurn,
  stopTurn
} from './stream'
import {
  buildAssistantRenderedSegmentsMap,
  getActiveAssistantTailText,
  resetActiveStreamSplitCache,
  splitStreamingSegmentsForActiveStream
} from './streamMarkdown'
import type { KbMessage, KbSrcFile } from './types'
import logoBlack from './assets/logo-b.svg'
import logoWhite from './assets/logo-w.svg'

const language: KbQaLang = 'zh'
const emit = defineEmits<{
  openDoc: [path: string]
}>()

const text = computed(() => kbQaText(language))
const open = ref(false)
/** 形变过程中保持面板尺寸，避免收起时提前缩壳 */
const morphing = ref(false)
const input = ref('')
/** 中文等输入法组字中，避免 Enter 选字触发发送导致残缺 */
const isComposing = ref(false)
const session = createKbQaSession()
const messages = session.messages
const isBusy = session.isBusy
const connecting = session.connecting
const sending = session.sending
const errorMessage = session.errorMessage
const messagesEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const copiedIndex = ref<number | null>(null)
/** 新建对话申请 contextId 中，避免连点 */
const resetting = ref(false)
/** 是否贴底跟随；上滑查看历史时关闭，点「回到底部」再打开 */
const stickToBottom = ref(true)
/** 未贴底时显示回到底部按钮 */
const showScrollBottom = ref(false)
let copiedTimer = 0
const SCROLL_BOTTOM_THRESHOLD = 48
/** 输入框最大字数 */
const INPUT_MAX_LENGTH = 200

const mdViewerVisible = ref(false)
const mdViewerSources = ref<MdViewerSource[]>([])
const mdViewerIndex = ref(0)
/** 欢迎区热门问题 */
const hotQuestions = ref<KbHotQuestion[]>([])
const visibleQuestions = ref<KbHotQuestion[]>([])
const hotQuestionsLoading = ref(false)

/** 澄清问题在 busy 期间先上屏用户气泡，待回合结束后再发 WS */
type PendingAskAnswer = {
  questionMessageIndex: number
  userMessageIndex: number
}
const pendingAskAnswer = ref<PendingAskAnswer | null>(null)

const configReady = computed(
  () =>
    !!knowledgeQaConfig.backendBaseUrl &&
    !knowledgeQaConfig.backendBaseUrl.includes('example.com') &&
    !!knowledgeQaConfig.apiKey &&
    !knowledgeQaConfig.apiKey.includes('replace-me')
)

const statusLabel = computed(() => {
  return isBusy.value ? text.value.thinking : ''
})

const canSend = computed(
  () =>
    configReady.value &&
    !!input.value.trim() &&
    !isBusy.value &&
    !sending.value &&
    !connecting.value &&
    !isComposing.value
)

const fabAriaLabel = computed(() => {
  if (!open.value && (isBusy.value || connecting.value)) {
    return statusLabel.value || text.value.thinking
  }
  return text.value.fab
})

/** 当前流式 assistant 的 message.index */
const activeAssistantMessageIndex = computed(() =>
  isBusy.value ? getActiveTurnAssistantMessageIndex(session) : -1
)

/** assistant 消息分段 HTML（流式尾段不走 v-html，就地更新） */
const assistantRenderedSegments = computed(() =>
  buildAssistantRenderedSegmentsMap(
    messages.value,
    isBusy.value,
    activeAssistantMessageIndex.value
  )
)

const exampleQuestions = computed(() => {
  if (visibleQuestions.value.length) return visibleQuestions.value
  return text.value.examples.slice(0, 3).map((question) => ({ question }))
})

/** 当前流式尾段原文 */
const activeAssistantTailText = computed(() =>
  getActiveAssistantTailText(
    messages.value,
    isBusy.value,
    activeAssistantMessageIndex.value
  )
)

/** 流式尾段 DOM 容器（scheduleUpdateStreamTailSegmentInPlace 目标） */
const activeTailSegmentEl = ref<HTMLElement | null>(null)

const bindActiveTailSegmentRef = (el: unknown) => {
  activeTailSegmentEl.value = el instanceof HTMLElement ? el : null
}

/** 是否为当前轮次正在流式输出的 assistant 消息 */
function isActiveAssistantTurn(messageIndex: number) {
  return (
    isBusy.value && messageIndex === activeAssistantMessageIndex.value
  )
}

const MARKDOWN_BLOCKS_DEBOUNCE_MS = 100
let markdownBlocksDebounceTimer: ReturnType<typeof setTimeout> | null = null

/** 流式期间仅扫描当前 assistant 气泡，避免全列表 querySelector */
function getMarkdownBlocksScope(): Element | null {
  const listRoot = messagesEl.value
  if (!listRoot || !isBusy.value) {
    return listRoot
  }
  const msgIndex = activeAssistantMessageIndex.value
  if (msgIndex < 0) {
    return listRoot
  }
  const row = listRoot.querySelector(`[data-message-index="${msgIndex}"]`)
  return row ?? listRoot
}

function buildMarkdownBlocksRenderOptions() {
  const scrollRoot = messagesEl.value
  return {
    deferDiagrams: isBusy.value,
    scrollRoot,
    prefetchRootMargin: scrollRoot
      ? buildMarkdownPrefetchRootMargin(scrollRoot)
      : undefined,
    concurrency: 2,
    lazy: true
  }
}

function runMarkdownBlocks() {
  nextTick(() => {
    const listRoot = messagesEl.value
    if (!listRoot) {
      return
    }
    const scopeRoot = getMarkdownBlocksScope() ?? listRoot
    const renderOptions = buildMarkdownBlocksRenderOptions()
    normalizeMarkdownImageParagraphs(scopeRoot)
    if (!hasPendingMarkdownBlocks(scopeRoot, renderOptions)) {
      return
    }
    void renderMarkdownBlocks(scopeRoot, renderOptions)
      .then(() => {
        if (stickToBottom.value) {
          scrollMessagesToBottom('auto')
        }
      })
      .catch((error) => {
        console.error('[knowledge-qa] markdown blocks render failed', error)
      })
  })
}

/** 防抖激活图表 / HTML 预览块 */
function activateMarkdownBlocks() {
  if (markdownBlocksDebounceTimer !== null) {
    clearTimeout(markdownBlocksDebounceTimer)
  }
  markdownBlocksDebounceTimer = setTimeout(() => {
    markdownBlocksDebounceTimer = null
    runMarkdownBlocks()
  }, MARKDOWN_BLOCKS_DEBOUNCE_MS)
}

/** 流式结束或新消息入列时立即渲染 */
function flushActivateMarkdownBlocks() {
  if (markdownBlocksDebounceTimer !== null) {
    clearTimeout(markdownBlocksDebounceTimer)
    markdownBlocksDebounceTimer = null
  }
  runMarkdownBlocks()
}

/** 流式尾段就地增量更新，避免每 token 销毁 pending 图表占位 */
watch(
  [activeAssistantTailText, activeTailSegmentEl],
  ([tailText, el]) => {
    if (!tailText || !el) {
      return
    }
    scheduleUpdateStreamTailSegmentInPlace(el, tailText, true)
  },
  { flush: 'post' }
)

/** 围栏闭合产生新稳定段时再触发图表渲染 */
watch(
  () => {
    if (!isBusy.value) {
      return 0
    }
    const idx = activeAssistantMessageIndex.value
    if (idx < 0) {
      return 0
    }
    const message = messages.value.find((item) => item.index === idx)
    if (!message?.content) {
      return 0
    }
    return splitStreamingSegmentsForActiveStream(message.content).filter(
      (seg) => seg.complete
    ).length
  },
  (count, prev) => {
    if (count <= (prev ?? 0)) {
      return
    }
    nextTick(() => {
      flushActivateMarkdownBlocks()
    })
  }
)

/** 新消息入列或流式结束后补渲染图表块 */
watch(
  () => [messages.value.length, isBusy.value] as const,
  ([length, busy], prev) => {
    if (busy) {
      return
    }
    const prevLength = prev?.[0]
    if (prevLength !== undefined && length === prevLength) {
      return
    }
    flushActivateMarkdownBlocks()
  }
)

/** 流式结束：补全尾段并立即激活图表 */
watch(isBusy, (busy, wasBusy) => {
  if (busy || !wasBusy) {
    return
  }
  resetActiveStreamSplitCache()
  const el = activeTailSegmentEl.value
  const idx = getActiveTurnAssistantMessageIndex(session)
  if (el && idx >= 0) {
    const message = messages.value.find((item) => item.index === idx)
    if (message?.content && message.role === 'assistant') {
      const tail = splitStreamingSegmentsForActiveStream(message.content).at(-1)
      if (tail?.text) {
        scheduleUpdateStreamTailSegmentInPlace(el, tail.text, false, true)
      }
    }
  }
  flushActivateMarkdownBlocks()
  void flushPendingAskQuestionAnswer()
})

/** 内容变化时仅处理滚动，不触发全量 markdown 重渲染 */
watch(
  () =>
    messages.value.map(
      (m) =>
        `${m.index}:${m.content.length}:${m.streaming}:${m.pendingQuestion?.question ?? ''}`
    ),
  async () => {
    await nextTick()
    if (stickToBottom.value) {
      scrollMessagesToBottom('auto')
    } else {
      updateScrollBottomVisibility()
    }
    if (!isBusy.value) {
      activateMarkdownBlocks()
    }
  }
)

onMounted(() => {
  window.visualViewport?.addEventListener('resize', syncKeyboardViewport)
  window.visualViewport?.addEventListener('scroll', syncKeyboardViewport)
  window.addEventListener('keydown', handleWidgetKeydown)
})

/** 拉取热门问题（对齐 j2a getQaTemplate） */
async function loadHotQuestions() {
  if (!configReady.value || hotQuestionsLoading.value) {
    return
  }
  hotQuestionsLoading.value = true
  try {
    hotQuestions.value = await fetchQaTemplate(language)
    refreshDisplayedQuestions()
  } catch {
    hotQuestions.value = []
    visibleQuestions.value = []
  } finally {
    hotQuestionsLoading.value = false
  }
}

function refreshDisplayedQuestions() {
  const pool = hotQuestions.value.length
    ? hotQuestions.value
    : text.value.examples.map((question) => ({ question }))
  const current = new Set(visibleQuestions.value.map((item) => item.question))
  const candidates = pool.filter((item) => !current.has(item.question))
  const source = candidates.length >= Math.min(3, pool.length) ? candidates : pool
  visibleQuestions.value = [...source]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
}

function handleRefreshQuestions() {
  if (hotQuestions.value.length || text.value.examples.length) {
    refreshDisplayedQuestions()
  } else {
    void loadHotQuestions()
  }
}

/** 点击热门问题直接发送 */
function handleHotQuestionClick(question: string) {
  input.value = question
  void handleSend()
}

onBeforeUnmount(() => {
    stopTurn(session, language)
  window.visualViewport?.removeEventListener('resize', syncKeyboardViewport)
  window.visualViewport?.removeEventListener('scroll', syncKeyboardViewport)
  window.removeEventListener('keydown', handleWidgetKeydown)
  if (copiedTimer) {
    window.clearTimeout(copiedTimer)
  }
  if (markdownBlocksDebounceTimer !== null) {
    clearTimeout(markdownBlocksDebounceTimer)
    markdownBlocksDebounceTimer = null
  }
})

/** 判断消息区是否接近底部 */
function isNearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD
}

function updateScrollBottomVisibility() {
  const root = messagesEl.value
  if (!root) {
    showScrollBottom.value = false
    return
  }
  showScrollBottom.value = !isNearBottom(root)
}

function scrollMessagesToBottom(behavior: ScrollBehavior = 'smooth') {
  const root = messagesEl.value
  if (!root) {
    return
  }
  root.scrollTo({ top: root.scrollHeight, behavior })
  stickToBottom.value = true
  showScrollBottom.value = false
}

/** 用户手动滚动：离开底部则暂停自动跟随 */
function onMessagesScroll() {
  const root = messagesEl.value
  if (!root) {
    return
  }
  if (isNearBottom(root)) {
    stickToBottom.value = true
    showScrollBottom.value = false
  } else {
    stickToBottom.value = false
    showScrollBottom.value = true
  }
}

function handleScrollToBottomClick() {
  scrollMessagesToBottom('smooth')
}

function toggleOpen() {
  if (open.value) {
    minimizePanel()
    return
  }
  morphing.value = true
  open.value = true
  void loadHotQuestions()
  nextTick(() => {
    syncKeyboardViewport()
  })
}

function scrollInputIntoView() {
  window.setTimeout(() => {
    inputEl.value?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  }, 80)
}

function syncKeyboardViewport() {
  const root = document.querySelector<HTMLElement>('.kb-qa-root')
  const viewport = window.visualViewport
  if (!root || !viewport) return
  const keyboardOffset = Math.max(
    0,
    window.innerHeight - viewport.height - viewport.offsetTop
  )
  const hasKeyboard = keyboardOffset > 80
  root.style.setProperty('--kb-qa-viewport-height', `${viewport.height}px`)
  root.style.setProperty('--kb-qa-keyboard-offset', `${hasKeyboard ? keyboardOffset : 0}px`)
  if (hasKeyboard && open.value) scrollInputIntoView()
}

function handleInputFocus() {
  syncKeyboardViewport()
  scrollInputIntoView()
}

function handleWidgetKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    minimizePanel()
  }
}

function minimizePanel() {
  morphing.value = true
  open.value = false
}

/** 面板形变结束：收起时缩壳，展开时结束 morphing */
function onPanelAfterEnter() {
  morphing.value = false
}

function onPanelAfterLeave() {
  morphing.value = false
}

function isSrcMarkdown(file: KbSrcFile): boolean {
  return isMarkdownFile(resolveMarkdownFileName(file))
}

/** 是否为当前唯一待回答的澄清问题气泡 */
function isLatestPendingQuestionMessage(message: KbMessage) {
  if (!message.pendingQuestion || message.role !== 'assistant') {
    return false
  }
  const list = messages.value
  const position = list.findIndex((item) => item.index === message.index)
  if (position < 0) {
    return false
  }
  for (let i = position + 1; i < list.length; i += 1) {
    if (list[i].role === 'user') {
      return false
    }
  }
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].pendingQuestion) {
      return list[i].index === message.index
    }
  }
  return false
}

/** 用户已在 busy 时提交澄清答案，等待回合结束 */
function isPendingAskQuestionAnswer(message: KbMessage) {
  return (
    pendingAskAnswer.value?.questionMessageIndex === message.index
  )
}

/** 提交澄清问题答案（对齐 j2a sendAskQuestionAnswer） */
async function handleAskQuestionAnswer(message: KbMessage, answer: string) {
  const normalized = answer.trim()
  if (!normalized || !isLatestPendingQuestionMessage(message)) {
    return
  }
  stickToBottom.value = true

  if (isBusy.value || sending.value || connecting.value) {
    const userMsg: KbMessage = {
      index: messages.value.length,
      role: 'user',
      content: normalized
    }
    messages.value.push(userMsg)
    pendingAskAnswer.value = {
      questionMessageIndex: message.index,
      userMessageIndex: userMsg.index
    }
    await nextTick()
    scrollMessagesToBottom('smooth')
    return
  }

  const started = await startTurn(session, normalized, language)
  if (!started) {
    return
  }
  await nextTick()
  scrollMessagesToBottom('smooth')
}

/** 回合结束后发送排队中的澄清答案 */
async function flushPendingAskQuestionAnswer() {
  const pending = pendingAskAnswer.value
  if (!pending || isBusy.value || sending.value || connecting.value) {
    return
  }
  const userMsg = messages.value.find(
    (item) => item.index === pending.userMessageIndex && item.role === 'user'
  )
  const questionMsg = messages.value.find(
    (item) =>
      item.index === pending.questionMessageIndex && item.role === 'assistant'
  )
  if (!userMsg?.content.trim() || !questionMsg?.pendingQuestion) {
    pendingAskAnswer.value = null
    return
  }
  pendingAskAnswer.value = null
  const started = await startTurn(session, userMsg.content, language, {
    existingUserMessage: userMsg
  })
  if (started) {
    await nextTick()
    scrollMessagesToBottom('smooth')
  }
}

function srcLabel(file: KbSrcFile): string {
  return formatSrcFileLabel(file)
}

function repoMarkdownPath(file: KbSrcFile): string {
  const value = (file.relativePath || file.fullFileName || '').trim().replace(/^\/+/, '')
  return value.replace(/^j2agent-docs\//i, '')
}

function openSrcPreview(files: KbSrcFile[], index: number) {
  const mdFiles = files
    .map((file, i) => ({ file, i }))
    .filter(({ file }) => isSrcMarkdown(file))
  if (!mdFiles.length) {
    return
  }
  const clicked = files[index]
  const repoPath = repoMarkdownPath(clicked)
  if (repoPath.toLowerCase().endsWith('.md')) {
    open.value = false
    emit('openDoc', repoPath)
    return
  }
  const initial = Math.max(
    0,
    mdFiles.findIndex(({ file }) => file === clicked)
  )
  mdViewerSources.value = mdFiles.map(({ file }) => ({
    url: file.url,
    title: srcLabel(file),
    relativePath: file.relativePath
  }))
  mdViewerIndex.value = initial
  mdViewerVisible.value = true
}

function closeMdViewer() {
  mdViewerVisible.value = false
}

async function handleSend() {
  if (!canSend.value) {
    return
  }
  const content = input.value.slice(0, INPUT_MAX_LENGTH)
  if (!content.trim()) {
    return
  }
  // 先清空；仅锁拒绝时回填（用户气泡已乐观上屏则不再回填）
  input.value = ''
  stickToBottom.value = true
  const started = await startTurn(session, content, language)
  if (!started) {
    input.value = content
    await nextTick()
    inputEl.value?.focus()
    return
  }
  await nextTick()
  scrollMessagesToBottom('smooth')
  inputEl.value?.focus()
}

function handleStop() {
  stopTurn(session, language)
}

/** 新建对话：同步切断上一轮并申请新 contextId */
async function handleNewChat() {
  cutSessionImmediately(session)
  pendingAskAnswer.value = null
  input.value = ''
  resetting.value = true
  try {
    await resetSession(session, language)
    await nextTick()
    inputEl.value?.focus()
  } finally {
    resetting.value = false
  }
}

/** 输入法组字开始 */
function onCompositionStart() {
  isComposing.value = true
}

/** 输入法组字结束（选字完成） */
function onCompositionEnd() {
  isComposing.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey) {
    return
  }
  // 组字确认键：不拦截，避免残缺字符被当成发送
  if (event.isComposing || isComposing.value || event.keyCode === 229) {
    return
  }
  if (!canSend.value) {
    return
  }
  event.preventDefault()
  void handleSend()
}

async function copyMessage(content: string, index: number) {
  try {
    await navigator.clipboard.writeText(content)
    copiedIndex.value = index
    if (copiedTimer) {
      window.clearTimeout(copiedTimer)
    }
    copiedTimer = window.setTimeout(() => {
      copiedIndex.value = null
    }, 1400)
  } catch {
    /* ignore */
  }
}

function handleBubbleClick(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }
  const copyBtn = target.closest('.md-code-copy')
  if (copyBtn) {
    event.preventDefault()
    const block = copyBtn.closest('.md-code-block')
    const pre = block?.querySelector('pre')
    const code = pre?.querySelector('code')?.textContent ?? pre?.textContent ?? ''
    void copyMessage(code, -1)
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="kb-qa-root"
      :class="{ 'is-morphing': morphing }"
      :data-open="open"
      :data-busy="isBusy"
    >
      <Transition name="kb-qa-fab">
        <button
          v-show="!open"
          type="button"
          class="kb-qa-fab"
          :class="{ 'is-busy': isBusy }"
          :aria-label="fabAriaLabel"
          :title="fabAriaLabel"
          @click="toggleOpen"
        >
          <span class="kb-qa-fab-glow" aria-hidden="true" />
          <span class="kb-qa-fab-ring" aria-hidden="true" />
          <span class="kb-qa-fab-spin" aria-hidden="true" />
          <span class="kb-qa-fab-core" aria-hidden="true">
            <span class="kb-qa-fab-label">{{ text.askAi }}</span>
          </span>
        </button>
      </Transition>

      <Transition name="kb-qa-panel" @after-enter="onPanelAfterEnter" @after-leave="onPanelAfterLeave">
        <section
          v-if="open"
          class="kb-qa-panel"
          role="dialog"
          :aria-label="text.title"
        >
          <header class="kb-qa-header">
            <div class="kb-qa-title-wrap">
              <span class="kb-qa-title-mark" aria-hidden="true" />
              <h2 class="kb-qa-title">{{ text.title }}</h2>
              <div
                class="kb-qa-brand"
                :aria-label="`${text.poweredBy} J2Agent`"
              >
                <span class="kb-qa-brand-label">{{ text.poweredBy }}</span>
                <img
                  class="kb-qa-brand-logo kb-qa-brand-logo--light"
                  :src="logoBlack"
                  alt="J2Agent"
                  height="22"
                />
                <img
                  class="kb-qa-brand-logo kb-qa-brand-logo--dark"
                  :src="logoWhite"
                  alt="J2Agent"
                  height="22"
                />
              </div>
            </div>
            <div class="kb-qa-header-actions">
              <button
                type="button"
                class="kb-qa-icon-btn"
                :class="{ 'is-loading': resetting }"
                :title="text.newChat"
                :aria-label="text.newChat"
                @click="handleNewChat"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="kb-qa-icon-btn"
                :title="text.minimize"
                :aria-label="text.minimize"
                @click="minimizePanel"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                  <path
                    d="M6 6l12 12M18 6 6 18"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </div>
          </header>

          <div class="kb-qa-messages-wrap">
            <div
              ref="messagesEl"
              class="kb-qa-messages"
              @click="handleBubbleClick"
              @scroll="onMessagesScroll"
            >
              <div v-if="!messages.length" class="kb-qa-welcome">
                <div class="kb-qa-welcome-orb" aria-hidden="true" />
                <p class="kb-qa-welcome-text">{{ text.welcome }}</p>
                <p v-if="!configReady" class="kb-qa-config-hint">
                  {{ text.emptyConfig }}
                </p>
                <div
                  v-else
                  class="kb-qa-hot-questions"
                >
                  <div class="kb-qa-hot-head">
                    <button
                      type="button"
                      class="kb-qa-hot-refresh"
                      :disabled="hotQuestionsLoading"
                      @click="handleRefreshQuestions"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                        <path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                      {{ text.refreshHotQuestions }}
                    </button>
                  </div>
                  <button
                    v-for="(item, index) in exampleQuestions"
                    :key="`${item.question}-${index}`"
                    type="button"
                    class="kb-qa-hot-item"
                    @click="handleHotQuestionClick(item.question)"
                  >
                    {{ item.question }}
                  </button>
                </div>
              </div>

              <p v-if="errorMessage" class="kb-qa-error" role="alert">
                {{ errorMessage }}
              </p>

              <TransitionGroup name="kb-qa-msg" tag="div" class="kb-qa-msg-list">
                <div
                  v-for="message in messages"
                  :key="`${message.index}-${message.role}`"
                  class="kb-qa-row"
                  :class="message.role"
                  :data-message-index="message.index"
                >
                  <div
                    class="kb-qa-bubble"
                    :class="[
                      message.role,
                      { 'is-streaming': message.role === 'assistant' && message.streaming }
                    ]"
                  >
                    <template v-if="message.role === 'user'">
                      <div class="kb-qa-user-text">{{ message.content }}</div>
                    </template>
                    <template v-else>
                      <KbAgentThinkingBlock
                        v-if="message.reasoningContent?.trim()"
                        :content="message.reasoningContent"
                        :title="text.thinkingTitle"
                        :active="
                          isActiveAssistantTurn(message.index) && isBusy
                        "
                      />
                      <div
                        v-if="message.srcFile?.length"
                        class="kb-qa-sources message-md"
                      >
                        <p class="kb-qa-sources-title">{{ text.source }}</p>
                        <ul>
                          <li
                            v-for="(file, fileIndex) in message.srcFile"
                            :key="`${file.url}-${fileIndex}`"
                          >
                            <button
                              v-if="isSrcMarkdown(file)"
                              type="button"
                              class="kb-qa-source-link"
                              @click="openSrcPreview(message.srcFile!, fileIndex)"
                            >
                              {{ srcLabel(file) }}
                            </button>
                            <a
                              v-else
                              class="kb-qa-source-link"
                              :href="file.url"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {{ srcLabel(file) }}
                            </a>
                          </li>
                        </ul>
                      </div>

                      <div
                        v-if="message.content"
                        :key="`assistant-md-${message.index}-${MARKDOWN_RENDERER_REVISION}`"
                        class="message-md kb-qa-assistant-md"
                        :class="{ 'is-streaming': message.streaming }"
                      >
                        <div
                          v-for="(seg, segIdx) in assistantRenderedSegments.get(
                            message.index
                          ) ?? []"
                          :key="segIdx"
                          class="assistant-stream-segment"
                          :data-md-stream-tail="
                            isActiveAssistantTurn(message.index) &&
                            !seg.complete &&
                            isBusy
                              ? ''
                              : null
                          "
                        >
                          <div
                            v-if="
                              isActiveAssistantTurn(message.index) &&
                              !seg.complete &&
                              isBusy
                            "
                            :ref="bindActiveTailSegmentRef"
                          />
                          <div
                            v-else
                            v-html="seg.html"
                          />
                        </div>
                      </div>
                      <KbAskQuestionCard
                        v-if="message.pendingQuestion"
                        :question="message.pendingQuestion"
                        :disabled="
                          sending ||
                          !isLatestPendingQuestionMessage(message)
                        "
                        :pending="isPendingAskQuestionAnswer(message)"
                        :custom-placeholder="text.askCustomPlaceholder"
                        :send-label="text.askSend"
                        :empty-hint="text.askEmpty"
                        @answer="(answer) => handleAskQuestionAnswer(message, answer)"
                      />
                      <div
                        v-if="!message.content && message.streaming"
                        class="kb-qa-typing"
                        role="status"
                      >
                        <span class="kb-qa-typing-label">
                          {{ statusLabel || text.thinking }}
                        </span>
                        <span class="kb-qa-typing-dots" aria-hidden="true">
                          <i /><i /><i />
                        </span>
                      </div>

                      <div
                        v-if="message.content && !message.streaming"
                        class="kb-qa-msg-actions"
                      >
                        <button
                          type="button"
                          class="kb-qa-copy-btn"
                          @click="copyMessage(message.content, message.index)"
                        >
                          {{
                            copiedIndex === message.index
                              ? text.copied
                              : text.copy
                          }}
                        </button>
                      </div>
                    </template>
                  </div>
                </div>
              </TransitionGroup>
            </div>

            <Transition name="kb-qa-scroll-btn">
              <button
                v-if="showScrollBottom"
                type="button"
                class="kb-qa-scroll-bottom"
                :aria-label="text.scrollToBottom"
                @click="handleScrollToBottomClick"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </Transition>
          </div>

          <footer class="kb-qa-footer">
            <div class="kb-qa-input-shell">
              <textarea
                ref="inputEl"
                v-model="input"
                class="kb-qa-input"
                rows="2"
                :maxlength="INPUT_MAX_LENGTH"
                :placeholder="text.placeholder"
                :disabled="!configReady || isBusy || sending"
                @focus="handleInputFocus"
                @keydown="onKeydown"
                @compositionstart="onCompositionStart"
                @compositionend="onCompositionEnd"
              />
              <button
                v-if="isBusy"
                type="button"
                class="kb-qa-send kb-qa-send--busy"
                :aria-label="statusLabel || text.stop"
                :title="text.stop"
                @click="handleStop"
              >
                <span class="kb-qa-send-stop-square" aria-hidden="true" />
              </button>
              <button
                v-else
                type="button"
                class="kb-qa-send"
                :disabled="!canSend"
                :aria-label="text.send"
                @click="handleSend"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                  <path
                    d="M5 12h12M13 6l6 6-6 6"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
            <p class="kb-qa-disclaimer" aria-hidden="true">
              {{ text.disclaimer }}
            </p>
          </footer>
        </section>
      </Transition>
    </div>

    <MdViewerOverlay
      :visible="mdViewerVisible"
      :sources="mdViewerSources"
      :initial-index="mdViewerIndex"
      @close="closeMdViewer"
    />
  </Teleport>
</template>

<style scoped>
.kb-qa-root {
  --kb-qa-z: 1200;
  --kb-qa-viewport-height: 100vh;
  --kb-qa-keyboard-offset: 0px;
  --kb-qa-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --kb-qa-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  /* 停止按钮专用色 */
  --kb-qa-busy: #ff3b30;
  --kb-qa-busy-bg: color-mix(in srgb, var(--kb-qa-busy) 92%, #111);
  --kb-qa-busy-bg-hover: color-mix(in srgb, var(--kb-qa-busy) 96%, #000);
  --el-color-primary: var(--n-color-primary);
  --n-dialog-border-radius: 16px;
  --n-font-size-2: 14px;
  --n-font-weight-bold: 600;
  --n-color-text-muted: var(--n-color-text-tertiary);
  --n-color-neutral-w: var(--n-color-bg-elevated);
  --n-color-preview-bg: var(--n-color-bg-subtle);
  position: fixed;
  /* 胶囊与展开面板共用同一右下锚点 */
  right: max(48px, env(safe-area-inset-right, 0px));
  bottom: max(36px, env(safe-area-inset-bottom, 0px));
  z-index: var(--kb-qa-z);
  font-family: var(--n-font-text);
  width: 104px;
  height: 44px;
}

.kb-qa-root[data-open='true'],
.kb-qa-root.is-morphing {
  width: 104px;
  height: 44px;
}

@media (max-width: 640px) {
  .kb-qa-root {
    right: max(24px, env(safe-area-inset-right, 0px));
    bottom: max(24px, env(safe-area-inset-bottom, 0px));
  }

  .kb-qa-root[data-open='true'],
  .kb-qa-root.is-morphing {
    width: 104px;
    height: 44px;
  }

  .kb-qa-panel {
    width: calc(100vw - 24px);
    max-width: none;
  }
}

/* —— FAB：玻璃圆标 + 主色光晕 —— */
.kb-qa-fab {
  position: absolute;
  right: 0;
  bottom: 0;
  min-width: 102px;
  width: auto;
  height: 44px;
  border: 1px solid color-mix(in srgb, var(--n-color-primary) 26%, var(--n-color-border-soft));
  border-radius: 999px;
  padding: 0 17px;
  overflow: visible;
  background: color-mix(in srgb, var(--n-color-bg-glass-strong) 92%, white);
  box-shadow:
    0 8px 24px rgba(38, 61, 91, 0.14),
    inset 0 1px rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(var(--n-glass-blur-3)) saturate(var(--n-glass-saturate));
  -webkit-backdrop-filter: blur(var(--n-glass-blur-3))
    saturate(var(--n-glass-saturate));
  color: var(--n-color-primary);
  cursor: pointer;
  display: grid;
  place-items: center;
  isolation: isolate;
  transition:
    transform 0.22s var(--kb-qa-ease),
    box-shadow 0.22s var(--kb-qa-ease),
    border-color 0.2s ease;
}

.kb-qa-fab:hover {
  transform: translateY(-2px) scale(1.015);
  box-shadow:
    0 12px 30px rgba(38, 61, 91, 0.18),
    0 0 0 4px color-mix(in srgb, var(--n-color-primary) 9%, transparent);
  border-color: color-mix(in srgb, var(--n-color-primary) 48%, var(--n-color-border-soft));
}

.kb-qa-fab:active {
  transform: translateY(-1px) scale(0.98);
}

.kb-qa-fab-glow {
  position: absolute;
  inset: -9px;
  border-radius: inherit;
  background: color-mix(in srgb, var(--n-color-primary) 20%, transparent);
  opacity: 0;
  filter: blur(9px);
  pointer-events: none;
  z-index: -1;
  transform: scale(0.96);
}

.kb-qa-fab-ring {
  position: absolute;
  inset: -3px;
  border-radius: inherit;
  border: 1px solid color-mix(in srgb, var(--n-color-primary) 30%, transparent);
  opacity: 0;
  pointer-events: none;
  animation: kb-qa-fab-pulse 2.8s var(--kb-qa-ease) infinite;
}

.kb-qa-fab-spin {
  position: absolute;
  inset: -4px;
  border-radius: inherit;
  border: 1px solid color-mix(in srgb, var(--n-color-primary) 16%, transparent);
  background: transparent;
  opacity: 0;
  pointer-events: none;
}

.kb-qa-fab.is-busy {
  animation: none;
}

.kb-qa-fab.is-busy .kb-qa-fab-glow {
  opacity: 0;
  animation: kb-qa-fab-spread 2.2s ease-out infinite;
}

.kb-qa-fab.is-busy .kb-qa-fab-ring {
  display: none;
}

.kb-qa-fab.is-busy .kb-qa-fab-spin {
  display: none;
}

.kb-qa-fab-core {
  display: grid;
  place-items: center;
  transition: transform 0.28s var(--kb-qa-ease);
}

.kb-qa-fab-label {
  font-family: ui-sans-serif, var(--n-font-display);
  font-size: 13px;
  font-weight: 500;
  font-variation-settings: "wght" 520;
  letter-spacing: 0.04em;
  line-height: 1;
  font-optical-sizing: auto;
  font-kerning: normal;
  font-feature-settings: "kern" 1;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}

.kb-qa-fab:hover .kb-qa-fab-core {
  transform: scale(1.02);
}

.kb-qa-fab:hover .kb-qa-fab-glow {
  opacity: 0.32;
  transform: scale(1.02);
}

@keyframes kb-qa-fab-pulse {
  0% {
    opacity: 0;
    transform: scale(0.92);
  }
  35% {
    opacity: 0.55;
  }
  100% {
    opacity: 0;
    transform: scale(1.18);
  }
}

@keyframes kb-qa-fab-spread {
  0% {
    opacity: 0;
    transform: scale(0.94);
  }
  12% {
    opacity: 0.62;
  }
  42% {
    opacity: 0.26;
  }
  100% {
    opacity: 0;
    transform: scale(1.2);
  }
}

@keyframes kb-qa-fab-breathe {
  0%,
  100% {
    transform: scale(1);
    box-shadow: var(--n-shadow-elevation-3);
  }
  50% {
    transform: scale(1.06);
    box-shadow: var(--n-shadow-elevation-4);
  }
}

.kb-qa-fab-enter-active {
  transition:
    opacity 0.22s ease,
    transform 0.36s var(--kb-qa-ease-out);
}

.kb-qa-fab-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.22s var(--kb-qa-ease);
}

.kb-qa-fab-enter-from {
  opacity: 0;
  transform: scale(0.55);
}

.kb-qa-fab-leave-to {
  opacity: 0;
  transform: scale(1.2);
}

/* —— Panel —— */
.kb-qa-panel {
  position: absolute;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: min(520px, calc(100vw - 56px));
  height: min(80vh, calc(var(--kb-qa-viewport-height) - 32px));
  max-width: calc(100vw - 56px);
  max-height: calc(100vh - 48px);
  min-width: 0;
  border: 1px solid var(--n-color-border-soft);
  border-radius: 20px;
  background: var(--n-color-bg-glass-overlay);
  box-shadow: var(--n-shadow-elevation-4);
  backdrop-filter: blur(var(--n-glass-blur-4)) saturate(var(--n-glass-saturate));
  -webkit-backdrop-filter: blur(var(--n-glass-blur-4))
    saturate(var(--n-glass-saturate));
  overflow: hidden;
  transform-origin: bottom right;
}

.kb-qa-panel-enter-active {
  transition:
    opacity 0.28s ease,
    transform 0.42s var(--kb-qa-ease-out),
    border-radius 0.42s var(--kb-qa-ease-out);
}

.kb-qa-panel-leave-active {
  transition:
    opacity 0.28s ease,
    transform 0.36s var(--kb-qa-ease),
    border-radius 0.36s var(--kb-qa-ease);
}

.kb-qa-panel-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
  border-radius: 22px;
}

.kb-qa-panel-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
  border-radius: 22px;
}

.kb-qa-panel-enter-active :deep(.kb-qa-header),
.kb-qa-panel-enter-active :deep(.kb-qa-messages-wrap),
.kb-qa-panel-enter-active :deep(.kb-qa-footer),
.kb-qa-panel-leave-active .kb-qa-header,
.kb-qa-panel-leave-active .kb-qa-messages-wrap,
.kb-qa-panel-leave-active .kb-qa-footer {
  transition: opacity 0.18s ease;
}

.kb-qa-panel-enter-from .kb-qa-header,
.kb-qa-panel-enter-from .kb-qa-messages-wrap,
.kb-qa-panel-enter-from .kb-qa-footer,
.kb-qa-panel-leave-to .kb-qa-header,
.kb-qa-panel-leave-to .kb-qa-messages-wrap,
.kb-qa-panel-leave-to .kb-qa-footer {
  opacity: 0;
}

.kb-qa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--n-color-border-soft);
  background: color-mix(in srgb, var(--n-color-bg-glass) 70%, transparent);
}

.kb-qa-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.kb-qa-title-mark {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--n-color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--n-color-primary) 18%, transparent);
  flex-shrink: 0;
}

.kb-qa-root[data-busy='true'] .kb-qa-title-mark {
  animation: kb-qa-mark-pulse 1.8s ease-out infinite;
}

@keyframes kb-qa-mark-pulse {
  0% {
    opacity: 1;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--n-color-primary) 18%, transparent), 0 0 0 3px color-mix(in srgb, var(--n-color-primary) 22%, transparent);
  }
  70% {
    opacity: 0.78;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--n-color-primary) 12%, transparent), 0 0 0 12px color-mix(in srgb, var(--n-color-primary) 0%, transparent);
  }
  100% {
    opacity: 1;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--n-color-primary) 18%, transparent), 0 0 0 3px color-mix(in srgb, var(--n-color-primary) 0%, transparent);
  }
}

.kb-qa-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--n-color-text-primary);
  flex-shrink: 0;
}

.kb-qa-brand {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: 6px;
  padding-left: 10px;
  border-left: 1px solid var(--n-color-border-soft);
  text-decoration: none;
  flex-shrink: 1;
  min-width: 0;
}

.kb-qa-brand-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--n-color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kb-qa-brand-logo {
  height: 22px;
  width: auto;
  flex-shrink: 0;
}

.kb-qa-icon-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 10px;
  background: var(--n-control-bg);
  color: var(--n-color-text-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease,
    opacity 0.16s ease;
}

.kb-qa-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.kb-qa-icon-btn:hover:not(:disabled) {
  background: var(--n-control-hover-bg);
  color: var(--n-color-text-primary);
}

.kb-qa-icon-btn:active:not(:disabled) {
  transform: scale(0.94);
}

.kb-qa-icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.kb-qa-messages-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.kb-qa-messages {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 14px 12px 8px;
  -webkit-overflow-scrolling: touch;
  scroll-behavior: smooth;
}

.kb-qa-scroll-bottom {
  position: absolute;
  right: 14px;
  bottom: 12px;
  z-index: 2;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--n-color-border-soft);
  border-radius: 50%;
  background: var(--n-color-bg-glass-strong);
  box-shadow: var(--n-shadow-elevation-2);
  backdrop-filter: blur(var(--n-glass-blur-2)) saturate(var(--n-glass-saturate));
  -webkit-backdrop-filter: blur(var(--n-glass-blur-2))
    saturate(var(--n-glass-saturate));
  color: var(--n-color-text-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition:
    transform 0.18s var(--kb-qa-ease),
    color 0.16s ease,
    box-shadow 0.18s ease;
}

.kb-qa-scroll-bottom:hover {
  color: var(--n-color-primary);
  transform: translateY(1px);
  box-shadow: var(--n-shadow-elevation-3);
}

.kb-qa-scroll-bottom:active {
  transform: scale(0.94);
}

.kb-qa-scroll-btn-enter-active,
.kb-qa-scroll-btn-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.24s var(--kb-qa-ease);
}

.kb-qa-scroll-btn-enter-from,
.kb-qa-scroll-btn-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.9);
}

.kb-qa-welcome {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 28px 12px 20px;
  width: 100%;
  min-width: 0;
  overflow: visible;
}

.kb-qa-welcome-orb {
  position: relative;
  isolation: isolate;
  width: 48px;
  height: 48px;
  border-radius: 16px;
  background:
    radial-gradient(circle at 24% 22%, #ffffffd9 0 8%, transparent 30%),
    radial-gradient(circle at 76% 72%, #ff8fcf99 0 4%, transparent 38%),
    linear-gradient(135deg, #67a8ff 0%, #8d8cff 34%, #e18bdf 66%, #62d9e9 100%);
  background-size: 100% 100%, 180% 180%, 240% 240%;
  background-position: 0 0, 80% 20%, 0% 50%;
  box-shadow:
    0 8px 18px color-mix(in srgb, var(--n-color-primary) 16%, transparent),
    var(--n-shadow-elevation-1);
  animation: kb-qa-orb-float 4.5s var(--kb-qa-ease) infinite, kb-qa-orb-gradient 7s ease-in-out infinite;
}

.kb-qa-welcome-orb::before,
.kb-qa-welcome-orb::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.kb-qa-welcome-orb::before {
  z-index: -1;
  inset: -14px;
  border-radius: 22px;
  background: radial-gradient(
    circle at 30% 30%,
    #71b7ff66 0%,
    #b38bff40 32%,
    #ff91d52e 52%,
    transparent 74%
  );
  filter: blur(8px);
  opacity: .72;
  animation: kb-qa-orb-glow 3.8s ease-in-out infinite;
}

.kb-qa-welcome-orb::after {
  inset: 6px;
  border-radius: 11px;
  background: conic-gradient(
    from 20deg,
    transparent,
    color-mix(in srgb, #fff 66%, transparent),
    transparent 30%,
    #ff9bdd66 52%,
    transparent 72%,
    #66d9ff55 88%,
    transparent 100%
  );
  mix-blend-mode: screen;
  opacity: .7;
  animation: kb-qa-orb-shimmer 4.8s linear infinite;
}

@keyframes kb-qa-orb-glow {
  0%,
  100% {
    transform: scale(.86);
    opacity: .48;
  }
  50% {
    transform: scale(1.12);
    opacity: .86;
  }
}

@keyframes kb-qa-orb-gradient {
  0%,
  100% {
    background-position: 0 0, 80% 20%, 0% 50%;
  }
  50% {
    background-position: 0 0, 20% 80%, 100% 50%;
  }
}

@keyframes kb-qa-orb-shimmer {
  to {
    transform: rotate(360deg);
  }
}

@keyframes kb-qa-orb-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5px);
  }
}

.kb-qa-welcome-text {
  margin: 0;
  color: var(--n-color-text-secondary);
  font-size: 14px;
  line-height: 1.65;
  max-width: 28em;
}

.kb-qa-config-hint {
  margin: 0;
  color: var(--n-color-text-tertiary);
  font-size: 12px;
  line-height: 1.5;
}

.kb-qa-hot-questions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(100%, 360px);
  max-width: 100%;
  min-width: 0;
  margin-top: 4px;
}

.kb-qa-hot-head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.kb-qa-hot-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--n-color-text-secondary);
}

.kb-qa-hot-refresh {
  border: none;
  background: none;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--n-color-primary);
  cursor: pointer;
}

.kb-qa-hot-refresh svg {
  flex: 0 0 auto;
  transition: transform 0.2s ease;
}

.kb-qa-hot-refresh:hover:not(:disabled) svg {
  transform: rotate(-35deg);
}

.kb-qa-hot-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.kb-qa-hot-item {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--n-color-text) 10%, transparent);
  background: color-mix(in srgb, var(--n-color-bg-elevated) 92%, transparent);
  color: var(--n-color-text-secondary);
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease;
}

.kb-qa-hot-item:hover {
  border-color: color-mix(in srgb, var(--n-color-primary) 35%, transparent);
  background: color-mix(in srgb, var(--n-color-primary) 6%, transparent);
}

.kb-qa-error {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, #ff3b30 10%, transparent);
  color: color-mix(in srgb, #ff3b30 85%, var(--n-color-text-primary));
  font-size: 12px;
  line-height: 1.45;
}

.kb-qa-msg-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.kb-qa-row {
  display: flex;
}

.kb-qa-row.user {
  justify-content: flex-end;
}

.kb-qa-row.assistant {
  justify-content: flex-start;
}

.kb-qa-msg-enter-active {
  transition:
    opacity 0.42s var(--kb-qa-ease-out),
    transform 0.48s var(--kb-qa-ease-out),
    filter 0.42s ease;
}

.kb-qa-msg-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.24s ease;
}

.kb-qa-msg-move {
  transition: transform 0.28s var(--kb-qa-ease-out);
}

.kb-qa-msg-enter-from {
  opacity: 0;
  filter: blur(4px);
  transform: translateY(14px) scale(0.97);
}

.kb-qa-msg-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.kb-qa-row.user .kb-qa-msg-enter-from,
.kb-qa-msg-enter-from.user {
  transform: translateY(10px) translateX(8px) scale(0.97);
}

.kb-qa-bubble {
  max-width: 92%;
  padding: 11px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
}

.kb-qa-bubble.user {
  background: color-mix(in srgb, var(--n-color-primary) 14%, var(--n-color-bg-elevated));
  color: var(--n-color-text-primary);
  border: 1px solid color-mix(in srgb, var(--n-color-primary) 22%, transparent);
  border-bottom-right-radius: 6px;
}

.kb-qa-bubble.assistant {
  background: var(--n-color-bg-glass-weak);
  border: 1px solid var(--n-color-border-soft);
  color: var(--n-color-text-primary);
  border-bottom-left-radius: 6px;
}

.kb-qa-bubble.assistant.is-streaming {
  border-color: color-mix(in srgb, var(--n-color-primary) 28%, var(--n-color-border-soft));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--n-color-primary) 8%, transparent);
}

.kb-qa-user-text {
  white-space: pre-wrap;
}

/* 流式输出：句末光标 + 轻淡入 */
.kb-qa-assistant-md.is-streaming {
  opacity: 1;
}

.kb-qa-assistant-md.is-streaming::after {
  content: '';
  display: inline-block;
  width: 2px;
  height: 1.05em;
  margin-left: 2px;
  vertical-align: -0.12em;
  border-radius: 1px;
  background: var(--n-color-primary);
  box-shadow: 0 0 8px color-mix(in srgb, var(--n-color-primary) 45%, transparent);
  animation: kb-qa-caret-blink 1s steps(1) infinite;
}

@keyframes kb-qa-caret-blink {
  0%,
  45% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

.kb-qa-typing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 2px 0;
  color: var(--n-color-text-tertiary);
  font-size: 13px;
}

.kb-qa-typing-label {
  letter-spacing: 0.01em;
  color: var(--n-color-text-tertiary);
}

.kb-qa-typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 2px;
}

.kb-qa-typing-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--n-color-primary) 75%, var(--n-color-text-tertiary));
  animation: kb-qa-dot 1.15s ease-in-out infinite;
}

.kb-qa-typing-dots i:nth-child(2) {
  animation-delay: 0.16s;
}

.kb-qa-typing-dots i:nth-child(3) {
  animation-delay: 0.32s;
}

@keyframes kb-qa-dot {
  0%,
  80%,
  100% {
    opacity: 0.35;
    transform: translateY(0) scale(0.85);
  }
  40% {
    opacity: 1;
    transform: translateY(-4px) scale(1.08);
  }
}

.kb-qa-sources {
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--n-color-border-soft);
}

.kb-qa-sources-title {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--n-color-text-secondary);
}

.kb-qa-sources ul {
  margin: 0;
  padding-left: 18px;
}

.kb-qa-source-link {
  border: none;
  background: none;
  padding: 0;
  color: var(--n-color-link);
  font: inherit;
  text-align: left;
  cursor: pointer;
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--n-color-link) 35%, transparent);
  transition: color 0.15s ease, border-color 0.15s ease;
}

.kb-qa-source-link:hover {
  color: var(--n-color-link-hover);
  border-color: var(--n-color-link-hover);
}

.kb-qa-msg-actions {
  margin-top: 6px;
  display: flex;
  justify-content: flex-end;
}

.kb-qa-copy-btn {
  border: none;
  background: transparent;
  color: var(--n-color-text-tertiary);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
  transition: color 0.15s ease, background 0.15s ease;
}

.kb-qa-copy-btn:hover {
  color: var(--n-color-text-secondary);
  background: var(--n-control-bg);
}

.kb-qa-footer {
  width: 100%;
  min-width: 0;
  margin: 0;
  align-items: stretch;
  flex-shrink: 0;
  padding: 10px 12px 10px;
  border-top: 1px solid var(--n-color-border-soft);
  background: color-mix(in srgb, var(--n-color-bg-glass) 55%, transparent);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 对齐 j2a：输入区下方 AI 内容核实提示 */
.kb-qa-disclaimer {
  margin: 0;
  padding: 0 4px;
  color: var(--n-color-primary);
  font-size: 10px;
  line-height: 1.25;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}

.kb-qa-input-shell {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 8px 8px 8px 12px;
  border: 1px solid var(--n-color-border-soft);
  border-radius: 16px;
  background: var(--n-color-bg-elevated);
  box-shadow: var(--n-shadow-elevation-1);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.kb-qa-input-shell:focus-within {
  border-color: color-mix(in srgb, var(--n-color-primary) 40%, var(--n-color-border-soft));
  box-shadow:
    var(--n-shadow-elevation-1),
    0 0 0 3px color-mix(in srgb, var(--n-color-primary) 12%, transparent);
}

.kb-qa-input {
  flex: 1;
  min-width: 0;
  resize: none;
  border: none;
  outline: none;
  padding: 6px 0;
  background: transparent;
  color: var(--n-color-text-primary);
  font: inherit;
  line-height: 1.45;
  max-height: 96px;
}

.kb-qa-send {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: var(--n-color-primary);
  color: var(--n-color-text-inverse);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition:
    transform 0.16s var(--kb-qa-ease),
    background 0.16s ease,
    opacity 0.16s ease;
}

.kb-qa-send:hover:not(:disabled) {
  background: var(--n-color-primary-hover);
  transform: translateY(-1px);
}

.kb-qa-send:active:not(:disabled) {
  transform: scale(0.96);
}

.kb-qa-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.kb-qa-send--busy {
  background: var(--kb-qa-busy-bg);
}

.kb-qa-send--busy:hover {
  background: var(--kb-qa-busy-bg-hover);
}

.kb-qa-send-stop-square {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: currentColor;
}

@keyframes kb-qa-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<style>
/* iOS Safari 会将字号小于 16px 的表单控件自动放大 */
@supports (-webkit-touch-callout: none) {
  .kb-qa-input,
  .kb-qa-ask-input {
    font-size: 16px !important;
  }
}

/* 主题切换需穿透 scoped，按 html[data-theme] 显隐 logo */
.kb-qa-brand-logo--light {
  display: block;
}

.kb-qa-brand-logo--dark {
  display: none;
}

:root[data-theme='dark'] .kb-qa-brand-logo--light {
  display: none;
}

:root[data-theme='dark'] .kb-qa-brand-logo--dark {
  display: block;
}
</style>
