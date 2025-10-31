import React, { useEffect, useMemo, useRef, useState } from 'react'
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

// Couleur stable par joueur
function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i)
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 65%, 50%)`
}

export default function App() {
  // Connexion & lobby
  const [connected, setConnected] = useState(false)
  const [mySocketId, setMySocketId] = useState('')
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('TEST01')
  const [joined, setJoined] = useState(false)

  // État diffusé par le serveur
  const [state, setState] = useState<RoomState>({
    roomId: '',
    players: [],
    currentPlayerId: null,
    board: { selections: [] },
  })

  // Overlay SVG chargé et transformé
  const overlayWrapRef = useRef<HTMLDivElement>(null)   // wrapper transformé (scaleX/scaleY + translate)
  const svgRef = useRef<SVGSVGElement | null>(null)     // svg inline inséré
  const [hexCenters, setHexCenters] = useState<Array<{cx:number, cy:number}>>([])
  const [hexCount, setHexCount] = useState(0)

  // Contrôles d’alignement (persistés)
  // Rétro-compatibilité : si ancien 'heroes.ov.scale' existe, on l’utilise comme valeur de départ pour X et Y.
  const legacyScale = Number(localStorage.getItem('heroes.ov.scale')) || undefined
  const [scaleX, setScaleX] = useState<number>(() =>
    (legacyScale && !isNaN(legacyScale)) ? legacyScale : (Number(localStorage.getItem('heroes.ov.scaleX')) || 1)
  )
  const [scaleY, setScaleY] = useState<number>(() =>
    (legacyScale && !isNaN(legacyScale)) ? legacyScale : (Number(localStorage.getItem('heroes.ov.scaleY')) || 1)
  )
  const [offX, setOffX] = useState<number>(() => Number(localStorage.getItem('heroes.ov.offX')) || 0)
  const [offY, setOffY] = useState<number>(() => Number(localStorage.getItem('heroes.ov.offY')) || 0)

  useEffect(() => { localStorage.setItem('heroes.ov.scaleX', String(scaleX)) }, [scaleX])
  useEffect(() => { localStorage.setItem('heroes.ov.scaleY', String(scaleY)) }, [scaleY])
  useEffect(() => { localStorage.setItem('heroes.ov.offX', String(offX)) }, [offX])
  useEffect(() => { localStorage.setItem('heroes.ov.offY', String(offY)) }, [offY])

  // Connexion socket
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

  // Chargement du SVG (inline) pour attacher les handlers et lire les bboxes
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/assets/hex-overlay.svg', { cache: 'no-store' })
        if (!res.ok) return
        const text = await res.text()
        if (cancelled) return

        // Parse en DOM
        const parser = new DOMParser()
        const doc = parser.parseFromString(text, 'image/svg+xml')
        const inlineSvg = doc.documentElement as unknown as SVGSVGElement
        inlineSvg.setAttribute('preserveAspectRatio', 'none') // s'adapte au wrapper
        inlineSvg.style.width = '100%'
        inlineSvg.style.height = '100%'

        // Insertion dans le wrapper
        const wrap = overlayWrapRef.current
        if (!wrap) return
        wrap.innerHTML = '' // reset
        wrap.appendChild(inlineSvg)
        svgRef.current = inlineSvg

        // Rendre hex cliquables
        const polys = inlineSvg.querySelectorAll('polygon')
        polys.forEach((poly, index) => {
          poly.setAttribute('data-index', String(index))
          poly.setAttribute('stroke-width', '1')
          ;(poly as SVGElement).style.cursor = 'pointer'
          poly.addEventListener('mouseenter', () => poly.setAttribute('stroke-width', '2'))
          poly.addEventListener('mouseleave', () => poly.setAttribute('stroke-width', '1'))
          poly.addEventListener('click', () => {
            if (!state.roomId) return
            socket.emit('selectCell', { roomId: state.roomId, index })
          })
        })
        setHexCount(polys.length)

        // Pré-calcul des centres (dans le système de coordonnées natif du SVG)
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
  }, [joined]) // recharge quand on rejoint

  // Join + end turn
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

  // Style transform commun (pour SVG et marqueurs)
  const overlayTransform = `translate(${offX}px, ${offY}px) scale(${scaleX}, ${scaleY})`

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Heroes — Overlay SVG (échelle X/Y + offset)</h1>
      <p>Socket: {connected ? '✅ connecté' : '❌ déconnecté'} · ID: {mySocketId || '...'}</p>

      {!joined ? (
        <form onSubmit={handleJoin} style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
          <label>Pseudo<br />
            <input value={name} onChange={e=>setName(e.target.value)} maxLength={24} placeholder="Ex: Alice" />
          </label>
          <label>Code de partie<br />
            <input value={roomId} onChange={e=>setRoomId(e.target.value.toUpperCase())} maxLength={12} />
          </label>
          <button type="submit" style={{ padding:'6px 12px' }}>Rejoindre / Créer la partie</button>
        </form>
      ) : (
        <section style={{ display:'grid', gridTemplateColumns:'1fr 300px', gap:16, alignItems:'start' }}>
          {/* Zone plateau */}
          <div style={{ position:'relative', width:'100%', maxWidth: 1200 }}>
            {/* Image du plateau */}
            <img src="/assets/board.png" alt="Plateau" style={{ display:'block', width:'100%', height:'auto' }} />

            {/* Wrapper transformé qui contient le SVG inline */}
            <div
              ref={overlayWrapRef}
              style={{
                position:'absolute',
                inset:0,
                transform: overlayTransform,
                transformOrigin:'top left',
                pointerEvents:'auto'
              }}
            />

            {/* Marqueurs de sélection (mêmes transform pour rester alignés) */}
            <svg
              style={{
                position:'absolute',
                inset:0,
                transform: overlayTransform,
                transformOrigin:'top left',
                width:'100%',
                height:'100%',
                pointerEvents:'none'
              }}
            >
              {state.board.selections.map(sel => {
                const center = hexCenters[sel.index]
                if (!center) return null
                return (
                  <circle
                    key={`${sel.playerId}-${sel.index}`}
                    cx={center.cx}
                    cy={center.cy}
                    r={8}
                    fill={colorFor(sel.playerId)}
                    opacity={0.9}
                  />
                )
              })}
            </svg>
          </div>

          {/* Panneau latéral */}
          <div>
            <h3>Partie : {state.roomId}</h3>
            <ul style={{marginTop:0, paddingLeft:16}}>
              {state.players.map(p => (
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
              <h3>Alignement overlay</h3>
              <div style={{fontSize:12, color:'#555'}}>Échelle X: {scaleX.toFixed(3)}</div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.001"
                value={scaleX}
                onChange={e=>setScaleX(Number(e.target.value))}
              />
              <div style={{fontSize:12, color:'#555', marginTop:8}}>Échelle Y: {scaleY.toFixed(3)}</div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.001"
                value={scaleY}
                onChange={e=>setScaleY(Number(e.target.value))}
              />
              <div style={{fontSize:12, color:'#555', marginTop:8}}>Décalage X: {offX}px</div>
              <input type="range" min="-600" max="600" step="1" value={offX} onChange={e=>setOffX(Number(e.target.value))} />
              <div style={{fontSize:12, color:'#555', marginTop:8}}>Décalage Y: {offY}px</div>
              <input type="range" min="-600" max="600" step="1" value={offY} onChange={e=>setOffY(Number(e.target.value))} />
              <p style={{fontSize:12, color:'#666', marginTop:8}}>
                Ajuste X/Y pour corriger l’étirement anisotrope (différences d’échelle horizontale vs verticale).
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
