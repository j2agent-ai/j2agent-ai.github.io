/**
 * 替代 @ai-system/lib 的精简 i18n。
 * 签名对齐 j2a：t(key, params?, fallback?)
 */
const messages: Record<string, string> = {
  'markdownRenderer.copyCode': '复制代码',
  'markdownRenderer.copy': '复制',
  'markdownRenderer.diagramError.copyAllDiagnostics': '反馈给 AI',
  'markdownRenderer.copyAll': '全部复制',
  'markdownRenderer.diagramError.viewDetails': '查看错误详情',
  'mdViewer.loading': '加载中…',
  'mdViewer.loadFailed': '无法加载文档',
  'mdViewer.download': '下载',
  'mdViewer.close': '关闭预览',
  'mdViewer.prev': '上一份',
  'mdViewer.next': '下一份',
  'diagramPreview.saveSvg': '保存 SVG',
  'common.success': '成功',
  'common.fail': '失败'
}

export function t(
  key: string,
  _params?: unknown,
  fallback?: string
): string {
  return messages[key] ?? fallback ?? key
}

export const locale = {
  lang: {
    value: 'zh'
  }
}
