export const allowedDomains = ['c13sv18hodb.feishu.cn', 'bitnp.net'] as const

export const isAllowedUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    return hostname === allowedDomains[0]
      || hostname === allowedDomains[1]
      || hostname.endsWith(`.${allowedDomains[1]}`)
  } catch {
    return false
  }
}
