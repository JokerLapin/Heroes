import React, { useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Player = { id: string; name: string; seat: number }
type Selection = { playerId: string; r: number; c: number }
type RoomState = {
  roomId: string
  players: Player[]
  currentPlayerId: string | null
  board: { rows: number; cols: number; selections: Selection[] }
}

const socket: Socket = io() // même origine (Render)

function hashColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i)
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 70%, 50%)`
}

// --- Hex helpers (pointy-top) ---
function hexPoints(size: number) {
  const w = size * 2
  const h = Math.sqrt(3) * size
  const pts = [
    [size, 0],
    [w, h / 2],
    [w, (3 * h) / 2],
    [size, 2 * h],
    [0, (3 * h) / 2],
    [0, h / 2],
  ]
  return pts.map((p) => p.join(',')).join(' ')
}
function axialToPixel(r: number, c: number, size: number) {
  const w = size * 2
  const h = Math.sqrt(3) * size
  const x = c * (w * 0.75)
  const y = r * h + (c % 2 ? h / 2 : 0)
  return { x, y }
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
    board: { rows: 13, cols: 13, selections: [] },
  })

  useEffect(() => {
    const onConnect = () => { setConnected(true); setMySocketId(socket.id) }
    const onDisconnect = () => setConnected(false)
    const onUpdate = (s: RoomState) => {
      setState(s)
      if (s.players.some(p => p.id === socket.id)) setJoined(true)
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

  const isMyTurn = useMemo(
    () => state.currentPlayerId !== null && state.currentPlayerId === mySocketId,
    [state.currentPlayerId, mySocketId]
  )

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    const r = roomId.trim()
    if (!n || !r) return
    socket.emit('joinRoom', { roomId: r, name: n })
  }
  const handleEndTurn = () => state.roomId && socket.emit('endTurn', { roomId: state.roomId })

  // --- Board rendering over PNG ---
  const containerRef = useRef<HTMLDivElement>(null)
  const [imgNatural, setImgNatural] = useState<{w:number,h:number}>({w:0,h:0})
  const [overlaySize, setOverlaySize] = useState<{w:number,h:number}>({w:0,h:0})

  // Ajustements pour aligner la grille sur TON PNG si besoin
  const [offset, setOffset] = useState<{x:number,y:number}>({x:24, y:24})
  const [scale, setScale] = useState(1) // zoom de la grille

  useEffect(() => {
    const onResize = () => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      setOverlaySize({ w: rect.width, h: rect.height })
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const rows = state.board.rows
  const cols = state.board.cols

  // Taille du hex calculée pour que 13 colonnes tiennent en largeur
  const hexW = (overlaySize.w / (cols * 0.75 + 0.25)) * scale
  const hexSize = hexW / 2
  const hexH = Math.sqrt(3) * hexSize
  const svgW = overlaySize.w
  const svgH = rows * hexH + hexH / 2

  function onClickHex(r: number, c: number) {
    if (!state.roomId) return
    socket.emit('selectCell', { roomId: state.roomId, r, c })
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Heroes — Sprint 2 (Plateau + sélection)</h1>
      <p>Socket: {connected ? 'connecté' : 'déconnecté'} · ID: {mySocketId || '...'}</p>

      {!joined ? (
        <form onSubmit={handleJoin} style={{ display: 'grid', gap: 8, maxWidth: 360, marginTop: 8 }}>
          <label> Pseudo<br/>
            <input value={name} onChange={e=>setName(e.target.value)} maxLength={24} placeholder="Ex: Alice" style={{width:'100%',padding:8}} />
          </label>
          <label> Code de partie<br/>
            <input value={roomId} onChange={e=>setRoomId(e.target.value.toUpperCase())} maxLength={12} placeholder="Ex: TEST01" style={{width:'100%',padding:8,letterSpacing:1}} />
          </label>
          <button type="submit" style={{ padding: '8px 12px' }}>Rejoindre / Créer la partie</button>
          <p style={{ fontSize: 12, color: '#555' }}>Astuce : ouvre un 2ᵉ onglet avec le même code.</p>
        </form>
      ) : (
        <>
          <section style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:16, alignItems:'start' }}>
            {/* Board */}
            <div ref={containerRef} style={{ position:'relative', width:'100%', maxWidth: 1000, userSelect:'none' }}>
              {/* Ton PNG du plateau */}
              <img
                src="/assets/board.png"
                alt="Plateau"
                style={{ display:'block', width:'100%', height:'auto' }}
                onLoad={(e) => {
                  const img = e.currentTarget
                  setImgNatural({ w: img.naturalWidth, h: img.naturalHeight })
                  // sync overlay size on load
                  if (containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect()
                    setOverlaySize({ w: rect.width, h: rect.height })
                  }
                }}
              />

              {/* Grille cliquable transparente (SVG) */}
              <svg
                width={svgW} height={svgH}
                style={{ position:'absolute', top: offset.y, left: offset.x, pointerEvents:'none' }}
              >
                {/* Hexagones invisibles mais cliquables */}
                {Array.from({length: rows}).map((_, r) =>
                  Array.from({length: cols}).map((_, c) => {
                    const { x, y } = axialToPixel(r, c, hexSize)
                    return (
                      <g key={`${r}-${c}`} transform={`translate(${x}, ${y})`}>
                        <polygon
                          points={hexPoints(hexSize)}
                          fill="rgba(0,0,0,0)"
                          stroke="rgba(0,0,0,0.12)"
                          strokeWidth={0.5}
                          style={{ cursor:'pointer', pointerEvents:'auto' }}
                          onClick={() => onClickHex(r, c)}
                          onMouseEnter={(e)=>{ e.currentTarget.setAttribute('stroke','rgba(0,0,0,0.35)') }}
                          onMouseLeave={(e)=>{ e.currentTarget.setAttribute('stroke','rgba(0,0,0,0.12)') }}
                        />
                      </g>
                    )
                  })
                )}

                {/* Marqueurs de sélection de tous les joueurs */}
                {state.board.selections.map(sel => {
                  const { x, y } = axialToPixel(sel.r, sel.c, hexSize)
                  const cx = x + hexSize
                  const cy = y + Math.sqrt(3)*hexSize
                  const color = hashColor(sel.playerId)
                  return (
                    <circle key={`${sel.playerId}-${sel.r}-${sel.c}`} cx={cx} cy={cy} r={hexSize*0.35} fill={color} opacity={0.85} />
                  )
                })}
              </svg>
            </div>

            {/* Panneau latéral */}
            <div>
              <h3 style={{ margin:'0 0 8px'}}>Partie : {state.roomId}</h3>
              <ul style={{ paddingLeft: 16, marginTop: 0 }}>
                {state.players.map(p => (
                  <li key={p.id}>
                    {p.name} {p.id === mySocketId ? '(toi)' : ''} — siège {p.seat}
                    {state.currentPlayerId === p.id ? ' ← à lui/elle de jouer' : ''}
                  </li>
                ))}
              </ul>

              <div style={{ marginTop: 16 }}>
                <h3 style={{ margin:'0 0 8px'}}>Tour</h3>
                <button
                  onClick={() => socket.emit('endTurn', { roomId: state.roomId })}
                  disabled={!isMyTurn}
                  style={{ padding:'8px 12px', opacity:isMyTurn?1:0.6, cursor:isMyTurn?'pointer':'not-allowed' }}
                >
                  Fin de tour {isMyTurn ? '(à toi)' : ''}
                </button>
              </div>

              <div style={{ marginTop: 16 }}>
                <h3 style={{ margin:'0 0 8px' }}>Alignement de la grille (si besoin)</h3>
                <label style={{ display:'block', fontSize:12, color:'#555', marginBottom:4 }}>
                  Décalage X: {offset.x}px
                </label>
                <input type="range" min="-200" max="200" value={offset.x} onChange={e=>setOffset(o=>({...o, x: Number(e.target.value)}))} />
                <label style={{ display:'block', fontSize:12, color:'#555', margin:'8px 0 4px' }}>
                  Décalage Y: {offset.y}px
                </label>
                <input type="range" min="-200" max="200" value={offset.y} onChange={e=>setOffset(o=>({...o, y: Number(e.target.value)}))} />
                <label style={{ display:'block', fontSize:12, color:'#555', margin:'8px 0 4px' }}>
                  Échelle: {scale.toFixed(2)}
                </label>
                <input type="range" min="0.6" max="1.8" step="0.01" value={scale} onChange={e=>setScale(Number(e.target.value))} />
                <p style={{ fontSize:12, color:'#666' }}>
                  Utilise ces réglages pour superposer la grille cliquable sur les hex du PNG.
                </p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
