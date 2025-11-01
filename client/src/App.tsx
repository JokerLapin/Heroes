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
  // on garde offX/offY pour le micro-ajustement
  offX: number
  offY: number
  // facultatif: multiplicateur fin si tu veux (1.0 = pas de correction)
  mult?: number
}

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
  // Lobby
  const [connected, setConnected] = useState(false)
  const [mySocketId, setMySocketId] = useState('')
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('TEST01')
  const [joined, setJoined] = useState(false)

  // État serveur (sûr par défaut)
  const [state, setState] = useState<RoomState>({
    roomId: '',
    players: [],
    currentPlayerId: null,
    board: { selections: [], pawns: [] },
  })

  // Refs & mesures
  const containerRef = useRef<HTMLDivElement>(null) // conteneur du plateau
  const overlayWrapRef = useRef<HTMLDivElement>(null) // où on insère le SVG inline
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hexCenters, setHexCenters] = useState<Array<{cx:number, cy:number}>>([])
  const [hexCount, setHexCount] = useState(0)

  // Taille réelle à l’écran du conteneur
  const [containerSize, setContainerSize] = useState<{w:number, h:number}>({w:0, h:0})
  // Taille native du SVG (d’après viewBox)
  const [nativeSize, setNativeSize] = useState<{w:number, h:number}>({w:0, h:0})

  // Action au clic
  const [mode, setMode] = useState<ActionMode>('ping')

  // Align JSON (micro-ajustements globaux)
  const [alignSrc, setAlignSrc] = useState<AlignJSON | null>(null)

  // --- Observers / chargements ---

  // Observe la taille à l’écran
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
      const hardened: RoomState = {
        roomId: s.roomId ?? '',
        players: safePlayers(s.players),
        currentPlayerId: s.currentPlayerId ?? null,
        board: {
          selections: safeSelections(s.board),
          pawns: safePawns(s.board),
        }
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

  // Charger les micro-ajustements
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/overlay-align.json', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as AlignJSON
        setAlignSrc({
          offX: Number(json.offX) || 0,
          offY: Number(json.offY) || 0,
          mult: typeof json.mult === 'number' ? json.mult : 1
        })
      } catch {
        // pas grave si absent
      }
    })()
  }, [])

  // Charger le SVG inline (NON déformé)
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

        // Lire viewBox pour connaître la taille native
        if (inlineSvg.viewBox && inlineSvg.viewBox.baseVal) {
          const vb = inlineSvg.viewBox.baseVal
          setNativeSize({ w: vb.width, h: vb.height })
        } else {
          // fallback: widths/height en attributs
          const w = Number(inlineSvg.getAttribute('width')) || 0
          const h = Number(inlineSvg.getAttribute('height')) || 0
          setNativeSize({ w, h })
        }

        // IMPORTANT : on ne met PAS preserveAspectRatio="none"
        inlineSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
        inlineSvg.style.width = '100%'
        inlineSvg.style.height = '100%'

        const wrap = overlayWrapRef.current
        if (!wrap) return
        wrap.innerHTML = ''
        wrap.appendChild(inlineSvg)
        svgRef.current = inlineSvg

        // Rendre hex cliquables
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

        // Centres natifs (dans le repère du SVG)
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

  // --- Calcul de l’échelle uniforme & offsets responsives ---

  const { scaleU, effOffX, effOffY, warnAR } = useMemo(() => {
    const baseW = nativeSize.w
    const baseH = nativeSize.h
    if (!baseW || !baseH || !containerSize.w || !containerSize.h) {
      return { scaleU: 1, effOffX: 0, effOffY: 0, warnAR: false }
    }
    // facteur d’échelle théorique en largeur & hauteur
    const kx = containerSize.w / baseW
    const ky = containerSize.h / baseH
    // on force une mise à l’échelle UNIFORME (pas de déformation)
    const k = Math.min(kx, ky)
    // si l’aspect-ratio diffère vraiment, on le signale en console (info)
    const warn = Math.abs(kx - ky) > 0.02
    const mult = alignSrc?.mult ?? 1
    const offX = alignSrc?.offX ?? 0
    const offY = alignSrc?.offY ?? 0
    return {
      scaleU: k * mult,
      effOffX: offX * k,
      effOffY: offY * k,
      warnAR: warn
    }
  }, [nativeSize, containerSize, alignSrc])

  useEffect(() => {
    if (warnAR) {
      console.info('[Heroes] Le ratio du conteneur diffère du SVG — l’échelle est uniformisée (pas de déformation).')
    }
  }, [warnAR])

  // Transform appliqué au wrapper overlay (uniforme)
  const overlayTransform = `translate(${effOffX}px, ${effOffY}px) scale(${scaleU})`

  // Rendu initiales joueurs
  function initialsForPlayer(players: Player[], id: string) {
    const player = players.find(p => p.id === id)
    if (!player || !player.name) return '•'
    const parts = player.name.trim().split(/\s+/)
    const init = (parts[0]?.[0] || '').toUpperCase() + (parts[1]?.[0] || '').toUpperCase()
    return init || player.name[0].toUpperCase()
  }

  // Rendu
  const isMyTurn = useMemo(
    () => (state.currentPlayerId ?? null) !== null && state.currentPlayerId === mySocketId,
    [state.currentPlayerId, mySocketId]
  )
  const endTurn = () => (state.roomId || '') && socket.emit('endTurn', { roomId: state.roomId })

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Heroes — Overlay SVG 1:1 (sans déformation)</h1>
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
            <img
              src="/assets/board.png"
              alt="Plateau"
              style={{ display:'block', width:'100%', height:'auto' }}
            />

            {/* Overlay inline — mise à l’échelle UNIFORME + micro-offsets */}
            <div
              ref={overlayWrapRef}
              style={{
                position:'absolute', inset:0,
                transform: overlayTransform,
                transformOrigin:'top left',
                pointerEvents:'auto'
              }}
            />

            {/* Marqueurs (pions + pings) dans le même repère (uniforme) */}
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
                return (
                  <circle
                    key={`ping-${sel.playerId}-${sel.index}`}
                    cx={center.cx}
                    cy={center.cy}
                    r={6}
                    fill={colorFor(sel.playerId)}
                    opacity={0.8}
                  />
                )
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
              <p style={{ fontSize:12, color:'#666' }}>
                Si un très léger décalage subsiste, utilise <code>offX/offY</code> dans <code>overlay-align.json</code>.
                Tu peux aussi ajouter <code>"mult": 1.0</code> pour affiner l’échelle globale si besoin.
              </p>
            </div>

            <div style={{ marginTop: 16 }}>
              <h3>Infos overlay</h3>
              <p style={{ fontSize:12, color:'#666' }}>
                SVG détecté: <b>{nativeSize.w}×{nativeSize.h}</b> — Hex: <b>{hexCount}</b>
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
