import React, { useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Player = { id: string; name: string; seat: number }
type Selection = { playerId: string; index: number }
type Pawn = { playerId: string; index: number }
type RoomState = {
  roomId: string
  players: Player[]
  currentPlayerId: string | null
  board: { selections: Selection[]; pawns: Pawn[] }
}

type AlignJSON = {
  scaleX: number
  scaleY: number
  offX: number
  offY: number
  baseW?: number // largeur de référence (px)
  baseH?: number // hauteur de référence (px)
}

const socket: Socket = io()

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

  // État serveur
  const [state, setState] = useState<RoomState>({
    roomId: '',
    players: [],
    currentPlayerId: null,
    board: { selections: [], pawns: [] },
  })

  // Overlay inline
  const containerRef = useRef<HTMLDivElement>(null)     // conteneur plateau
  const overlayWrapRef = useRef<HTMLDivElement>(null)   // wrapper transformé
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hexCenters, setHexCenters] = useState<Array<{cx:number, cy:number}>>([])
  const [hexCount, setHexCount] = useState(0)

  // Action (ping ou déplacer pion)
  const [mode, setMode] = useState<ActionMode>('ping')

  // --------- ALIGNEMENT (responsive) ----------
  // Valeurs sources lues depuis overlay-align.json (et PAS le localStorage)
  const [alignSrc, setAlignSrc] = useState<AlignJSON | null>(null)
  // Mesures runtime (taille actuelle du plateau affiché)
  const [containerSize, setContainerSize] = useState<{w:number, h:number}>({w:0, h:0})

  // Calcul des valeurs effectives en fonction de la taille d’écran
  const { effScaleX, effScaleY, effOffX, effOffY } = useMemo(() => {
    if (!alignSrc || !containerSize.w || !containerSize.h) {
      return { effScaleX: 1, effScaleY: 1, effOffX: 0, effOffY: 0 }
    }
    // Nettoyage des valeurs (corrige le bug "680" -> "0.680")
    const clean = (v: number) => (v > 5 ? v / 1000 : v)

    const baseW = alignSrc.baseW && alignSrc.baseW > 0 ? alignSrc.baseW : containerSize.w
    const baseH = alignSrc.baseH && alignSrc.baseH > 0 ? alignSrc.baseH : containerSize.h

    const kx = containerSize.w / baseW
    const ky = containerSize.h / baseH

    const scaleX = clean(alignSrc.scaleX)
    const scaleY = clean(alignSrc.scaleY)
    const offX = alignSrc.offX
    const offY = alignSrc.offY

    return {
      effScaleX: scaleX * kx,
      effScaleY: scaleY * ky,
      effOffX: offX * kx,
      effOffY: offY * ky,
    }
  }, [alignSrc, containerSize])

  // Layout resize observer pour maj containerSize
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

  // Charger ALIGN JSON (priorité absolue; ignore le localStorage)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/overlay-align.json', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as AlignJSON
        setAlignSrc(json)
      } catch {}
    })()
  }, [])

  // Export alignement NORMALISÉ (inclut baseW/baseH pour un rendu identique partout)
  function exportAlignNormalized() {
    // si pas encore de base, on capture la taille actuelle du conteneur comme référence
    const baseW = alignSrc?.baseW && alignSrc.baseW > 0 ? alignSrc.baseW : containerSize.w
    const baseH = alignSrc?.baseH && alignSrc.baseH > 0 ? alignSrc.baseH : containerSize.h
    // pour réexporter, on inverse la projection afin d’enregistrer les "valeurs sources"
    const kx = baseW ? containerSize.w / baseW : 1
    const ky = baseH ? containerSize.h / baseH : 1
    const src = alignSrc || { scaleX: 1, scaleY: 1, offX: 0, offY: 0 }
    const clean = (v:number)=> (v>5? v/1000 : v)

    const data: AlignJSON = {
      scaleX: clean(src.scaleX),
      scaleY: clean(src.scaleY),
      offX: src.offX,
      offY: src.offY,
      baseW,
      baseH
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
            if (!state.roomId) return
            if (mode === 'ping') socket.emit('selectCell', { roomId: state.roomId, index })
            else socket.emit('setPawn', { roomId: state.roomId, index })
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
    () => state.currentPlayerId !== null && state.currentPlayerId === mySocketId,
    [state.currentPlayerId, mySocketId]
  )
  const endTurn = () => state.roomId && socket.emit('endTurn', { roomId: state.roomId })

  // Transform appliqué au wrapper overlay (responsive)
  const overlayTransform = `translate(${effOffX}px, ${effOffY}px) scale(${effScaleX}, ${effScaleY})`

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Heroes — Overlay SVG aligné & responsive</h1>
      <p>Socket: {connected ? '✅ connecté' : '❌ déconnecté'} · ID: {mySocketId || '...'}</p>

      {!joined ? (
        <form onSubmit={(e)=>{e.preventDefault(); if(name.trim() && roomId.trim()) socket.emit('joinRoom', { roomId: roomId.trim(), name: name.trim() })}} style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
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
              {state.board.pawns.map(p => {
                const center = hexCenters[p.index]
                if (!center) return null
                const color = colorFor(p.playerId)
                const me = p.playerId === mySocketId
                return (
                  <g key={`pawn-${p.playerId}`}>
                    <circle cx={center.cx} cy={center.cy} r={10} fill={color} stroke="#000" strokeWidth={1} />
                    <text x={center.cx} y={center.cy + 3} fontSize="10" textAnchor="middle" fill="#fff" style={{fontWeight:600}}>
                      {initialsForPlayer(state.players, p.playerId)}
                    </text>
                    {me && <circle cx={center.cx} cy={center.cy} r={14} fill="none" stroke={color} strokeWidth={2} opacity={0.6} />}
                  </g>
                )
              })}
              {/* Pings */}
              {state.board.selections.map(sel => {
                const center = hexCenters[sel.index]
                if (!center) return null
                return <circle key={`ping-${sel.playerId}-${sel.index}`} cx={center.cx} cy={center.cy} r={6} fill={colorFor(sel.playerId)} opacity={0.8} />
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
                Ce fichier inclut <code>baseW/baseH</code> pour un rendu identique sur tous les écrans.
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
