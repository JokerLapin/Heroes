import React, { useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Player = { id: string; name: string; seat: number; pa?: number; ph?: number; paMax?: number; phMax?: number }
type Selection = { playerId: string; index: number }
type Pawn = { playerId: string; index: number }
type RoomState = {
  roomId?: string
  players?: Player[]
  currentPlayerId?: string | null
  board?: { selections?: Selection[]; pawns?: Pawn[] }
}

type AlignJSON = { offX?: number; offY?: number; mult?: number }

const socket: Socket = io()

const safePlayers = (s?: Player[]) => Array.isArray(s) ? s : []
const safeSelections = (b?: RoomState['board']) => Array.isArray(b?.selections) ? b!.selections! : []
const safePawns = (b?: RoomState['board']) => Array.isArray(b?.pawns) ? b!.pawns! : []

function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i)
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 65%, 50%)`
}
type ActionMode = 'ping' | 'move'

function median(nums: number[]) {
  const a = [...nums].sort((x, y) => x - y)
  const n = a.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  return n % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

export default function App() {
  const [connected, setConnected] = useState(false)
  const [mySocketId, setMySocketId] = useState('')
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('TEST01')
  const [joined, setJoined] = useState(false)

  const [state, setState] = useState<RoomState>({
    roomId: '',
    players: [],
    currentPlayerId: null,
    board: { selections: [], pawns: [] },
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const overlayWrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // Les hex filtrés + centres (dans le repère natif du SVG)
  const [hexCenters, setHexCenters] = useState<Array<{cx:number, cy:number}>>([])
  const [hexCount, setHexCount] = useState(0)

  const [containerSize, setContainerSize] = useState<{w:number, h:number}>({w:0, h:0})
  const [nativeSize, setNativeSize] = useState<{w:number, h:number}>({w:0, h:0})

  const [mode, setMode] = useState<ActionMode>('ping')
  const [alignSrc, setAlignSrc] = useState<AlignJSON | null>(null)

  // DEBUG UI
  const [debugOverlay, setDebugOverlay] = useState(false)
  const [lastClick, setLastClick] = useState<number | null>(null)

  // Responsive measure du conteneur image
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect
        setContainerSize({ w: cr.width, h: cr.height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Socket
  useEffect(() => {
    const onConnect = () => { setConnected(true); setMySocketId(socket.id) }
    const onDisconnect = () => setConnected(false)
    const onUpdate = (s: RoomState) => {
      const hardened: RoomState = {
        roomId: s.roomId ?? '',
        players: safePlayers(s.players),
        currentPlayerId: s.currentPlayerId ?? null,
        board: { selections: safeSelections(s.board), pawns: safePawns(s.board) }
      }
      setState(hardened)
      if (hardened.players!.some(p => p.id === socket.id)) setJoined(true)
    }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('state:update', onUpdate)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('state:update', onUpdate)
    }
  }, [])

  // Align JSON
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/overlay-align.json', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as AlignJSON
        setAlignSrc({ offX: Number(json.offX) || 0, offY: Number(json.offY) || 0, mult: typeof json.mult === 'number' ? json.mult : 1 })
      } catch {}
    })()
  }, [])

  // Charge le SVG inline, filtre les VRAIS hex, ordonne, attache les clics
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/assets/hex-overlay.svg', { cache: 'no-store' })
        if (!res.ok) return
        const text = await res.text()
        if (cancelled) return

        const parser = new DOMParser()
        const doc = parser.parseFromString(text, 'image/svg+xml')
        const inlineSvg = doc.documentElement as unknown as SVGSVGElement

        // Taille native via viewBox ou width/height
        if (inlineSvg.viewBox && inlineSvg.viewBox.baseVal) {
          const vb = inlineSvg.viewBox.baseVal
          setNativeSize({ w: vb.width, h: vb.height })
        } else {
          const w = Number(inlineSvg.getAttribute('width')) || 0
          const h = Number(inlineSvg.getAttribute('height')) || 0
          setNativeSize({ w, h })
        }

        inlineSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
        inlineSvg.style.width = '100%'
        inlineSvg.style.height = '100%'

        // Injecte dans le DOM
        const wrap = overlayWrapRef.current
        if (!wrap) return
        wrap.innerHTML = ''
        wrap.appendChild(inlineSvg)
        svgRef.current = inlineSvg

        // Récupère toutes les formes candidates (paths + polygons)
        const allShapes = Array.from(inlineSvg.querySelectorAll<SVGGraphicsElement>('polygon, path'))

        // Exclure les éléments invisibles / techniques (<defs>, <mask>, etc.)
        const isInHiddenContainer = (el: Element) => {
          let p: Element | null = el
          while (p) {
            const tag = p.tagName.toLowerCase()
            if (tag === 'defs' || tag === 'mask' || tag === 'clipPath') return true
            p = p.parentElement
          }
          return false
        }

        // 1) Filtrage initial : visible + bbox non nul
        const withBox = allShapes.map(el => {
          if (isInHiddenContainer(el)) return null
          let box: DOMRect
          try { box = el.getBBox() } catch { return null }
          if (!box || box.width === 0 || box.height === 0) return null
          return { el, box }
        }).filter(Boolean) as Array<{el: SVGGraphicsElement, box: DOMRect}>

        // 2) Filtre par ratio ~ hex flat-top (h/w ≈ 0.866)
        const targetRatio = 0.866 // = sqrt(3)/2
        const ratioTol = 0.12     // ±12%
        const ratioFiltered = withBox.filter(({ box }) => {
          const r = box.height / box.width
          return r > targetRatio * (1 - ratioTol) && r < targetRatio * (1 + ratioTol)
        })

        // 3) Filtre par taille proche de la médiane (évite les grosses zones/artefacts)
        const widths = ratioFiltered.map(x => x.box.width)
        const heights = ratioFiltered.map(x => x.box.height)
        const medW = median(widths)
        const medH = median(heights)
        const sizeTol = 0.18 // ±18%
        const sizeFiltered = ratioFiltered.filter(({ box }) =>
          box.width  > medW * (1 - sizeTol) && box.width  < medW * (1 + sizeTol) &&
          box.height > medH * (1 - sizeTol) && box.height < medH * (1 + sizeTol)
        )

        // 4) Ordonner en lignes (top→bottom) puis colonnes (left→right)
        // On groupe les éléments par "ligne" à tolérance verticale
        const sorted = [...sizeFiltered].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
        const rowGap = medH * 0.6 // tolérance verticale pour regrouper
        const rows: Array<Array<{el: SVGGraphicsElement, box: DOMRect}>> = []
        for (const item of sorted) {
          const lastRow = rows[rows.length - 1]
          if (!lastRow) {
            rows.push([item])
            continue
          }
          const lastY = lastRow[0].box.y
          if (Math.abs(item.box.y - lastY) <= rowGap) {
            lastRow.push(item)
          } else {
            rows.push([item])
          }
        }
        rows.forEach(row => row.sort((a, b) => a.box.x - b.box.x))
        const hexList = rows.flat()

        // 5) Attacher les listeners au bon index (après tri !), styliser pour clic/hover
        hexList.forEach(({ el }, index) => {
          el.setAttribute('data-index', String(index))
          // fill transparent pour capter le clic
          const fill = el.getAttribute('fill')
          if (!fill || fill === 'none') el.setAttribute('fill', 'rgba(0,0,0,0)')
          ;(el as SVGElement).style.pointerEvents = 'all'
          // stroke léger en debug
          if (!el.getAttribute('stroke')) el.setAttribute('stroke', 'rgba(0,0,0,0.35)')

          el.addEventListener('mouseenter', () => {
            if (debugOverlay) el.setAttribute('stroke', 'rgba(0,0,0,0.8)')
          })
          el.addEventListener('mouseleave', () => {
            if (debugOverlay) el.setAttribute('stroke', 'rgba(0,0,0,0.35)')
          })
          el.addEventListener('click', () => {
            const rId = state.roomId || ''
            if (!rId) return
            console.log('[Heroes] click hex #', index)
            setLastClick(index)
            if (mode === 'ping') socket.emit('selectCell', { roomId: rId, index })
            else socket.emit('setPawn', { roomId: rId, index })
          })
        })

        // 6) Centres pour dessiner pions/pings au bon endroit (après TRI)
        const centers = hexList.map(({ el, box }) => {
          if (debugOverlay) (el as SVGElement).setAttribute('fill', 'rgba(0,150,255,0.12)')
          return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
        })

        setHexCount(hexList.length)
        setHexCenters(centers)
      } catch (e) {
        console.error('load svg error', e)
      }
    })()
    return () => { cancelled = true }
  }, [joined, mode, debugOverlay, state.roomId])

  // Échelle uniforme + offsets (responsive)
  const { scaleU, effOffX, effOffY } = useMemo(() => {
    const baseW = nativeSize.w, baseH = nativeSize.h
    if (!baseW || !baseH || !containerSize.w || !containerSize.h) {
      return { scaleU: 1, effOffX: 0, effOffY: 0 }
    }
    const k = Math.min(containerSize.w / baseW, containerSize.h / baseH)
    const mult = alignSrc?.mult ?? 1
    const offX = alignSrc?.offX ?? 0
    const offY = alignSrc?.offY ?? 0
    return { scaleU: k * mult, effOffX: offX * k, effOffY: offY * k }
  }, [nativeSize, containerSize, alignSrc])

  const overlayTransform = `translate(${effOffX}px, ${effOffY}px) scale(${scaleU})`

  // Helpers UI
  const me = useMemo(() => safePlayers(state.players).find(p => p.id === mySocketId), [state.players, mySocketId])
  const isMyTurn = useMemo(() => (state.currentPlayerId ?? null) !== null && state.currentPlayerId === mySocketId, [state.currentPlayerId, mySocketId])
  const canMove = isMyTurn && (me?.pa ?? 0) > 0
  const canMeditate = isMyTurn && (me?.pa ?? 0) > 0

  const endTurn = () => (state.roomId || '') && socket.emit('endTurn', { roomId: state.roomId })
  const meditate = () => (state.roomId || '') && socket.emit('meditate', { roomId: state.roomId })

  function initialsForPlayer(players: Player[], id: string) {
    const player = players.find(p => p.id === id)
    if (!player || !player.name) return '•'
    const parts = player.name.trim().split(/\s+/)
    const init = (parts[0]?.[0] || '').toUpperCase() + (parts[1]?.[0] || '').toUpperCase()
    return init || player.name[0].toUpperCase()
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Heroes — Overlay filtré & index stable</h1>
      <p>Socket: {connected ? '✅ connecté' : '❌ déconnecté'} · ID: {mySocketId || '...'}</p>

      {!joined ? (
        <form onSubmit={(e)=>{e.preventDefault(); const n=name.trim(); const r=roomId.trim(); if(n && r) socket.emit('joinRoom', { roomId: r, name: n })}} style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
          <label>Pseudo<br />
            <input value={name} onChange={e=>setName(e.target.value)} maxLength={24} placeholder="Ex: Alice" />
          </label>
          <label>Code de partie<br />
            <input value={roomId} onChange={e=>setRoomId(e.target.value.toUpperCase())} maxLength={12} />
          </label>
          <button type="submit" style={{ padding:'6px 12px' }}>Rejoindre / Créer la partie</button>
        </form>
      ) : (
        <section style={{ display:'grid', gridTemplateColumns:'1fr 360px', gap:16, alignItems:'start' }}>
          {/* Plateau */}
          <div ref={containerRef} style={{ position:'relative', width:'100%', maxWidth: 1200 }}>
            <img src="/assets/board.png" alt="Plateau" style={{ display:'block', width:'100%', height:'auto' }} />

            {/* Overlay inline (SVG) */}
            <div
              ref={overlayWrapRef}
              style={{
                position:'absolute', inset:0,
                transform: overlayTransform,
                transformOrigin:'top left',
                pointerEvents:'auto',
                zIndex: 10
              }}
            />

            {/* Pions + Pings (dans le même repère que l’overlay) */}
            <svg
              style={{
                position:'absolute', inset:0,
                transform: overlayTransform,
                transformOrigin:'top left',
                width:'100%', height:'100%',
                pointerEvents:'none',
                zIndex: 20
              }}
            >
              {/* Pions */}
              {safePawns(state.board).map(p => {
                const center = hexCenters[p.index]
                if (!center) return null
                const color = colorFor(p.playerId)
                const meIt = p.playerId === mySocketId
                return (
                  <g key={`pawn-${p.playerId}`}>
                    <circle cx={center.cx} cy={center.cy} r={10} fill={color} stroke="#000" strokeWidth={1} />
                    <text x={center.cx} y={center.cy + 3} fontSize="10" textAnchor="middle" fill="#fff" style={{fontWeight:600}}>
                      {initialsForPlayer(safePlayers(state.players), p.playerId)}
                    </text>
                    {meIt && <circle cx={center.cx} cy={center.cy} r={14} fill="none" stroke={color} strokeWidth={2} opacity={0.6} />}
                  </g>
                )
              })}
              {/* Pings */}
              {safeSelections(state.board).map(sel => {
                const center = hexCenters[sel.index]
                if (!center) return null
                return <circle key={`ping-${sel.playerId}-${sel.index}`} cx={center.cx} cy={center.cy} r={6} fill={colorFor(sel.playerId)} opacity={0.8} />
              })}
            </svg>
          </div>

          {/* Panneau latéral */}
          <div>
            <h3 style={{ margin:'0 0 8px' }}>Partie : {state.roomId}</h3>
            <ul style={{ marginTop:0, paddingLeft:16 }}>
              {safePlayers(state.players).map(p => (
                <li key={p.id}>
                  {p.name} {p.id === mySocketId ? '(toi)' : ''} {state.currentPlayerId === p.id ? '← à lui/elle de jouer' : ''}
                  {typeof p.pa === 'number' && typeof p.paMax === 'number' && typeof p.ph === 'number' && typeof p.phMax === 'number' && (
                    <div style={{ fontSize:12, color:'#555', marginLeft:8 }}>
                      PA: <b>{p.pa}/{p.paMax}</b> · PH: <b>{p.ph}/{p.phMax}</b>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <div style={{ marginTop: 16, padding:12, border:'1px solid #ddd', borderRadius:8 }}>
              <h3 style={{ margin:'0 0 8px' }}>Actions</h3>
              <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:8 }}>
                <label style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <input type="radio" name="mode" checked={mode==='ping'} onChange={()=>setMode('ping')} />
                  Ping (montrer une case)
                </label>
                <label style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <input type="radio" name="mode" checked={mode==='move'} onChange={()=>setMode('move')} />
                  Déplacer mon pion (coût 1 PA)
                </label>
              </div>
              <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:8 }}>
                <label style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <input type="checkbox" checked={debugOverlay} onChange={e=>setDebugOverlay(e.target.checked)} />
                  Debug overlay (colorer les cases + hover)
                </label>
              </div>
              <p style={{ fontSize:12, color:'#666', marginTop:8 }}>
                Dernier clic: {lastClick === null ? '—' : `hex #${lastClick}`}
              </p>
              <div style={{ display:'grid', gap:8, marginTop:8 }}>
                <button onClick={meditate} disabled={!canMeditate} style={{ padding:'8px 12px' }}>
                  Méditer (−1 PA → +2 PH)
                </button>
                <button onClick={endTurn} disabled={!isMyTurn} style={{ padding:'8px 12px' }}>
                  Fin de tour
                </button>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <h3>Infos overlay</h3>
              <p style={{ fontSize:12, color:'#666' }}>
                Hex cliquables (filtrés & ordonnés) : <b>{hexCount}</b>
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
