const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
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
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// ============================================================
// ADMIN CONFIGURATION
// ============================================================
const ADMIN_USERNAME = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASS || "admin123";
const ADMIN_TOKEN = "rk_chess_admin_auth_token_998877";

// ============================================================
// HOME PAGE
// ============================================================
app.get('/', (req, res) => {
    const publicIndexPath = path.join(__dirname, 'public', 'index.html');
    const rootIndexPath = path.join(__dirname, 'index.html');

    if (fs.existsSync(publicIndexPath)) {
        res.sendFile(publicIndexPath);
    } else if (fs.existsSync(rootIndexPath)) {
        res.sendFile(rootIndexPath);
    } else {
        res.status(404).send('index.html not found!');
    }
});

// ============================================================
// MATCH STORAGE
// ============================================================
let matches = [];

// ============================================================
// PERMANENT NIPUN TOURNAMENT
// ============================================================
const BOT_MATCH_ID = 'bot_match_nipun_permanent';
const botGameInstance = new Chess();

const permanentBotMatch = {
    id: BOT_MATCH_ID,
    name: '🏆 Tournament',
    mode: 'Bot Tournament',
    p1: 'Waiting...',
    p2: '🤖 Nipun',
    p1Joined: false,
    p2Joined: true,
    fen: 'start',
    isBot: true,
    permanent: true,
    gameInstance: botGameInstance
};

matches.push(permanentBotMatch);

// ============================================================
// BOT PIECE VALUES
// ============================================================
const PIECE_VALUES = {
    p: 10,
    n: 30,
    b: 35,
    r: 50,
    q: 90,
    k: 1000
};

// ============================================================
// FAST NIPUN BOT
// ============================================================
function getInstantBotMove(game) {
    const moves = game.moves({ verbose: true });
    if (!moves.length) return null;

    for (const move of moves) {
        if (move.san && move.san.includes('#')) return move;
    }

    const captures = moves.filter(move => move.captured);
    if (captures.length > 0) {
        captures.sort((a, b) => (PIECE_VALUES[b.captured] || 0) - (PIECE_VALUES[a.captured] || 0));
        return captures[0];
    }

    for (const move of moves) {
        if (move.san && move.san.includes('+')) return move;
    }

    return moves[Math.floor(Math.random() * moves.length)];
}

// ============================================================
// PUBLIC MATCH INFORMATION
// ============================================================
function toPublicMatch(match) {
    return {
        id: match.id,
        name: match.name || '⚔️ Player Match',
        mode: match.mode || 'Standard',
        p1: match.p1,
        p2: match.p2,
        p1Joined: match.p1Joined,
        p2Joined: match.p2Joined,
        isBot: match.isBot || false,
        permanent: match.permanent || false,
        fen: match.fen || 'start'
    };
}

function broadcastMatches() {
    io.emit('init-data', matches.map(toPublicMatch));
}

function findMatch(matchId) {
    return matches.find(match => match.id === matchId);
}

function cleanupMatch(match) {
    if (match.permanent) return;

    if (!match.p1Joined && !match.p2Joined) {
        const index = matches.indexOf(match);
        if (index !== -1) {
            matches.splice(index, 1);
            console.log('Removed empty match:', match.id);
            broadcastMatches();
        }
    }
}

function releaseSeat(socket) {
    if (!socket.seatInfo) return;

    const { matchId, color } = socket.seatInfo;
    const match = findMatch(matchId);

    if (!match) {
        socket.seatInfo = null;
        return;
    }

    if (color === 'w') {
        match.p1Joined = false;
        if (match.isBot) {
            match.p1 = 'Waiting...';
            match.gameInstance.reset();
            match.fen = 'start';
        } else {
            match.p1 = 'Waiting...';
        }
    }

    if (color === 'b') {
        match.p2Joined = false;
        if (!match.isBot) {
            match.p2 = 'Waiting...';
        }
    }

    socket.leave(matchId);
    socket.seatInfo = null;

    cleanupMatch(match);
    broadcastMatches();
}

// ============================================================
// API
// ============================================================
app.get('/api/matches', (req, res) => {
    res.json({ matches: matches.map(toPublicMatch) });
});

