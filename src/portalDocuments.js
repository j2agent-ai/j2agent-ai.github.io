const cache = new Map()
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/')

export const createPortalDocumentStore = ({baseUrl, index}) => {
  let activeRequest = null
  const load = async (path) => {
    if (cache.has(path)) return cache.get(path)
    activeRequest?.abort()
    const controller = new AbortController()
    activeRequest = controller
    try {
      const response = await fetch(`${baseUrl}${encodePath(path)}`, {signal: controller.signal})
      if (!response.ok) throw new Error(`Document unavailable: ${response.status}`)
      const source = await response.text()
      cache.set(path, source)
      return source
    } finally {
      if (activeRequest === controller) activeRequest = null
    }
  }
  return {
    list: () => index.map(([path, title]) => ({path, title})),
    load,
    cancel: () => activeRequest?.abort()
  }
}
