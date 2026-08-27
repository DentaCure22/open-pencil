import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

import type { DataChartModel, DataChartSeries } from '../types'

const SERIES_COLORS = [
  'var(--code-accent)',
  'var(--code-success)',
  'var(--code-warning)',
  'var(--code-danger)',
  '#7c83e8',
  '#2b8ea1'
]

function colorFor(series: DataChartSeries, index: number): string {
  return series.color ?? SERIES_COLORS[index % SERIES_COLORS.length]
}

function chartData(model: DataChartModel): Array<Record<string, number | string>> {
  return model.labels.map((label, index) => {
    const row: Record<string, number | string> = { label }
    for (const series of model.series) row[series.id] = series.values[index] ?? 0
    return row
  })
}

const axisStyle = { fill: 'var(--code-text-muted)', fontSize: 10 }
const chartMargin = { bottom: 0, left: -12, right: 12, top: 10 }

function sharedChartParts(model: DataChartModel) {
  return (
    <>
      <CartesianGrid stroke="var(--code-border)" strokeDasharray="3 3" vertical={false} />
      <XAxis axisLine={false} dataKey="label" tick={axisStyle} tickLine={false} />
      <YAxis axisLine={false} tick={axisStyle} tickLine={false} width={48} />
      <Tooltip
        contentStyle={{
          background: 'var(--code-surface-elevated)',
          border: '1px solid var(--code-border)',
          borderRadius: 'var(--code-radius)',
          color: 'var(--code-text)',
          fontSize: 12
        }}
        cursor={{ fill: 'var(--code-surface)' }}
        itemStyle={{ color: 'var(--code-text)' }}
        labelStyle={{ color: 'var(--code-text-muted)' }}
      />
      {model.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
    </>
  )
}

function chartFor(model: DataChartModel, data: Array<Record<string, number | string>>) {
  if (model.kind === 'bar') {
    return (
      <BarChart data={data} margin={chartMargin}>
        {sharedChartParts(model)}
        {model.series.map((series, index) => (
          <Bar
            dataKey={series.id}
            fill={colorFor(series, index)}
            isAnimationActive={false}
            key={series.id}
            name={series.label}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    )
  }
  if (model.kind === 'area') {
    return (
      <AreaChart data={data} margin={chartMargin}>
        {sharedChartParts(model)}
        {model.series.map((series, index) => (
          <Area
            dataKey={series.id}
            fill={colorFor(series, index)}
            fillOpacity={0.14}
            isAnimationActive={false}
            key={series.id}
            name={series.label}
            stroke={colorFor(series, index)}
            strokeWidth={2}
            type="monotone"
          />
        ))}
      </AreaChart>
    )
  }
  return (
    <LineChart data={data} margin={chartMargin}>
      {sharedChartParts(model)}
      {model.series.map((series, index) => (
        <Line
          dataKey={series.id}
          dot={false}
          isAnimationActive={false}
          key={series.id}
          name={series.label}
          stroke={colorFor(series, index)}
          strokeWidth={2}
          type="monotone"
        />
      ))}
    </LineChart>
  )
}

export function DataChart({ model }: { model: DataChartModel }) {
  const data = chartData(model)
  if (data.length === 0 || model.series.length === 0) return null

  return (
    <div style={{ height: 260, width: '100%' }}>
      <ResponsiveContainer height="100%" width="100%">
        {chartFor(model, data)}
      </ResponsiveContainer>
    </div>
  )
}
