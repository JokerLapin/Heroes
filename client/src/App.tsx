import React, { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Player = { id: string; name: string; seat: number }
type Selection = { playerId: string; index: number }
type RoomState = {
  roomId: string
  players: Player[]
  currentPlayerId: string | null
  board: { selections: Selection[] }
}

const socket: Socket = io() // même domaine Render

// Couleur unique par joueur
function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i)
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 65%, 50%)`
}

export default function App() {
  // ---- états principaux ----
  const [connected, setConnected] = useState(false)
  const [mySocketId, setMySocketId] = useState('')
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('TEST01')
  const [joined, setJoined] = useState(false)
  const [state, setState] = useState<RoomState>({
    roomId: '',
    players: [],
    currentPlayerId: null,
    board: { selections: [] },
  })

  // références
  const svgRef = useRef<SVGSVGElement>(null)
  const [hexCount, setHexCount] = useState(0)

  // ---- connexion socket ----
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

  // ---- chargement dynamique du SVG ----
  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const polygons = svgEl.querySelectorAll('polygon')
    setHexCount(polygons.length)

    polygons.forEach((poly, index) => {
      poly.setAttribute('data-index', String(index))
      poly.style.cursor = 'pointer'
      poly.addEventListener('mouseenter', () => poly.setAttribute('stroke-width', '2'))
      poly.addEventListener('mouseleave', () => poly.setAttribute('stroke-width', '1'))
      poly.addEventListener('click', () => {
        if (!state.roomId) return
        socket.emit('selectCell', { roomId: state.roomId, index })
      })
    })

    return () => {
      polygons.forEach((poly) => {
        const clone = poly.cloneNode(true)
        poly.replaceWith(clone)
      })
    }
  }, [joined, state.roomId])

  // ---- join room ----
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    const r = roomId.trim()
    if (!n || !r) return
    socket.emit('joinRoom', { roomId: r, name: n })
  }

  // ---- fin de tour ----
  const endTurn = () => state.roomId && socket.emit('endTurn', { roomId: state.roomId })

  // ---- rendu ----
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Heroes — Plateau SVG interactif</h1>
      <p>Socket: {connected ? '✅ connecté' : '❌ déconnecté'} · ID: {mySocketId || '...'}</p>

      {!joined ? (
        <form onSubmit={handleJoin} style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
          <label> Pseudo<br />
            <input value={name} onChange={e => setName(e.target.value)} maxLength={24} placeholder="Ex: Alice" />
          </label>
          <label> Code de partie<br />
            <input value={roomId} onChange={e => setRoomId(e.target.value.toUpperCase())} maxLength={12} />
          </label>
          <button type="submit" style={{ padding: '6px 12px' }}>Rejoindre / Créer la partie</button>
        </form>
      ) : (
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, alignItems: 'start' }}>
          {/* Plateau principal */}
          <div style={{ position: 'relative', width: '100%', maxWidth: 1100 }}>
            <img
              src="/assets/board.png"
              alt="Plateau"
              style={{ display: 'block', width: '100%', height: 'auto' }}
            />
            <object
              ref={svgRef}
              type="image/svg+xml"
              data="/assets/hex-overlay.svg"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'auto',
              }}
            />
            {/* Marqueurs joueurs */}
            <svg
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
            >
              {state.board.selections.map(sel => {
                const color = colorFor(sel.playerId)
                const target = svgRef.current?.querySelector(`polygon[data-index="${sel.index}"]`)
                if (!target) return null
                const box = target.getBBox()
                return (
                  <circle
                    key={`${sel.playerId}-${sel.index}`}
                    cx={box.x + box.width / 2}
                    cy={box.y + box.height / 2}
                    r={box.width * 0.15}
                    fill={color}
                    opacity={0.85}
                  />
                )
              })}
            </svg>
          </div>

          {/* Panneau latéral */}
          <div>
            <h3>Partie : {state.roomId}</h3>
            <ul>
              {state.players.map(p => (
                <li key={p.id}>
                  {p.name} {p.id === mySocketId ? '(toi)' : ''}{' '}
                  {state.currentPlayerId === p.id && '← à lui/elle de jouer'}
                </li>
              ))}
            </ul>

            <p style={{ fontSize: 14, color: '#666' }}>
              Hex détectés dans ton SVG : <b>{hexCount}</b>
            </p>

            <button onClick={endTurn} disabled={state.currentPlayerId !== mySocketId}>
              Fin de tour {state.currentPlayerId === mySocketId ? '(à toi)' : ''}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
