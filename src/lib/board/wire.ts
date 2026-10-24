import type { BoardElement } from './types'

/** wire format used by WS service + REST API: { id, type, data: {...rest} } */
export interface WireElement {
  id: string
  type: string
  data: Record<string, unknown>
}

export function toWire(el: BoardElement): WireElement {
  const { id, type, ...rest } = el
  return { id, type, data: rest as Record<string, unknown> }
}

export function fromWire(raw: WireElement | Partial<BoardElement>): BoardElement | null {
  if (!raw || typeof raw !== 'object') return null
  const id = (raw as WireElement).id
  const type = (raw as WireElement).type
  if (typeof id !== 'string' || typeof type !== 'string') return null
  const wire = raw as WireElement
  let rest: Record<string, unknown>
  if (wire.data && typeof wire.data === 'object' && !Array.isArray(wire.data)) {
    rest = wire.data
  } else {
    const { id: _i, type: _t, ...r } = raw as Record<string, unknown>
    rest = r
  }
  // validate required fields per type to protect the render loop from corrupt data
  const num = (v: unknown) => typeof v === 'number' && isFinite(v)
  switch (type) {
    case 'path':
      if (!Array.isArray(rest.points) || !rest.points.every((n) => typeof n === 'number')) return null
      if (typeof rest.color !== 'string' || !num(rest.width)) return null
      break
    case 'rect':
    case 'ellipse':
    case 'arrow':
    case 'sticky':
      if (!(num(rest.x) && num(rest.y) && num(rest.w) && num(rest.h))) return null
      if (typeof rest.color !== 'string') return null
      break
    case 'text':
      if (!(num(rest.x) && num(rest.y) && num(rest.size))) return null
      if (typeof rest.color !== 'string' || typeof rest.text !== 'string') return null
      break
    case 'func': {
      if (!(num(rest.x) && num(rest.y) && num(rest.w) && num(rest.h))) return null
      // PNG snapshot with a sane size cap (base64 of a graph is tens of KB)
      if (typeof rest.img !== 'string' || !rest.img.startsWith('data:image/png')) return null
      if (rest.img.length > 3_500_000) return null
      if (typeof rest.expr !== 'string' || rest.expr.length > 2000) return null
      const v = rest.view as { cx?: unknown; cy?: unknown; scale?: unknown } | null | undefined
      if (!v || !num(v.cx) || !num(v.cy) || !num(v.scale)) return null
      if (rest.srcId !== undefined && (typeof rest.srcId !== 'string' || rest.srcId.length > 64)) return null
      break
    }
    case 'image': {
      if (!(num(rest.x) && num(rest.y) && num(rest.w) && num(rest.h))) return null
      // photo dataURL with a sane size cap (import pipeline downscales anyway)
      if (
        typeof rest.img !== 'string' ||
        !(rest.img.startsWith('data:image/png') || rest.img.startsWith('data:image/jpeg'))
      )
        return null
      if (rest.img.length > 3_500_000) return null
      break
    }
    case 'line': {
      if (!(num(rest.x) && num(rest.y) && num(rest.w) && num(rest.h))) return null
      if (typeof rest.color !== 'string' || !num(rest.strokeWidth)) return null
      rest.dashed = rest.dashed === true
      break
    }
    case 'solid3': {
      if (rest.shape !== 'cube' && rest.shape !== 'box' && rest.shape !== 'prism' && rest.shape !== 'pyramid') return null
      const vs = rest.vertices as unknown
      if (!Array.isArray(vs) || vs.length < 4 || vs.length > 200) return null
      for (const v of vs as Array<Record<string, unknown>>) {
        if (!(v && num(v.x) && num(v.y) && num(v.z))) return null
      }
      const es = rest.edges as unknown
      if (!Array.isArray(es) || es.length < 6 || es.length > 400) return null
      for (const e of es as Array<Record<string, unknown>>) {
        if (!e || !Number.isInteger(e.a) || !Number.isInteger(e.b)) return null
        if ((e.a as number) === (e.b as number)) return null
        if ((e.a as number) < 0 || (e.b as number) < 0) return null
        if ((e.a as number) >= vs.length || (e.b as number) >= vs.length) return null
      }
      const fs = rest.faces as unknown
      if (!Array.isArray(fs) || fs.length < 4 || fs.length > 60) return null
      for (const f of fs as unknown[]) {
        if (!Array.isArray(f) || f.length < 3) return null
        for (const i of f) {
          if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= vs.length) return null
        }
      }
      if (typeof rest.color !== 'string' || !num(rest.strokeWidth)) return null
      break
    }
    default:
      return null
  }
  return { id, type, ...rest } as unknown as BoardElement
}
