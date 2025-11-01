const path = require('path')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })
const PORT = process.env.PORT || 3000

/**
 * Room:
 * - id
 * - players: Map<socketId, { id, name, seat, pa, ph, paMax, phMax }>
 * - order: string[]
 * - turnIndex: number
 * - board: { selections: Map<socketId,{index:number}>, pawns: Map<socketId,{index:number}> }
 */
const rooms = new Map()

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      players: new Map(),
      order: [],
      turnIndex: 0,
      board: { selections: new Map(), pawns: new Map() },
    })
  }
  return rooms.get(roomId)
}

function currentId(room) {
  if (!room.order.length) return null
  return room.order[room.turnIndex % room.order.length]
}

function startTurn(room) {
  const id = currentId(room)
  if (!id) return
  const p = room.players.get(id)
  if (p) p.pa = p.paMax // recharge PA au début du tour
}

function publicState(room) {
  return {
    roomId: room.id,
    players: Array.from(room.players.values()).sort((a, b) => a.seat - b.seat),
    currentPlayerId: currentId(room),
    board: {
      selections: Array.from(room.board.selections.entries()).map(([playerId, v]) => ({ playerId, index: v.index })),
      pawns: Array.from(room.board.pawns.entries()).map(([playerId, v]) => ({ playerId, index: v.index })),
    }
  }
}

function broadcast(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  io.to(roomId).emit('state:update', publicState(room))
}

const publicDir = path.join(__dirname, 'public')
app.use(express.static(publicDir))
app.get('*', (_, res) => res.sendFile(path.join(publicDir, 'index.html')))

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, name }) => {
    try {
      if (!roomId || !name) return
      roomId = String(roomId).trim()
      name = String(name).trim().slice(0, 24)
      const room = getOrCreateRoom(roomId)

      for (const r of socket.rooms) if (r !== socket.id) socket.leave(r)
      socket.join(roomId)

      if (!room.players.has(socket.id)) {
        const seat = room.players.size + 1
        room.players.set(socket.id, { id: socket.id, name, seat, pa: 0, ph: 0, paMax: 4, phMax: 6 })
        room.order.push(socket.id)
        if (room.order.length === 1) {
          room.turnIndex = 0
          startTurn(room)
        }
      } else {
        room.players.get(socket.id).name = name
      }
      broadcast(roomId)
    } catch (e) { console.error('joinRoom error', e) }
  })

  socket.on('selectCell', ({ roomId, index }) => {
    try {
      const room = rooms.get(roomId)
      if (!room) return
      const idx = Number(index)
      if (!Number.isInteger(idx) || idx < 0) return
      room.board.selections.set(socket.id, { index: idx })
      broadcast(roomId)
    } catch (e) { console.error('selectCell error', e) }
  })

  // Déplacer son pion — coûte 1 PA — uniquement au tour du joueur
  socket.on('setPawn', ({ roomId, index }) => {
    try {
      const room = rooms.get(roomId)
      if (!room) return
      const idx = Number(index)
      if (!Number.isInteger(idx) || idx < 0) return

      const current = currentId(room)
      if (current !== socket.id) return
      const me = room.players.get(socket.id)
      if (!me) return
      if (me.pa <= 0) return

      me.pa -= 1
      room.board.pawns.set(socket.id, { index: idx })
      broadcast(roomId)
    } catch (e) { console.error('setPawn error', e) }
  })

  // Méditer : -1 PA -> +2 PH (jusqu’à phMax) — uniquement au tour du joueur
  socket.on('meditate', ({ roomId }) => {
    try {
      const room = rooms.get(roomId)
      if (!room) return
      const current = currentId(room)
      if (current !== socket.id) return
      const me = room.players.get(socket.id)
      if (!me) return
      if (me.pa <= 0) return

      me.pa -= 1
      me.ph = Math.min(me.ph + 2, me.phMax)
      broadcast(roomId)
    } catch (e) { console.error('meditate error', e) }
  })

  socket.on('endTurn', ({ roomId }) => {
    try {
      const room = rooms.get(roomId)
      if (!room || room.order.length === 0) return
      const current = currentId(room)
      if (current !== socket.id) return
      room.turnIndex = (room.turnIndex + 1) % room.order.length
      startTurn(room)
      broadcast(roomId)
    } catch (e) { console.error('endTurn error', e) }
  })

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      if (!room.players.has(socket.id)) continue

      const wasCurrent = currentId(room) === socket.id

      room.players.delete(socket.id)
      room.board.selections.delete(socket.id)
      room.board.pawns.delete(socket.id)

      const idx = room.order.indexOf(socket.id)
      if (idx !== -1) {
        room.order.splice(idx, 1)
        if (room.order.length === 0) { rooms.delete(roomId); continue }
        if (idx <= room.turnIndex && room.turnIndex > 0) room.turnIndex -= 1
        if (room.turnIndex >= room.order.length) room.turnIndex = 0
        if (wasCurrent) startTurn(room)
      }
      broadcast(roomId)
    }
  })
})

server.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`))
