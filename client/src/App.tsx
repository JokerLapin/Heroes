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

// ---- Helpers ---------------------------------------------------------------
function hashColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i)
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 70%, 50%)`
}
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

// ---- App -------------------------------------------------------------------
export default function App() {
  // Connexion socket
  const [connected, setConnected] = useState(false)
  const [mySocketId, setMySocketId] = useState('')

  // Lobby
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('TEST01')
  const [joined, setJoined] = useState(false)

  // État serveur
  const [state, setState] = useState<RoomState>({
    roomId: '',
    players: [],
    currentPlayerId: null,
    board: { rows: 13, cols: 13, selections: [] },
  })

  // Overlay & layout local (activation des cases valides)
  const containerRef = useRef<HTMLDivElement>(null)
  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [offset, setOffset] = useState<{ x: number; y: number }>(() => {
    const saved = localStorage.getItem('heroes.offset')
    return saved ? JSON.parse(saved) : { x: 24, y: 24 }
  })
  const [scale, setScale] = useState<number>(() => Number(localStorage.getItem('heroes.scale')) || 1)
  const rows = state.board.rows
  const cols = state.board.cols

  // Layout binaire (case jouable ou non)
  const [layout, setLayout] = useState<boolean[][]>(() => {
    const saved = localStorage.getItem('heroes.layout')
    if (saved) return JSON.parse(saved)
    // Par défaut: tout actif, on désactivera en mode édition jusqu’à 101 actives
    return Array.from({ length: 13 }, () => Array.from({ length: 13 }, () => true))
  })
  const [editLayout, setEditLayout] = useState<boolean>(() => localStorage.getItem('heroes.edit') === '1')

  // Re-rendre overlay sur resize
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

  // Socket wiring
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

  // Persist UI controls
  useEffect(() => { localStorage.setItem('heroes.offset', JSON.stringify(offset)) }, [offset])
  useEffect(() => { localStorage.setItem('heroes.scale', String(scale)) }, [scale])
  useEffect(() => { localStorage.setItem('heroes.layout', JSON.stringify(layout)) }, [layout])
  useEffect(() => { localStorage.setItem('heroes.edit', editLayout ? '1' : '0') }, [editLayout])

  // Calcul tailles hex
  const hexW = (overlaySize.w / (cols * 0.75 + 0.25)) * scale
  const hexSize = hexW / 2
  const hexH = Math.sqrt(3) * hexSize
  const svgW = overlaySize.w
  const svgH = rows * hexH + hexH / 2

  const activeCount = useMemo(
    () => layout.flat().filter(Boolean).length,
    [layout]
  )

  // Actions
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    const r = roomId.trim()
    if (!n || !r) return
    socket.emit('joinRoom', { roomId: r, name: n })
  }
  const isMyTurn = useMemo(
    () => state.currentPlayerId !== null && state.currentPlayerId === mySocketId,
    [state.currentPlayerId, mySocketId]
  )
  const endTurn = () => state.roomId && socket.emit('endTurn', { roomId: state.roomId })

  function clickHex(r: number, c: number) {
    if (editLayout) {
      setLayout(prev => {
        const next = prev.map(row => row.slice())
        next[r][c] = !next[r][c]
        return next
      })
      return
    }
    if (!layout[r][c]) return // case inactive
    if (!state.roomId) return
    socket.emit('selectCell', { roomId: state.roomId, r, c })
  }

  function exportLayout() {
    const data = {
      rows, cols, offset, scale, layout,
      note: 'Colle ce JSON dans un fichier si tu veux figer la config dans le code plus tard.'
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'heroes-board-layout.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  function resetLayoutAllOn() {
    setLayout(Array.from({ length: rows }, () => Array.from({ length: cols }, () => true)))
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Heroes — Plateau + sélection (avec édition du layout)</h1>
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
        </form>
      ) : (
        <section style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:16, alignItems:'start' }}>
          {/* Board */}
          <div ref={containerRef} style={{ position:'relative', width:'100%', maxWidth: 1100, userSelect:'none' }}>
            {/* Ton PNG du plateau */}
            <img
              src="/assets/board.png"
              alt="Plateau"
              style={{ display:'block', width:'100%', height:'auto' }}
              onLoad={() => {
                if (!containerRef.current) return
                const rect = containerRef.current.getBoundingClientRect()
                setOverlaySize({ w: rect.width, h: rect.height })
              }}
            />

            {/* Grille cliquable */}
            <svg
              width={svgW} height={svgH}
              style={{ position:'absolute', top: offset.y, left: offset.x, pointerEvents:'none' }}
            >
              {/* Hex cliquables */}
              {Array.from({length: rows}).map((_, r) =>
                Array.from({length: cols}).map((_, c) => {
                  const { x, y } = axialToPixel(r, c, hexSize)
                  const active = layout[r]?.[c]
                  return (
                    <g key={`${r}-${c}`} transform={`translate(${x}, ${y})`}>
                      <polygon
                        points={hexPoints(hexSize)}
                        fill={editLayout ? (active ? 'rgba(0,200,0,0.08)' : 'rgba(200,0,0,0.08)') : 'rgba(0,0,0,0)'}
                        stroke={active ? 'rgba(0,0,0,0.25)' : 'rgba(200,0,0,0.35)'}
                        strokeWidth={active ? 0.5 : 0.5}
                        style={{ cursor:'pointer', pointerEvents:'auto' }}
                        onClick={() => clickHex(r, c)}
                        onMouseEnter={(e)=>{ if(!editLayout) e.currentTarget.setAttribute('stroke','rgba(0,0,0,0.45)') }}
                        onMouseLeave={(e)=>{ if(!editLayout) e.currentTarget.setAttribute('stroke', active ? 'rgba(0,0,0,0.25)' : 'rgba(200,0,0,0.35)') }}
                      />
                    </g>
                  )
                })
              )}

              {/* Marqueurs de sélection de tous les joueurs */}
              {state.board.selections.map(sel => {
                if (!layout[sel.r]?.[sel.c]) return null
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
                onClick={endTurn}
                disabled={!(state.currentPlayerId && state.currentPlayerId === mySocketId)}
                style={{ padding:'8px 12px' }}
              >
                Fin de tour {state.currentPlayerId === mySocketId ? '(à toi)' : ''}
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <h3 style={{ margin:'0 0 8px' }}>Alignement de la grille</h3>
              <label style={{ display:'block', fontSize:12, color:'#555', marginBottom:4 }}>
                Décalage X: {offset.x}px
              </label>
              <input type="range" min="-300" max="300" value={offset.x} onChange={e=>setOffset(o=>({...o, x: Number(e.target.value)}))} />
              <label style={{ display:'block', fontSize:12, color:'#555', margin:'8px 0 4px' }}>
                Décalage Y: {offset.y}px
              </label>
              <input type="range" min="-300" max="300" value={offset.y} onChange={e=>setOffset(o=>({...o, y: Number(e.target.value)}))} />
              <label style={{ display:'block', fontSize:12, color:'#555', margin:'8px 0 4px' }}>
                Échelle: {scale.toFixed(2)}
              </label>
              <input type="range" min="0.6" max="2.0" step="0.01" value={scale} onChange={e=>setScale(Number(e.target.value))} />
            </div>

            <div style={{ marginTop: 16 }}>
              <h3 style={{ margin:'0 0 8px' }}>Édition du layout</h3>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="checkbox" checked={editLayout} onChange={e=>setEditLayout(e.target.checked)} />
                Activer le <b>mode ÉDITION</b> (cliquer une case la rend <i>jouable / non-jouable</i>)
              </label>
              <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                Cases actives : <b>{activeCount}</b> (vise <b>101</b>)
              </p>
              <div style={{ display:'flex', gap:8, marginTop:8 }}>
                <button onClick={exportLayout} style={{ padding:'6px 10px' }}>Exporter JSON</button>
                <button onClick={resetLayoutAllOn} style={{ padding:'6px 10px' }}>Tout activer</button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
