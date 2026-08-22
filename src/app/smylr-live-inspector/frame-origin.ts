const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])
const DEFAULT_SMYLR_DEV_PORT = '3000'

interface SmylrOpenPencilFrameUrlOptions {
  baseUrl: string
  openPencilHref: string
  params?: Readonly<Record<string, string>>
  route: string
}

export function canonicalSmylrOpenPencilUrlFor(openPencilHref: string) {
  const url = new URL(openPencilHref)
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    url.protocol = 'http:'
    if (url.hostname === '::1' || url.hostname === '[::1]') url.hostname = '127.0.0.1'
    url.port = DEFAULT_SMYLR_DEV_PORT
  }
  return url.href
}

export function smylrFrameBaseUrlFor(openPencilHref: string) {
  return new URL(canonicalSmylrOpenPencilUrlFor(openPencilHref)).origin
}

export function smylrOpenPencilFrameUrlFor({
  baseUrl,
  openPencilHref,
  params,
  route
}: SmylrOpenPencilFrameUrlOptions) {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`
  const base = new URL(`${baseUrl.replace(/\/+$/, '')}/`)
  const requested = new URL(normalizedRoute, base)
  const url = new URL(`${requested.pathname}${requested.search}${requested.hash}`, base)
  for (const [name, value] of Object.entries(params ?? {})) {
    url.searchParams.set(name, value)
  }
  url.searchParams.set('smylr-openpencil', '1')
  url.searchParams.set('smylr-openpencil-parent-origin', new URL(openPencilHref).origin)
  return url.href
}
