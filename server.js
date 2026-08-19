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
// MATCHES
// ============================================================

let matches = [];

const BOT_MATCH_ID = 'bot_match_nipun_permanent';

const botGameInstance = new Chess();

const permanentBotMatch = {
    id: BOT_MATCH_ID,
    p1: 'Waiting...',
    p2: '🤖 Nipun',
    p1Joined: false,
    p2Joined: true,
    fen: 'start',
    isBot: true,
    gameInstance: botGameInstance
};

matches.push(permanentBotMatch);


// ============================================================
// BOT VALUES
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
// FAST BOT
// ============================================================

function getInstantBotMove(game) {

    const moves = game.moves({
        verbose: true
    });

    if (!moves.length) {
        return null;
    }


    // --------------------------------------------------------
    // 1. Checkmate if available
    // --------------------------------------------------------

    for (const move of moves) {

        if (
            move.san &&
            move.san.includes('#')
        ) {
            return move;
        }
    }


    // --------------------------------------------------------
    // 2. Capture valuable pieces
    // --------------------------------------------------------

    const captures = moves.filter(
        move => move.captured
    );

    if (captures.length > 0) {

        captures.sort((a, b) => {

            const aValue =
                PIECE_VALUES[a.captured] || 0;

            const bValue =
                PIECE_VALUES[b.captured] || 0;

            return bValue - aValue;
        });

        return captures[0];
    }


    // --------------------------------------------------------
    // 3. Check
    // --------------------------------------------------------

    for (const move of moves) {

        if (
            move.san &&
            move.san.includes('+')
        ) {
            return move;
        }
    }


    // --------------------------------------------------------
    // 4. Random legal move
    // --------------------------------------------------------

    return moves[
        Math.floor(Math.random() * moves.length)
    ];
}


// ============================================================
// PUBLIC MATCH DATA
// ============================================================

function toPublicMatch(match) {

    return {
        id: match.id,
        p1: match.p1,
        p2: match.p2,
        p1Joined: match.p1Joined,
        p2Joined: match.p2Joined,
        isBot: match.isBot || false,
        fen: match.fen || 'start'
    };
}


function broadcastMatches() {

    io.emit(
        'init-data',
        matches.map(toPublicMatch)
    );
}


// ============================================================
// RELEASE SEAT
// ============================================================

function releaseSeat(socket) {

    if (!socket.seatInfo) {
        return;
    }

    const {
        matchId,
        color
    } = socket.seatInfo;

    const match = matches.find(
        m => m.id === matchId
    );

    if (match) {

        if (color === 'w') {

            match.p1Joined = false;

            if (match.isBot) {

                match.p1 = 'Waiting...';

                match.gameInstance.reset();

                match.fen = 'start';
            }
        }

        if (color === 'b') {
            match.p2Joined = false;
        }

        broadcastMatches();
    }

    socket.seatInfo = null;
}


// ============================================================
// API
// ============================================================

app.get('/api/matches', (req, res) => {

    res.json({
        matches: matches.map(toPublicMatch)
    });

});


// ============================================================
// SOCKET CONNECTION
// ============================================================

io.on('connection', (socket) => {

    console.log(
        'Player connected:',
        socket.id
    );


    // --------------------------------------------------------
    // Send matches immediately
    // --------------------------------------------------------

    socket.emit(
        'init-data',
        matches.map(toPublicMatch)
    );


    // ========================================================
    // JOIN MATCH
    // ========================================================

    socket.on('join-match', (matchId) => {

        const match = matches.find(
            m => m.id === matchId
        );

        if (!match) {
            return;
        }


        // IMPORTANT:
        // Actually join the Socket.IO room.
        socket.join(matchId);


        // Immediately send current board state
        socket.emit(
            'match-state',
            {
                matchId: matchId,
                fen: match.gameInstance.fen()
            }
        );

    });


    // ========================================================
    // CLAIM SEAT
    // ========================================================

    socket.on(
        'claim-seat',
        ({ matchId, color, name }) => {

            const match = matches.find(
                m => m.id === matchId
            );

            if (!match) {
                return;
            }

            const newName =
                name
                    ? name.trim()
                    : 'Player';


            // ------------------------------------------------
            // WHITE
            // ------------------------------------------------

            if (color === 'w') {

                if (
                    match.p1 !== 'Waiting...' &&
                    match.p1 !== newName
                ) {

                    match.gameInstance.reset();

                    match.fen = 'start';
                }

                match.p1Joined = true;

                match.p1 =
                    newName || match.p1;
            }


            // ------------------------------------------------
            // BLACK
            // ------------------------------------------------

            if (color === 'b') {

                if (
                    match.p2 !== '🤖 Nipun' &&
                    match.p2 !== newName
                ) {

                    match.gameInstance.reset();

                    match.fen = 'start';
                }

                match.p2Joined = true;

                match.p2 =
                    newName || match.p2;
            }


            // ------------------------------------------------
            // BOT GAME
            // ------------------------------------------------

            if (match.isBot) {

                match.gameInstance.reset();

                match.fen = 'start';
            }


            socket.seatInfo = {
                matchId,
                color
            };


            broadcastMatches();

        }
    );


    // ========================================================
    // PLAYER MOVE
    // ========================================================

    socket.on('move', (data) => {

        const match = matches.find(
            m => m.id === data.matchId
        );

        if (!match) {
            return;
        }


        try {

            // ------------------------------------------------
            // Server validates player's move
            // ------------------------------------------------

            const moveResult =
                match.gameInstance.move({
                    from: data.move.from,
                    to: data.move.to,
                    promotion:
                        data.move.promotion || 'q'
                });


            if (!moveResult) {
                return;
            }


            match.fen =
                match.gameInstance.fen();


            // ------------------------------------------------
            // Send player's move
            // ------------------------------------------------

            io.to(data.matchId).emit(
                'move',
                {
                    matchId: data.matchId,

                    move: moveResult,

                    fen: match.fen,

                    color: moveResult.color
                }
            );


            // =================================================
            // BOT RESPONSE
            // =================================================

            if (
                match.isBot &&
                !match.gameInstance.isGameOver()
            ) {

                /*
                 * NO TIMER
                 * NO setTimeout
                 * NO artificial delay
                 */

                const botMove =
                    getInstantBotMove(
                        match.gameInstance
                    );


                if (botMove) {

                    const botMoveResult =
                        match.gameInstance.move(
                            botMove
                        );


                    if (botMoveResult) {

                        match.fen =
                            match.gameInstance.fen();


                        // IMPORTANT:
                        // Send directly to the player.
                        // This avoids waiting for room delivery.

                        socket.emit(
                            'move',
                            {
                                matchId: data.matchId,

                                move: botMoveResult,

                                fen: match.fen,

                                color:
                                    botMoveResult.color
                            }
                        );
                    }
                }
            }

        } catch (err) {

            console.error(
                'Illegal move caught:',
                err.message
            );

        }

    });


    // ========================================================
    // LEAVE MATCH
    // ========================================================

    socket.on(
        'leave-match',
        (id) => {

            socket.leave(id);

            releaseSeat(socket);
        }
    );


    // ========================================================
    // DISCONNECT
    // ========================================================

    socket.on(
        'disconnect',
        () => {

            console.log(
                'Player disconnected:',
                socket.id
            );

            releaseSeat(socket);
        }
    );

});


// ============================================================
// START SERVER
// ============================================================

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    () => {

        console.log(
            `🚀 Server running on http://localhost:${PORT}`
        );

    }
);