const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

let matches = [];
let tournaments = [];

function toPublicMatch(match) {
    return {
        id: match.id,
        p1: match.p1,
        p2: match.p2,
        p1Joined: match.p1Joined,
        p2Joined: match.p2Joined,
        tournamentId: match.tournamentId || null,
        fen: match.fen || 'start'
    };
}

function toPublicTournament(tournament) {
    return {
        id: tournament.id,
        name: tournament.name,
        organizer: tournament.organizer,
        description: tournament.description,
        format: tournament.format,
        players: tournament.players || [],
        status: tournament.status,
        createdAt: tournament.createdAt
    };
}

function createMatchRecord({ p1, p2, tournamentId = null }) {
    const gameInstance = new Chess();
    const newMatch = {
        id: 'match_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        p1,
        p2,
        p1Joined: false,
        p2Joined: false,
        fen: 'start',
        tournamentId,
        gameInstance
    };

    matches.push(newMatch);
    broadcastMatches();
    return newMatch;
}

// Helper function to broadcast match list updates
function broadcastMatches() {
    io.emit('init-data', matches.map(toPublicMatch));
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

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'modern-chess-v2' });
});

app.get('/api/matches', (req, res) => {
    res.json({ matches: matches.map(toPublicMatch) });
});

app.get('/api/tournaments', (req, res) => {
    res.json({ tournaments: tournaments.map(toPublicTournament) });
});

app.post('/api/matches', (req, res) => {
    const { p1, p2, tournamentId } = req.body || {};

    if (!p1 || !p2) {
        return res.status(400).json({ success: false, message: 'Both p1 and p2 are required.' });
    }

    const match = createMatchRecord({ p1, p2, tournamentId });
    res.status(201).json({ success: true, match: toPublicMatch(match) });
});

app.post('/api/tournaments', (req, res) => {
    const { name, organizer, description, format, players } = req.body || {};

    if (!name || !Array.isArray(players) || players.length < 2) {
        return res.status(400).json({
            success: false,
            message: 'Tournament name and at least two player names are required.'
        });
    }

    const tournament = {
        id: 'tournament_' + Date.now(),
        name,
        organizer: organizer || 'admin',
        description: description || '',
        format: format || 'single-elimination',
        players: players.map(p => String(p).trim()).filter(Boolean),
        status: 'created',
        createdAt: new Date().toISOString()
    };

    tournaments.push(tournament);

    const createdMatches = [];
    for (let i = 0; i < tournament.players.length; i += 2) {
        const p1 = tournament.players[i];
        const p2 = tournament.players[i + 1] || 'BYE';

        if (p2 === 'BYE') {
            createdMatches.push({
                id: `bye_${Date.now()}_${i}`,
                p1,
                p2: 'BYE',
                p1Joined: false,
                p2Joined: false,
                tournamentId: tournament.id,
                fen: 'start'
            });
            continue;
        }

        const match = createMatchRecord({ p1, p2, tournamentId: tournament.id });
        createdMatches.push(toPublicMatch(match));
    }

    res.status(201).json({
        success: true,
        tournament: toPublicTournament(tournament),
        matches: createdMatches
    });
});

app.post('/api/tournaments/:id/matches', (req, res) => {
    const tournament = tournaments.find(t => t.id === req.params.id);
    if (!tournament) {
        return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    const { players } = req.body || {};
    const finalPlayers = Array.isArray(players) ? players : tournament.players;

    if (!Array.isArray(finalPlayers) || finalPlayers.length < 2) {
        return res.status(400).json({ success: false, message: 'Need at least two players.' });
    }

    const createdMatches = [];
    for (let i = 0; i < finalPlayers.length; i += 2) {
        const p1 = String(finalPlayers[i]).trim();
        const p2 = String(finalPlayers[i + 1] || 'BYE').trim();

        if (!p1) continue;
        if (!p2 || p2 === 'BYE') {
            createdMatches.push({
                id: `bye_${Date.now()}_${i}`,
                p1,
                p2: 'BYE',
                p1Joined: false,
                p2Joined: false,
                tournamentId: tournament.id,
                fen: 'start'
            });
            continue;
        }

        const match = createMatchRecord({ p1, p2, tournamentId: tournament.id });
        createdMatches.push(toPublicMatch(match));
    }

    res.json({ success: true, matches: createdMatches });
});

io.on('connection', (socket) => {
    // Admin Authentication Verification Event
    socket.on('verify-admin', (data) => {
        const ADMIN_USER = process.env.ADMIN_USER || 'admin';
        const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

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
    socket.emit('init-data', matches.map(toPublicMatch));

    // Admin Match Creation
    socket.on('create-match-admin', (data) => {
        const ADMIN_USER = process.env.ADMIN_USER || 'admin';
        const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

        if (data.username === ADMIN_USER && data.password === ADMIN_PASS) {
            createMatchRecord({ p1: data.p1, p2: data.p2, tournamentId: data.tournamentId || null });
            socket.emit('admin-response', { success: true, message: 'Match created successfully!' });
        } else {
            socket.emit('admin-response', { success: false, message: 'Invalid Admin Username or Password!' });
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
            console.error('Illegal move attempt caught:', err.message);
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