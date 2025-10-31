const path = require('path')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })
const PORT = process.env.PORT || 3000

/**
 * Room structure:
 * {
 *   id: string,
 *   players: Map<socketId, { id, name, seat }>,
 *   order: string[],
 *   turnIndex: number,
 *   board: {
 *     rows: number,
 *     cols: number,
 *     selections: Map<socketId, { r:number, c:number }>
 *   }
 * }
 */
const rooms = new Map()

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      players: new Map(),
      order: [],
      turnIndex: 0,
      board: {
        rows: 13,
        cols: 13,
        selections: new Map()
      }
    })
  }
  return rooms.get(roomId)
}

function publicState(room) {
  return {
    roomId: room.id,
    players: Array.from(room.players.values()).sort((a, b) => a.seat - b.seat),
    currentPlayerId: room.order.length ? room.order[room.turnIndex % room.order.length] : null,
    board: {
      rows: room.board.rows,
      cols: room.board.cols,
      selections: Array.from(room.board.selections.entries()).map(([playerId, cell]) => ({
        playerId, r: cell.r, c: cell.c
      }))
    }
  }
}

function broadcast(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  io.to(roomId).emit('state:update', publicState(room))
}

// Static client
const publicDir = path.join(__dirname, 'public')
app.use(express.static(publicDir))
app.get('*', (_, res) => res.sendFile(path.join(publicDir, 'index.html')))

// Sockets
io.on('connection', (socket) => {
  // JOIN
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
        room.players.set(socket.id, { id: socket.id, name, seat })
        room.order.push(socket.id)
        if (room.order.length === 1) room.turnIndex = 0
      } else {
        room.players.get(socket.id).name = name
      }
      broadcast(roomId)
    } catch (e) {
      console.error('joinRoom error', e)
    }
  })

  // END TURN
  socket.on('endTurn', ({ roomId }) => {
    try {
      const room = rooms.get(roomId)
      if (!room || room.order.length === 0) return
      const current = room.order[room.turnIndex % room.order.length]
      if (current !== socket.id) return
      room.turnIndex = (room.turnIndex + 1) % room.order.length
      broadcast(roomId)
    } catch (e) {
      console.error('endTurn error', e)
    }
  })

  // SELECT CELL
  socket.on('selectCell', ({ roomId, r, c }) => {
    try {
      const room = rooms.get(roomId)
      if (!room) return
      const rr = Number(r), cc = Number(c)
      if (!Number.isInteger(rr) || !Number.isInteger(cc)) return
      if (rr < 0 || cc < 0 || rr >= room.board.rows || cc >= room.board.cols) return
      room.board.selections.set(socket.id, { r: rr, c: cc })
      broadcast(roomId)
    } catch (e) {
      console.error('selectCell error', e)
    }
  })

  // DISCONNECT
  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      if (!room.players.has(socket.id)) continue
      const wasCurrent = room.order.length
        ? room.order[room.turnIndex % room.order.length] === socket.id
        : false

      room.players.delete(socket.id)
      room.board.selections.delete(socket.id)

      const idx = room.order.indexOf(socket.id)
      if (idx !== -1) {
        room.order.splice(idx, 1)
        if (room.order.length === 0) { rooms.delete(roomId); continue }
        if (idx < room.turnIndex) room.turnIndex -= 1
        if (room.turnIndex >= room.order.length) room.turnIndex = 0
        if (wasCurrent) { /* turnIndex pointe déjà sur le suivant */ }
      }
      broadcast(roomId)
    }
  })
})

server.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`))
