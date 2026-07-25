import { IS_BROWSER } from '@/constants'

const INVITE_QUERY_KEY = 'invite'
const INVITE_PATTERN = /^[0-9a-f]{64}$/

export function readInviteToken(url = IS_BROWSER ? window.location.href : null) {
  if (!url) return null
  const token = new URL(url).searchParams.get(INVITE_QUERY_KEY)?.toLocaleLowerCase() ?? null
  return token && INVITE_PATTERN.test(token) ? token : null
}

export function clearInviteTokenFromBrowserUrl() {
  if (!IS_BROWSER) return
  const url = new URL(window.location.href)
  if (!url.searchParams.has(INVITE_QUERY_KEY)) return
  url.searchParams.delete(INVITE_QUERY_KEY)
  window.history.replaceState(window.history.state, '', url)
}

export function buildCofounderInviteUrl(
  token: string,
  sourceUrl = IS_BROWSER ? window.location.href : 'https://app.openpencil.dev/'
) {
  if (!INVITE_PATTERN.test(token)) throw new Error('OpenPencil invite token is invalid')
  const url = new URL(sourceUrl)
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  url.searchParams.set(INVITE_QUERY_KEY, token)
  return url.toString()
}