// ============================================================
// SOCKET CONNECTION
// ============================================================
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.emit('init-data', matches.map(toPublicMatch));

    // PERMISSION ACTION LISTENERS
    socket.on('request-action', ({ matchId, action, sender }) => {
        socket.to(matchId).emit('action-requested', { action, sender });
    });

    socket.on('decline-action', ({ matchId, action, sender }) => {
        socket.to(matchId).emit('action-declined', { action, sender });
    });

    socket.on('confirm-action', ({ matchId, action }) => {
        const match = findMatch(matchId);
        if (!match) return;

        if (action === 'reset') {
            match.gameInstance.reset();
            match.fen = 'start';
            io.to(matchId).emit('reset-match', { matchId });
        } else if (action === 'undo') {
            match.gameInstance.undo();
            if (match.isBot) {
                match.gameInstance.undo();
            }
            match.fen = match.gameInstance.fen();
            io.to(matchId).emit('undo-move', { matchId, isBot: match.isBot });
        }
    });

    // ADMIN AUTHENTICATION
    socket.on('admin-login', ({ username, password }) => {
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            socket.emit('admin-login-response', {
                success: true,
                token: ADMIN_TOKEN
            });
        } else {
            socket.emit('admin-login-response', {
                success: false,
                message: 'Invalid Admin Username or Password'
            });
        }
    });

    // ADMIN CREATE MATCH
    socket.on('admin-create-match', ({ token, p1, p2 }) => {
        if (token !== ADMIN_TOKEN) {
            return socket.emit('admin-login-response', {
                success: false,
                message: 'Unauthorized: Session expired or invalid token.'
            });
        }

        const matchId = 'match_' + Date.now();
        const newGame = new Chess();

        const newMatch = {
            id: matchId,
            name: '⚔️ Admin Hosted Match',
            mode: 'Standard',
            p1: p1 || 'Waiting...',
            p2: p2 || 'Waiting...',
            p1Joined: false,
            p2Joined: false,
            fen: 'start',
            isBot: false,
            permanent: false,
            gameInstance: newGame
        };

        matches.push(newMatch);
        broadcastMatches();
        socket.emit('match-created-by-admin', { matchId });
    });

    // JOIN MATCH
    socket.on('join-match', (matchId) => {
        const match = findMatch(matchId);
        if (!match) return;

        socket.join(matchId);
        socket.emit('match-state', {
            matchId,
            fen: match.gameInstance.fen()
        });
    });

    // CLAIM SEAT
    socket.on('claim-seat', ({ matchId, color, name }) => {
        const match = findMatch(matchId);
        if (!match) return;

        const playerName = typeof name === 'string' && name.trim() ? name.trim() : 'Player';
        socket.join(matchId);

        if (color === 'w') {
            if (match.isBot) {
                match.gameInstance.reset();
                match.fen = 'start';
                match.p1 = playerName;
                match.p1Joined = true;
            } else {
                if (match.p1Joined && match.p1 !== playerName) {
                    socket.emit('seat-error', { message: 'White seat is already taken.' });
                    return;
                }
                match.p1 = playerName;
                match.p1Joined = true;
            }
        } else if (color === 'b') {
            if (match.isBot) {
                socket.emit('seat-error', { message: 'Nipun is already playing Black.' });
                return;
            }

            if (match.p2Joined && match.p2 !== playerName) {
                socket.emit('seat-error', { message: 'Black seat is already taken.' });
                return;
            }
            match.p2 = playerName;
            match.p2Joined = true;
        } else {
            return;
        }

        socket.seatInfo = { matchId, color };
        socket.emit('match-state', { matchId, fen: match.gameInstance.fen() });
        broadcastMatches();
    });

    // PLAYER MOVE
    socket.on('move', (data) => {
        const match = findMatch(data.matchId);
        if (!match) return;

        if (!socket.seatInfo || socket.seatInfo.matchId !== data.matchId) return;

        const playerColor = socket.seatInfo.color;
        if (match.gameInstance.turn() !== playerColor) return;

        try {
            const moveResult = match.gameInstance.move({
                from: data.move.from,
                to: data.move.to,
                promotion: data.move.promotion || 'q'
            });

            if (!moveResult) return;

            match.fen = match.gameInstance.fen();

            io.to(data.matchId).emit('move', {
                matchId: data.matchId,
                move: moveResult,
                fen: match.fen,
                color: moveResult.color
            });

            // NIPUN RESPONSE
            if (match.isBot && !match.gameInstance.isGameOver()) {
                const botMove = getInstantBotMove(match.gameInstance);
                if (botMove) {
                    const botMoveResult = match.gameInstance.move(botMove);
                    if (botMoveResult) {
                        match.fen = match.gameInstance.fen();
                        socket.emit('move', {
                            matchId: data.matchId,
                            move: botMoveResult,
                            fen: match.fen,
                            color: botMoveResult.color
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Move error:', error.message);
        }
    });

    // CHAT
    socket.on('chat-message', (data) => {
        const match = findMatch(data.matchId);
        if (!match) return;

        io.to(data.matchId).emit('chat-message', {
            matchId: data.matchId,
            sender: data.sender,
            text: data.text
        });
    });

    // LEAVE MATCH
    socket.on('leave-match', (matchId) => {
        if (socket.seatInfo && socket.seatInfo.matchId === matchId) {
            releaseSeat(socket);
        } else {
            socket.leave(matchId);
        }
    });

    // DISCONNECT
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        releaseSeat(socket);
    });
});

// START SERVER
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});