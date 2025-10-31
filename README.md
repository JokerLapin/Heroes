# Boardgame Web — Mono‑repo


- `client/` : React + Vite + TypeScript
- `server/` : Node + Express + Socket.IO (sert le build du client)


Scripts racine utiles :
- `npm run build` : build du client et copie vers `server/public`
- `npm start` : lance le serveur Node (sert le build et Socket.IO)
