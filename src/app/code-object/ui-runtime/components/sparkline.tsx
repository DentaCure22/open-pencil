import { useId } from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'

export function Sparkline({ values }: { values: number[] }) {
  const gradientId = `sparkline-${useId().replaceAll(':', '')}`
  const data = values.map((value, index) => ({ index, value }))

  if (data.length < 2) return null

  return (
    <div aria-hidden="true" className="h-11 w-full text-accent">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={data} margin={{ bottom: 1, left: 1, right: 1, top: 1 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            dataKey="value"
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            stroke="currentColor"
            strokeWidth={2}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
