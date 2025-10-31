const path = require('path')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*' }
})

const PORT = process.env.PORT || 3000

// ---- État en mémoire ------------------------------------------------------
/**
 * rooms: Map<roomId, {
 *   id: string,
 *   players: Map<socketId, { id: string, name: string, seat: number }>,
 *   order: string[],               // ordre des socketId pour le tour
 *   turnIndex: number              // index dans 'order'
 * }>
 */
const rooms = new Map()

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      players: new Map(),
      order: [],
      turnIndex: 0
    })
  }
  return rooms.get(roomId)
}

function publicState(room) {
  return {
    roomId: room.id,
    players: Array.from(room.players.values())
      .sort((a, b) => a.seat - b.seat)
      .map(p => ({ id: p.id, name: p.name, seat: p.seat })),
    currentPlayerId: room.order.length ? room.order[room.turnIndex % room.order.length] : null
  }
}

function broadcast(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  io.to(roomId).emit('state:update', publicState(room))
}

// ---- Servir le build du client -------------------------------------------
const publicDir = path.join(__dirname, 'public')
app.use(express.static(publicDir))
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'))
})

// ---- Socket.IO -------------------------------------------------------------
io.on('connection', (socket) => {
  console.log('Socket connecté:', socket.id)

  socket.on('joinRoom', ({ roomId, name }) => {
    try {
      if (typeof roomId !== 'string' || !roomId.trim()) return
      if (typeof name !== 'string' || !name.trim()) return

      roomId = roomId.trim()
      name = name.trim().slice(0, 24)

      const room = getOrCreateRoom(roomId)

      // Si déjà dans une autre room, on la quitte proprement
      for (const r of socket.rooms) {
        if (r !== socket.id) socket.leave(r)
      }

      socket.join(roomId)

      // Évite les doublons si reconnect
      if (!room.players.has(socket.id)) {
        const seat = room.players.size + 1
        room.players.set(socket.id, { id: socket.id, name, seat })
        room.order.push(socket.id)
        // Si c'est le 1er joueur, c'est à lui de jouer
        if (room.order.length === 1) room.turnIndex = 0
      } else {
        // Mise à jour du nom au cas où
        const p = room.players.get(socket.id)
        p.name = name
      }

      broadcast(roomId)
    } catch (e) {
      console.error('joinRoom error', e)
    }
  })

  socket.on('endTurn', ({ roomId }) => {
    try {
      const room = rooms.get(roomId)
      if (!room) return
      const current = room.order.length ? room.order[room.turnIndex % room.order.length] : null
      // Validation simple : seul le joueur courant peut terminer son tour
      if (current !== socket.id) return

      // Avance au suivant
      room.turnIndex = (room.turnIndex + 1) % room.order.length
      broadcast(roomId)
    } catch (e) {
      console.error('endTurn error', e)
    }
  })

  socket.on('disconnect', () => {
    // Retire le joueur de toutes les rooms où il se trouve
    for (const [roomId, room] of rooms.entries()) {
      if (!room.players.has(socket.id)) continue

      // Trouver l'index du joueur courant avant retrait
      const wasCurrent = room.order.length
        ? room.order[room.turnIndex % room.order.length] === socket.id
        : false

      // Retirer des structures
      room.players.delete(socket.id)
      const idx = room.order.indexOf(socket.id)
      if (idx !== -1) {
        room.order.splice(idx, 1)
        if (room.order.length === 0) {
          // Plus personne → on supprime la room
          rooms.delete(roomId)
          continue
        }
        // Corriger turnIndex
        if (idx < room.turnIndex) room.turnIndex -= 1
        if (room.turnIndex >= room.order.length) room.turnIndex = 0

        // Si c'était le joueur courant, on passe au suivant (ne bloque pas le tour)
        if (wasCurrent) {
          // (facultatif : on peut laisser le même turnIndex, il pointe déjà sur le prochain)
        }
      }
      broadcast(roomId)
    }

    console.log('Socket déconnecté:', socket.id)
  })
})

server.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`)
})
