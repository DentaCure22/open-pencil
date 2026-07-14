import { SmylrOpenPencilComponentRenderer } from '@/components/runtime/smylr-open-pencil-component-renderer'

type OpenPencilRendererPageProps = {
  searchParams: Promise<{ component?: string | string[] }>
}

export default async function OpenPencilRendererPage({
  searchParams,
}: OpenPencilRendererPageProps) {
  const params = await searchParams
  const componentId =
    typeof params.component === 'string' ? params.component : 'button'

  return <SmylrOpenPencilComponentRenderer componentId={componentId} />
}
