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
  const [hexCenters, setHexCenters] = useState<Array<{cx:number, cy:number}>>([])
  const [hexCount, setHexCount] = useState(0)
  const [containerSize, setContainerSize] = useState<{w:number, h:number}>({w:0, h:0})
  const [nativeSize, setNativeSize] = useState<{w:number, h:number}>({w:0, h:0})

  const [mode, setMode] = useState<ActionMode>('ping')
  const [alignSrc, setAlignSrc] = useState<AlignJSON | null>(null)

  // Mesure responsive
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

  // Charger SVG inline 1:1
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

        const wrap = overlayWrapRef.current
        if (!wrap) return
        wrap.innerHTML = ''
        wrap.appendChild(inlineSvg)
        svgRef.current = inlineSvg

        const polys = inlineSvg.querySelectorAll('polygon')
        polys.forEach((poly, index) => {
          poly.setAttribute('data-index', String(index))
          ;(poly as SVGElement).style.cursor = 'pointer'
          poly.addEventListener('click', () => {
            const rId = state.roomId || ''
            if (!rId) return
            if (mode === 'ping') socket.emit('selectCell', { roomId: rId, index })
            else socket.emit('setPawn', { roomId: rId, index })
          })
        })
        setHexCount(polys.length)

        const centers: Array<{cx:number, cy:number}> = []
        polys.forEach((poly) => {
          const box = (poly as SVGGraphicsElement).getBBox()
          centers.push({ cx: box.x + box.width/2, cy: box.y + box.height/2 })
        })
        setHexCenters(centers)
      } catch (e) {
        console.error('load svg error', e)
      }
    })()
    return () => { cancelled = true }
  }, [joined, mode])

  // Échelle uniforme + offsets
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
      <h1 style={{ marginTop: 0 }}>Heroes — PA/PH + Méditer + Déplacement (1 PA)</h1>
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
        <section style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:16, alignItems:'start' }}>
          {/* Plateau */}
          <div ref={containerRef} style={{ position:'relative', width:'100%', maxWidth: 1200 }}>
            <img src="/assets/board.png" alt="Plateau" style={{ display:'block', width:'100%', height:'auto' }} />

            {/* Overlay inline */}
            <div
              ref={overlayWrapRef}
              style={{
                position:'absolute', inset:0,
                transform: overlayTransform,
                transformOrigin:'top left',
                pointerEvents:'auto'
              }}
            />

            {/* Pions + Pings */}
            <svg
              style={{
                position:'absolute', inset:0,
                transform: overlayTransform,
                transformOrigin:'top left',
                width:'100%', height:'100%',
                pointerEvents:'none'
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
              <h3 style={{ margin:'0 0 8px' }}>Ton tour</h3>
              <p style={{ margin:'0 0 6px', fontSize:14 }}>
                {isMyTurn ? '🟢 À toi de jouer' : '⚪ Attends ton tour'}
              </p>
              <p style={{ margin:'0 0 10px', fontSize:14 }}>
                PA: <b>{me?.pa ?? 0}/{me?.paMax ?? 0}</b> · PH: <b>{me?.ph ?? 0}/{me?.phMax ?? 0}</b>
              </p>
              <div style={{ display:'grid', gap:8 }}>
                <button onClick={meditate} disabled={!canMeditate} style={{ padding:'8px 12px' }}>
                  Méditer (−1 PA → +2 PH)
                </button>
                <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                  <label style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <input type="radio" name="mode" checked={mode==='ping'} onChange={()=>setMode('ping')} />
                    Ping (montrer une case)
                  </label>
                  <label style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <input type="radio" name="mode" checked={mode==='move'} onChange={()=>setMode('move')} />
                    Déplacer mon pion (coût 1 PA)
                  </label>
                </div>
                <button onClick={endTurn} disabled={!isMyTurn} style={{ padding:'8px 12px' }}>
                  Fin de tour
                </button>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <h3>Infos overlay</h3>
              <p style={{ fontSize:12, color:'#666' }}>
                Hex dans le SVG : <b>{hexCount}</b>
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
