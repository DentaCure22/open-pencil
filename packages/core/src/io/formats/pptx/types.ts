export type PptxTextAlign = 'CENTER' | 'JUSTIFIED' | 'LEFT' | 'RIGHT'

export type PptxVerticalAlign = 'BOTTOM' | 'CENTER' | 'TOP'

export type PptxElementBase = {
  height: number
  name: string
  width: number
  x: number
  y: number
}

export type PptxShapeElement = PptxElementBase & {
  cornerRadius: number
  fillColor: string | null
  kind: 'shape'
  shape: 'ellipse' | 'line' | 'rectangle'
  strokeColor: string | null
  strokeWidth: number
}

export type PptxTextElement = PptxElementBase & {
  backgroundColor: string | null
  color: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  kind: 'text'
  text: string
  textAlign: PptxTextAlign
  verticalAlign: PptxVerticalAlign
}

export type PptxElement = PptxShapeElement | PptxTextElement

export type PptxSlide = {
  backgroundColor: string
  elements: PptxElement[]
  name: string
}

export type PptxDeck = {
  height: number
  slides: PptxSlide[]
  width: number
}
