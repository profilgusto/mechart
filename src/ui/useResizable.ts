import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Tamanho (largura ou altura, em px) ajustável por arraste e lembrado no
 * localStorage. `sign` inverte o delta para painéis que crescem para a
 * esquerda/cima (ex.: o inspetor, arrastado pela borda esquerda).
 */
export function useResizable({
  storageKey,
  initial,
  min,
  max,
  axis,
  sign = 1,
}: {
  storageKey: string
  initial: number
  min: number
  max: number
  axis: 'x' | 'y'
  sign?: 1 | -1
}) {
  const [size, setSize] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : initial
    } catch {
      return initial
    }
  })
  const dragging = useRef<{ start: number; startSize: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(size))
    } catch {
      // modo privado: a preferencia simplesmente nao persiste
    }
  }, [storageKey, size])

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return
      const pos = axis === 'x' ? e.clientX : e.clientY
      const delta = (pos - dragging.current.start) * sign
      setSize(Math.min(max, Math.max(min, dragging.current.startSize + delta)))
    },
    [axis, sign, min, max],
  )

  const stop = useCallback(() => {
    dragging.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stop)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [onPointerMove])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragging.current = { start: axis === 'x' ? e.clientX : e.clientY, startSize: size }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', stop)
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [axis, size, onPointerMove, stop],
  )

  const reset = useCallback(() => setSize(initial), [initial])

  return { size, onPointerDown, reset }
}

/** Booleano lembrado no localStorage (ex.: painel escondido ou não). */
export function useStoredFlag(storageKey: string, initial = false) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw === null ? initial : raw === '1'
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, value ? '1' : '0')
    } catch {
      // modo privado: a preferencia simplesmente nao persiste
    }
  }, [storageKey, value])

  return [value, setValue] as const
}
