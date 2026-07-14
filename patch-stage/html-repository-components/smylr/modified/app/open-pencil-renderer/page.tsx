import { SmylrOpenPencilComponentRenderer } from '@/components/runtime/smylr-open-pencil-component-renderer'

type OpenPencilRendererPageProps = {
  searchParams: Promise<{
    component?: string | string[]
    embed?: string | string[]
  }>
}

export default async function OpenPencilRendererPage({
  searchParams,
}: OpenPencilRendererPageProps) {
  const params = await searchParams
  const componentId =
    typeof params.component === 'string' ? params.component : 'button'
  const embedded = params.embed === '1'

  return (
    <SmylrOpenPencilComponentRenderer
      componentId={componentId}
      embedded={embedded}
    />
  )
}
