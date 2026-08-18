const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let matches = [];

// Helper function to broadcast match list updates
function broadcastMatches() {
    io.emit('init-data', matches.map(({ id, p1, p2, p1Joined, p2Joined }) => ({
        id, p1, p2, p1Joined, p2Joined
    })));
}

// Helper function to release a player's seat when leaving or disconnecting
function releaseSeat(socket) {
    if (!socket.seatInfo) return;
    const { matchId, color } = socket.seatInfo;
    const match = matches.find(m => m.id === matchId);

    if (match) {
        if (color === 'w') match.p1Joined = false;
        if (color === 'b') match.p2Joined = false;
        broadcastMatches();
    }
    socket.seatInfo = null;
}

io.on('connection', (socket) => {
// Admin Authentication Verification Event
socket.on('verify-admin', (data) => {
    const ADMIN_USER = process.env.ADMIN_USER || "admin";
    const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

    if (data.username === ADMIN_USER && data.password === ADMIN_PASS) {
        socket.emit('admin-verify-response', { 
            success: true, 
            credentials: { username: data.username, password: data.password } 
        });
    } else {
        socket.emit('admin-verify-response', { 
            success: false 
        });
    }
});
    // Send initial match list
    socket.emit('init-data', matches.map(({ id, p1, p2, p1Joined, p2Joined }) => ({
        id, p1, p2, p1Joined, p2Joined
    })));

    // Admin Match Creation
    socket.on('create-match-admin', (data) => {
        const ADMIN_USER = process.env.ADMIN_USER || "admin";
        const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

        if (data.username === ADMIN_USER && data.password === ADMIN_PASS) {
            const gameInstance = new Chess();
            const newMatch = { 
                id: "match_" + Date.now(),
                p1: data.p1,
                p2: data.p2,
                p1Joined: false,
                p2Joined: false,
                fen: 'start', 
                gameInstance 
            };
            matches.push(newMatch);

            broadcastMatches();
            socket.emit('admin-response', { success: true, message: "Match created successfully!" });
        } else {
            socket.emit('admin-response', { success: false, message: "Invalid Admin Username or Password!" });
        }
    });

    // Claim Player Seat & Store Socket Reference
    socket.on('claim-seat', ({ matchId, color }) => {
        const match = matches.find(m => m.id === matchId);
        if (!match) return;

        if (color === 'w') match.p1Joined = true;
        if (color === 'b') match.p2Joined = true;

        // Save active seat info on this socket connection
        socket.seatInfo = { matchId, color };

        broadcastMatches();
    });

    socket.on('join-match', (id) => {
        socket.join(id);
        const match = matches.find(m => m.id === id);
        if (match) {
            socket.emit('match-state', { matchId: id, fen: match.gameInstance.fen() });
        }
    });

    socket.on('chat-message', (data) => {
        io.to(data.matchId).emit('chat-message', data);
    });

    // Release seat when leaving match
    socket.on('leave-match', (id) => {
        socket.leave(id);
        releaseSeat(socket);
    });

    socket.on('move', (data) => {
        const match = matches.find(m => m.id === data.matchId);
        if (!match) return;

        try {
            const moveResult = match.gameInstance.move({
                from: data.move.from,
                to: data.move.to,
                promotion: data.move.promotion || 'q'
            });

            if (moveResult) {
                match.fen = match.gameInstance.fen();
                io.to(data.matchId).emit('move', {
                    matchId: data.matchId,
                    move: moveResult,
                    fen: match.fen
                });
            }
        } catch (err) {
            console.error("Illegal move attempt caught:", err.message);
        }
    });

    socket.on('undo', (data) => {
        const match = matches.find(m => m.id === data.matchId);
        if (!match) return;

        match.gameInstance.undo();
        match.fen = match.gameInstance.fen();

        io.to(data.matchId).emit('undo', {
            matchId: data.matchId,
            fen: match.fen
        });
    });

    socket.on('reset', (data) => {
        const match = matches.find(m => m.id === data.matchId);
        if (!match) return;

        match.gameInstance.reset();
        match.fen = 'start';

        io.to(data.matchId).emit('reset', {
            matchId: data.matchId
        });
    });

    // Automatically release seat when browser tab/window is closed
    socket.on('disconnect', () => {
        releaseSeat(socket);
        console.log('❌ User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});