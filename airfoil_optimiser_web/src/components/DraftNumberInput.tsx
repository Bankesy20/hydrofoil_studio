import { useEffect, useRef, useState } from 'react'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'onBlur'> & {
  value: number
  onCommit: (n: number) => void
  min?: number
  max?: number
  /** Snap to grid on commit, e.g. 0.25 for α (deg) or 0.05 for Δα */
  roundTo?: number
}

function numToStr(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (Number.isInteger(n)) return String(Math.round(n))
  const r = Math.round(n * 1e6) / 1e6
  let s = String(r)
  if (s.includes('e')) s = r.toFixed(8).replace(/\.?0+$/, '')
  return s
}

/**
 * Text-based numeric field: allows free typing (including "-" / partial decimals)
 * and commits on blur or Enter. Avoids glitchy controlled {@link HTMLInputElement#type}=number.
 */
export function DraftNumberInput({ value, onCommit, min, max, roundTo, className, ...rest }: Props) {
  const lastCommitted = useRef(value)
  const [text, setText] = useState(() => numToStr(value))

  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value
      setText(numToStr(value))
    }
  }, [value])

  const commit = () => {
    const raw = text.trim().replace(/,/g, '')
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
      setText(numToStr(lastCommitted.current))
      return
    }
    let n = Number(raw)
    if (!Number.isFinite(n)) {
      setText(numToStr(lastCommitted.current))
      return
    }
    if (roundTo !== undefined && roundTo > 0) {
      n = Math.round(n / roundTo) * roundTo
    }
    if (min !== undefined) n = Math.max(min, n)
    if (max !== undefined) n = Math.min(max, n)
    lastCommitted.current = n
    onCommit(n)
    setText(numToStr(n))
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={className}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      {...rest}
    />
  )
}
