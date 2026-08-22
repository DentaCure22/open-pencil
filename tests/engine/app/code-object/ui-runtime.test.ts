import { describe, expect, test } from 'bun:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  ConfiguredBlock,
  normalizeEstimatesListModel,
  normalizeFinancialDashboardModel,
  normalizeVideoPlayerModel,
  VideoPlayer
} from '@/app/code-object/ui-runtime'

describe('Code Object UI runtime', () => {
  test('normalizes a JSON-configured financial dashboard', () => {
    const model = normalizeFinancialDashboardModel({
      actions: [
        { label: 'Review', prompt: 'Review the report.' },
        { label: '', prompt: 'Skip' }
      ],
      companyName: '  Demo Company  ',
      keyNumbers: [{ label: 'Revenue', series: [1, 2, Number.NaN, 4], value: '$42K' }, 'invalid'],
      overallRead: 'strong',
      table: {
        columns: [
          { key: 'driver', label: 'Driver' },
          { align: 'right', key: 'value', label: 'Value' }
        ],
        rows: [{ driver: 'Receipts', ignored: true, value: 42 }],
        title: 'Details'
      }
    })

    expect(model.companyName).toBe('Demo Company')
    expect(model.overallRead).toBe('strong')
    expect(model.keyNumbers).toHaveLength(1)
    expect(model.keyNumbers[0]?.series).toEqual([1, 2, 4])
    expect(model.actions).toEqual([{ label: 'Review', prompt: 'Review the report.' }])
    expect(model.table?.rows).toEqual([{ driver: 'Receipts', value: 42 }])
  })

  test('supplies useful defaults for missing data', () => {
    expect(normalizeFinancialDashboardModel(null)).toMatchObject({
      companyName: 'Connected business',
      keyNumbers: [],
      overallRead: 'mixed',
      period: 'Current period',
      title: 'Business health'
    })
  })

  test('renders through the registered component and fails closed on invalid config', () => {
    const dashboard = renderToStaticMarkup(
      createElement(ConfiguredBlock, {
        block: 'financial-dashboard',
        config: { companyName: 'Demo Company', title: 'Business health' }
      })
    )
    expect(dashboard).toContain('Demo Company')
    expect(dashboard).toContain('Business health')

    const invalid = renderToStaticMarkup(
      createElement(ConfiguredBlock, {
        block: 'financial-dashboard',
        config: { company: 'Misspelled field' }
      })
    )
    expect(invalid).toContain('Invalid UI block configuration')
  })

  test('renders connected estimates through the registry', () => {
    const config = {
      companyName: 'QuickBooks · TEST DATA',
      estimates: [
        {
          amount: 100,
          currencyCode: 'USD',
          currencySymbol: '$',
          customer: 'TEST - AI Solutions Demo',
          date: '2026-08-08',
          id: 'estimate:1006',
          itemSummary: 'TEST - Demo Consultation',
          referenceNumber: '1006',
          status: 'pending'
        }
      ],
      sourceLabel: 'Connected QuickBooks data',
      title: 'Estimates'
    }
    expect(normalizeEstimatesListModel(config)).toMatchObject({
      estimates: [{ amount: 100, referenceNumber: '1006', status: 'pending' }]
    })
    const estimates = renderToStaticMarkup(
      createElement(ConfiguredBlock, { block: 'estimates-list', config })
    )
    expect(estimates).toContain('TEST - AI Solutions Demo')
    expect(estimates).toContain('#1006')
    expect(estimates).toContain('$100.00')
  })

  test('exports and renders the reusable video player through the registry', () => {
    const model = normalizeVideoPlayerModel({
      controls: true,
      fit: 'cover',
      src: 'https://example.com/generated.webm',
      title: 'Generated motion study'
    })
    expect(model).toMatchObject({
      autoplay: false,
      controls: true,
      fit: 'cover',
      src: 'https://example.com/generated.webm',
      title: 'Generated motion study'
    })

    const direct = renderToStaticMarkup(createElement(VideoPlayer, model))
    expect(direct).toContain('data-video-player')
    expect(direct).toContain('Generated motion study')

    const configured = renderToStaticMarkup(
      createElement(ConfiguredBlock, {
        block: 'video-player',
        config: model,
        interactionEnabled: true
      })
    )
    expect(configured).toContain('<video')
    expect(configured).toContain('controls=""')
    expect(configured).toContain('https://example.com/generated.webm')
  })
})
