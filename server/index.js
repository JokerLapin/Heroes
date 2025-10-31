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


// Servir le build du client
const publicDir = path.join(__dirname, 'public')
app.use(express.static(publicDir))
app.get('*', (req, res) => {
res.sendFile(path.join(publicDir, 'index.html'))
})


// Socket.IO minimal
io.on('connection', (socket) => {
console.log('Socket connecté:', socket.id)


socket.on('disconnect', () => {
console.log('Socket déconnecté:', socket.id)
})
})


server.listen(PORT, () => {
console.log(`Server on http://localhost:${PORT}`)
})
