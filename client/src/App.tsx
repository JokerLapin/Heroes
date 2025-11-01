import React, { useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Player = { id: string; name: string; seat: number }
type Selection = { playerId: string; index: number }
type Pawn = { playerId: string; index: number }
type RoomState = {
  roomId: string
  players?: Player[]
  currentPlayerId?: string | null
  board?: { selections?: Selection[]; pawns?: Pawn[] }
}

type AlignJSON = {
  scaleX: number
  scaleY: number
  offX: number
  offY: number
  baseW?: number
  baseH?: number
}

const socket: Socket = io()

function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i)
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 65%, 50%)`
}
type ActionMode = 'ping' | 'move'

function safePlayers(s?: Player[]) { return Array.isArray(s) ? s : [] }
function safeSelections(b?: RoomState['board']) { return Array.isArray(b?.selections) ? b!.selections! : [] }
function safePawns(b?: RoomState['board']) { return Array.isArray(b?.pawns) ? b!.pawns! : [] }

export default function App() {
  // Lobby
  const [connected, setConnected] = useState(false)
  const [mySocketId, setMySocketId] = useState('')
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('TEST01')
  const [joined, setJoined] = useState(false)

  // État serveur (défauts ultra-sûrs)
  const [state, setState] = useState<RoomState>({
    roomId: '',
    players: [],
    currentPlayerId: null,
    board: { selections: [], pawns: [] },
  })

  // Overlay inline
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayWrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hexCenters, setHexCenters] = useState<Array<{cx:number, cy:number}>>([])
  const [hexCount, setHexCount] = useState(0)

  // Action
  const [mode, setMode] = useState<ActionMode>('ping')

  // --------- ALIGNEMENT (responsive) ----------
  const [alignSrc, setAlignSrc] = useState<AlignJSON | null>(null)
  const [containerSize, setContainerSize] = useState<{w:number, h:number}>({w:0, h:0})

  const { effScaleX, effScaleY, effOffX, effOffY } = useMemo(() => {
    if (!alignSrc || !containerSize.w || !containerSize.h) {
      return { effScaleX: 1, effScaleY: 1, effOffX: 0, effOffY: 0 }
    }
    const clean = (v: number) => (v > 5 ? v / 1000 : v)
    const baseW = alignSrc.baseW && alignSrc.baseW > 0 ? alignSrc.baseW : containerSize.w
    const baseH = alignSrc.baseH && alignSrc.baseH > 0 ? alignSrc.baseH : containerSize.h
    const kx = containerSize.w / baseW
    const ky = containerSize.h / baseH
    const scaleX = clean(alignSrc.scaleX)
    const scaleY = clean(alignSrc.scaleY)
    const offX = alignSrc.offX ?? 0
    const offY = alignSrc.offY ?? 0
    return {
      effScaleX: scaleX * kx,
      effScaleY: scaleY * ky,
      effOffX: offX * kx,
      effOffY: offY * ky,
    }
  }, [alignSrc, containerSize])

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

  // Connexion socket
  useEffect(() => {
    const onConnect = () => { setConnected(true); setMySocketId(socket.id) }
    const onDisconnect = () => setConnected(false)
    const onUpdate = (s: RoomState) => {
      // durcissement: si le serveur envoie des champs incomplets, on comble avec des valeurs sûres
      const hardened: RoomState = {
        roomId: s.roomId ?? '',
        players: safePlayers(s.players),
        currentPlayerId: s.currentPlayerId ?? null,
        board: {
          selections: safeSelections(s.board),
          pawns: safePawns(s.board),
        }
      }
      // log si anomalie détectée
      if (!Array.isArray(s.players) || !s.board || !Array.isArray(s.board.selections) || !Array.isArray(s.board.pawns)) {
        console.warn('[Heroes] État serveur incomplet, application des valeurs par défaut:', s)
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

  // Charger ALIGN JSON
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/overlay-align.json', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as AlignJSON
        setAlignSrc(json)
      } catch (e) {
        console.warn('[Heroes] overlay-align.json introuvable ou invalide (fallback neutre).', e)
      }
    })()
  }, [])

  // Export alignement normalisé (si besoin)
  function exportAlignNormalized() {
    const baseW = alignSrc?.baseW && alignSrc.baseW > 0 ? alignSrc.baseW : containerSize.w
    const baseH = alignSrc?.baseH && alignSrc.baseH > 0 ? alignSrc.baseH : containerSize.h
    const src = alignSrc || { scaleX: 1, scaleY: 1, offX: 0, offY: 0 }
    const clean = (v:number)=> (v>5? v/1000 : v)
    const data: AlignJSON = {
      scaleX: clean(src.scaleX),
      scaleY: clean(src.scaleY),
      offX: src.offX,
      offY: src.offY,
      baseW, baseH
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'overlay-align.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Charger SVG inline
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
        inlineSvg.setAttribute('preserveAspectRatio', 'none')
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
          poly.setAttribute('stroke-width', '1')
          ;(poly as SVGElement).style.cursor = 'pointer'
          poly.addEventListener('mouseenter', () => poly.setAttribute('stroke-width', '2'))
          poly.addEventListener('mouseleave', () => poly.setAttribute('stroke-width', '1'))
          poly.addEventListener('click', () => {
            const currentRoom = state.roomId || ''
            if (!currentRoom) return
            if (mode === 'ping') socket.emit('selectCell', { roomId: currentRoom, index })
            else socket.emit('setPawn', { roomId: currentRoom, index })
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

  const isMyTurn = useMemo(
    () => (state.currentPlayerId ?? null) !== null && state.currentPlayerId === mySocketId,
    [state.currentPlayerId, mySocketId]
  )
  const endTurn = () => (state.roomId || '') && socket.emit('endTurn', { roomId: state.roomId })

  const overlayTransform = `translate(${effOffX}px, ${effOffY}px) scale(${effScaleX}, ${effScaleY})`

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Heroes — Overlay SVG aligné & robuste</h1>
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
        <section style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:16, alignItems:'start' }}>
          {/* Plateau */}
          <div ref={containerRef} style={{ position:'relative', width:'100%', maxWidth: 1200 }}>
            <img src="/assets/board.png" alt="Plateau" style={{ display:'block', width:'100%', height:'auto' }} />

            {/* Overlay transformé */}
            <div
              ref={overlayWrapRef}
              style={{
                position:'absolute', inset:0,
                transform: overlayTransform,
                transformOrigin:'top left',
                pointerEvents:'auto'
              }}
            />

            {/* Couches pions/pings alignées identiquement */}
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
                const me = p.playerId === mySocketId
                return (
                  <g key={`pawn-${p.playerId}`}>
                    <circle cx={center.cx} cy={center.cy} r={10} fill={color} stroke="#000" strokeWidth={1} />
                    <text x={center.cx} y={center.cy + 3} fontSize="10" textAnchor="middle" fill="#fff" style={{fontWeight:600}}>
                      {initialsForPlayer(safePlayers(state.players), p.playerId)}
                    </text>
                    {me && <circle cx={center.cx} cy={center.cy} r={14} fill="none" stroke={color} strokeWidth={2} opacity={0.6} />}
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
            <h3>Partie : {state.roomId || '...'}</h3>
            <ul style={{marginTop:0, paddingLeft:16}}>
              {safePlayers(state.players).map(p => (
                <li key={p.id}>
                  {p.name} {p.id === mySocketId ? '(toi)' : ''} {state.currentPlayerId === p.id ? '← à lui/elle de jouer' : ''}
                </li>
              ))}
            </ul>

            <div style={{ marginTop: 16 }}>
              <h3>Tour</h3>
              <button onClick={endTurn} disabled={!isMyTurn} style={{ padding:'6px 12px' }}>
                Fin de tour {isMyTurn ? '(à toi)' : ''}
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <h3>Action au clic</h3>
              <label style={{ display:'flex', gap:8, alignItems:'center' }}>
                <input type="radio" name="mode" checked={mode==='ping'} onChange={()=>setMode('ping')} />
                Ping (montrer une case)
              </label>
              <label style={{ display:'flex', gap:8, alignItems:'center', marginTop:4 }}>
                <input type="radio" name="mode" checked={mode==='move'} onChange={()=>setMode('move')} />
                Déplacer <b>mon pion</b>
              </label>
            </div>

            <div style={{ marginTop: 16 }}>
              <h3>Alignement</h3>
              <button onClick={exportAlignNormalized} style={{ padding:'6px 10px' }}>
                Exporter l’alignement (normalisé)
              </button>
              <p style={{ fontSize:12, color:'#666', marginTop:8 }}>
                Fichier inclut <code>baseW/baseH</code> pour un rendu identique sur tous les écrans.
              </p>
              <p style={{ fontSize:12, color:'#666' }}>
                Hex détectés dans le SVG : <b>{hexCount}</b>
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function initialsForPlayer(players: Player[], id: string) {
  const player = players.find(p => p.id === id)
  if (!player || !player.name) return '•'
  const parts = player.name.trim().split(/\s+/)
  const init = (parts[0]?.[0] || '').toUpperCase() + (parts[1]?.[0] || '').toUpperCase()
  return init || player.name[0].toUpperCase()
}
