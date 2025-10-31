import React, { useEffect, useState } from 'react'
import { io } from 'socket.io-client'


const socket = io() // même origine (Render)


export default function App() {
const [connected, setConnected] = useState(false)


useEffect(() => {
const onConnect = () => setConnected(true)
const onDisconnect = () => setConnected(false)


socket.on('connect', onConnect)
socket.on('disconnect', onDisconnect)


return () => {
socket.off('connect', onConnect)
socket.off('disconnect', onDisconnect)
}
}, [])


return (
<div style={{fontFamily: 'system-ui, sans-serif', padding: 24}}>
<h1>Hello Plateau 👋</h1>
<p>Socket: {connected ? 'connecté' : 'déconnecté'}</p>
</div>
)
}
