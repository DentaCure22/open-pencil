const OPEN_PENCIL_EMBED_PATH = '/open-pencil'

export function resolveBrowserAssetPath(
  file: string,
  configuredBase: string,
  pathname: string
): string {
  const runtimeBase =
    configuredBase === '/' &&
    (pathname === OPEN_PENCIL_EMBED_PATH || pathname.startsWith(`${OPEN_PENCIL_EMBED_PATH}/`))
      ? `${OPEN_PENCIL_EMBED_PATH}/`
      : configuredBase
  const prefix = runtimeBase === '/' ? '' : runtimeBase.replace(/\/$/, '')
  return file.startsWith('/') ? `${prefix}${file}` : `${prefix}/${file}`
}
