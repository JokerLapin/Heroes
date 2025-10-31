import React, { useEffect, useMemo, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Player = { id: string; name: string; seat: number }
type RoomState = { roomId: string; players: Player[]; currentPlayerId: string | null }

const socket: Socket = io() // même origine (Render)

export default function App() {
  // Connexion socket
  const [connected, setConnected] = useState(false)
  const [mySocketId, setMySocketId] = useState<string>('')

  // Formulaire de lobby
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('TEST01') // valeur par défaut pratique
  const [joined, setJoined] = useState(false)

  // État de la room
  const [state, setState] = useState<RoomState>({ roomId: '', players: [], currentPlayerId: null })

  useEffect(() => {
    const onConnect = () => {
      setConnected(true)
      setMySocketId(socket.id)
    }
    const onDisconnect = () => setConnected(false)

    const onUpdate = (s: RoomState) => {
      setState(s)
      if (s.players.some(p => p.id === socket.id)) {
        setJoined(true)
      }
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

  const isMyTurn = useMemo(() => {
    return state.currentPlayerId !== null && state.currentPlayerId === mySocketId
  }, [state.currentPlayerId, mySocketId])

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedRoom = roomId.trim()
    if (!trimmedName || !trimmedRoom) return
    socket.emit('joinRoom', { roomId: trimmedRoom, name: trimmedName })
  }

  const handleEndTurn = () => {
    if (!state.roomId) return
    socket.emit('endTurn', { roomId: state.roomId })
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, lineHeight: 1.4 }}>
      <h1 style={{ marginTop: 0 }}>Heroes — Sprint 1 (Lobbies & tour)</h1>
      <p>Socket: {connected ? 'connecté' : 'déconnecté'} · ID: {mySocketId || '...'}</p>

      {!joined ? (
        <form onSubmit={handleJoin} style={{ display: 'grid', gap: 8, maxWidth: 360, marginTop: 16 }}>
          <label>
            Pseudo<br />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Alice"
              maxLength={24}
              style={{ width: '100%', padding: 8 }}
            />
          </label>
          <label>
            Code de partie (room)<br />
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              placeholder="Ex: TEST01"
              maxLength={12}
              style={{ width: '100%', padding: 8, letterSpacing: 1 }}
            />
          </label>
          <button type="submit" style={{ padding: '8px 12px' }}>
            Rejoindre / Créer la partie
          </button>
          <p style={{ fontSize: 12, color: '#555' }}>
            Astuce : ouvre un second onglet, entre un autre pseudo mais le même code de partie pour tester à deux.
          </p>
        </form>
      ) : (
        <>
          <section style={{ marginTop: 16 }}>
            <h2 style={{ margin: '16px 0 8px' }}>Partie : {state.roomId || roomId}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 520 }}>
              <div>
                <h3 style={{ margin: '0 0 8px' }}>Joueurs</h3>
                <ul style={{ paddingLeft: 16, margin: 0 }}>
                  {state.players.map(p => (
                    <li key={p.id}>
                      {p.name} {p.id === mySocketId ? ' (toi)' : ''} — siège {p.seat}
                      {state.currentPlayerId === p.id ? ' ← à lui/elle de jouer' : ''}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 style={{ margin: '0 0 8px' }}>Tour</h3>
                <p>Joueur courant : {
                  state.currentPlayerId
                    ? (state.players.find(p => p.id === state.currentPlayerId)?.name || state.currentPlayerId)
                    : '—'
                }</p>
                <button
                  onClick={handleEndTurn}
                  disabled={!isMyTurn}
                  style={{ padding: '8px 12px', opacity: isMyTurn ? 1 : 0.6, cursor: isMyTurn ? 'pointer' : 'not-allowed' }}
                >
                  Fin de tour {isMyTurn ? '(à toi)' : ''}
                </button>
                <p style={{ fontSize: 12, color: '#555' }}>
                  Seul le joueur dont c’est le tour peut cliquer.
                </p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
