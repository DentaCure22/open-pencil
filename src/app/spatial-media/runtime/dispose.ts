import type { Material, Object3D, Texture, WebGLRenderer } from 'three'

type RenderableObject = Object3D & {
  geometry?: { dispose: () => void }
  material?: Material | Material[]
}

function texturesFor(material: Material): Texture[] {
  return Object.values(material).filter((value): value is Texture =>
    Boolean(value && typeof value === 'object' && 'isTexture' in value)
  )
}

export function disposeObject3D(root: Object3D): void {
  const geometries = new Set<{ dispose: () => void }>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    const renderable = object as RenderableObject
    if (renderable.geometry) geometries.add(renderable.geometry)
    const objectMaterials: Material[] = []
    if (Array.isArray(renderable.material)) objectMaterials.push(...renderable.material)
    else if (renderable.material) objectMaterials.push(renderable.material)
    for (const material of objectMaterials) {
      materials.add(material)
      for (const texture of texturesFor(material)) textures.add(texture)
    }
  })
  for (const texture of textures) texture.dispose()
  for (const material of materials) material.dispose()
  for (const geometry of geometries) geometry.dispose()
  root.clear()
}

export function disposeWebGLRenderer(renderer: WebGLRenderer): void {
  renderer.setAnimationLoop(null)
  renderer.renderLists.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
  renderer.domElement.remove()
}
