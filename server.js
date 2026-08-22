const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const matches = [];

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

const NIPUN_MATCH_ID = "nipun_bot_tournament";

function newGame() {
    return new Chess();
}

function createNipunMatch() {
    const game = newGame();
    return {
        id: NIPUN_MATCH_ID,
        tournamentName: "🏆 Nipun Bot Tournament",
        p1: "Waiting...",
        p2: "🤖 Nipun",
        p1Joined: false,
        p2Joined: true,
        isBot: true,
        fen: game.fen(),
        gameInstance: game
    };
}

matches.push(createNipunMatch());

function publicMatches() {
    return matches.map(m => ({
        id: m.id,
        tournamentName: m.tournamentName,
        p1: m.p1,
        p2: m.p2,
        p1Joined: m.p1Joined,
        p2Joined: m.p2Joined,
        isBot: !!m.isBot
    }));
}

function broadcastMatches() {
    io.emit("init-data", publicMatches());
}

function isGameOver(game) {
    return typeof game.isGameOver === "function"
        ? game.isGameOver()
        : game.game_over();
}

function releaseSeat(socket) {
    const info = socket.seatInfo;
    if (!info) return;

    const match = matches.find(m => m.id === info.matchId);

    if (match) {
        if (match.isBot && info.color === "w") {
            match.p1Joined = false;
            match.p1 = "Waiting...";
            match.gameInstance.reset();
            match.fen = match.gameInstance.fen();
        } else if (!match.isBot) {
            if (info.color === "w") {
                match.p1Joined = false;
            }
            if (info.color === "b") {
                match.p2Joined = false;
            }
        }

        broadcastMatches();
    }

    socket.seatInfo = null;
}

function getBotMove(game) {
    const moves = game.moves({ verbose: true });
    if (!moves.length) return null;

    const values = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

    let bestScore = -Infinity;
    let best = [];

    for (const move of moves) {
        let score = Math.random() * 8;

        if (move.captured) {
            score += values[move.captured] || 0;
        }

        if (move.promotion) {
            score += values[move.promotion] || 0;
        }

        try {
            game.move({
                from: move.from,
                to: move.to,
                promotion: move.promotion || "q"
            });

            if (game.isCheckmate ? game.isCheckmate() : game.in_checkmate()) {
                score += 100000;
            } else if (game.isCheck ? game.isCheck() : game.in_check()) {
                score += 300;
            }

            game.undo();
        } catch {
            continue;
        }

        if (score > bestScore) {
            bestScore = score;
            best = [move];
        } else if (score === bestScore) {
            best.push(move);
        }
    }

    return best.length ? best[Math.floor(Math.random() * best.length)] : null;
}

function makeNipunMove(match) {
    if (!match || !match.isBot) return;

    const game = match.gameInstance;
    if (isGameOver(game) || game.turn() !== "b") return;

    clearTimeout(match.botTimer);

    match.botTimer = setTimeout(() => {
        if (isGameOver(game) || game.turn() !== "b") return;

        const move = getBotMove(game);
        if (!move) return;

        let result;
        try {
            result = game.move({
                from: move.from,
                to: move.to,
                promotion: move.promotion || "q"
            });
        } catch (err) {
            console.error("Nipun bot move error:", err);
            return;
        }

        if (!result) return;

        match.fen = game.fen();

        io.to(match.id).emit("move", {
            matchId: match.id,
            move: result,
            fen: match.fen,
            bot: true
        });

        broadcastMatches();
    }, 180);
}

io.on("connection", socket => {
    console.log("✅ Connected:", socket.id);

    socket.emit("init-data", publicMatches());

    socket.on("verify-admin", data => {
        const success =
            data &&
            data.username === ADMIN_USER &&
            data.password === ADMIN_PASS;

        socket.emit("admin-verify-response", {
            success,
            username: success ? ADMIN_USER : undefined
        });
    });

    socket.on("create-match-admin", data => {
        if (
            !data ||
            data.username !== ADMIN_USER ||
            data.password !== ADMIN_PASS
        ) {
            socket.emit("admin-response", {
                success: false,
                message: "Invalid Admin Username or Password!"
            });
            return;
        }

        const tournamentName = String(data.tournamentName || "").trim();
        const p1 = String(data.p1 || "").trim();
        const p2 = String(data.p2 || "").trim();

        if (!tournamentName || !p1 || !p2) {
            socket.emit("admin-response", {
                success: false,
                message: "Tournament name and both player names are required."
            });
            return;
        }

        const game = newGame();

        const match = {
            id: "match_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
            tournamentName,
            p1,
            p2,
            p1Joined: false,
            p2Joined: false,
            isBot: false,
            fen: game.fen(),
            gameInstance: game
        };

        matches.push(match);
        broadcastMatches();

        socket.emit("admin-response", {
            success: true,
            message: `🏆 "${tournamentName}" created successfully!`
        });
    });

    socket.on("claim-seat", data => {
        const match = matches.find(m => m.id === data?.matchId);
        if (!match) return;

        if (data.color !== "w" && data.color !== "b") return;

        if (match.isBot) {
            if (data.color !== "w" || match.p1Joined) return;

            match.p1Joined = true;
            socket.seatInfo = { matchId: match.id, color: "w" };
            broadcastMatches();
            return;
        }

        if (data.color === "w") {
            if (match.p1Joined) return;
            match.p1Joined = true;
        }

        if (data.color === "b") {
            if (match.p2Joined) return;
            match.p2Joined = true;
        }

        socket.seatInfo = {
            matchId: match.id,
            color: data.color
        };

        broadcastMatches();
    });

    socket.on("set-player-name", data => {
        const match = matches.find(m => m.id === data?.matchId);
        if (!match) return;

        const name = String(data.name || "").trim();
        if (!name) return;

        if (data.color === "w") match.p1 = name;
        if (!match.isBot && data.color === "b") match.p2 = name;

        broadcastMatches();
    });

    socket.on("join-match", id => {
        const match = matches.find(m => m.id === id);
        if (!match) return;

        socket.join(id);

        socket.emit("match-state", {
            matchId: id,
            fen: match.gameInstance.fen(),
            tournamentName: match.tournamentName,
            p1: match.p1,
            p2: match.p2
        });
    });

    socket.on("move", data => {
        const match = matches.find(m => m.id === data?.matchId);
        if (!match || !data.move) return;

        if (!socket.seatInfo || socket.seatInfo.matchId !== match.id) return;

        if (match.isBot) {
            if (socket.seatInfo.color !== "w") return;
            if (match.gameInstance.turn() !== "w") return;
        } else {
            if (match.gameInstance.turn() !== socket.seatInfo.color) return;
        }

        let result;
        try {
            result = match.gameInstance.move({
                from: data.move.from,
                to: data.move.to,
                promotion: data.move.promotion || "q"
            });
        } catch (err) {
            console.log("Illegal move:", err.message);
            return;
        }

        if (!result) return;

        match.fen = match.gameInstance.fen();

        io.to(match.id).emit("move", {
            matchId: match.id,
            move: result,
            fen: match.fen,
            bot: false
        });

        if (match.isBot) makeNipunMove(match);
    });

    socket.on("undo", data => {
        const match = matches.find(m => m.id === data?.matchId);
        if (!match || !socket.seatInfo) return;
        if (socket.seatInfo.matchId !== match.id) return;

        if (match.isBot) {
            clearTimeout(match.botTimer);

            const historyLength = match.gameInstance.history().length;

            if (historyLength >= 2) {
                match.gameInstance.undo();
                match.gameInstance.undo();
            } else if (historyLength === 1) {
                match.gameInstance.undo();
            }
        } else {
            match.gameInstance.undo();
        }

        match.fen = match.gameInstance.fen();

        io.to(match.id).emit("undo", {
            matchId: match.id,
            fen: match.fen
        });
    });

    socket.on("reset", data => {
        const match = matches.find(m => m.id === data?.matchId);
        if (!match || !socket.seatInfo) return;
        if (socket.seatInfo.matchId !== match.id) return;

        clearTimeout(match.botTimer);
        match.gameInstance.reset();
        match.fen = match.gameInstance.fen();

        io.to(match.id).emit("reset", {
            matchId: match.id,
            fen: match.fen
        });
    });

    socket.on("chat-message", data => {
        if (!data?.matchId || !data?.text) return;

        const text = String(data.text).trim().slice(0, 500);
        const sender = String(data.sender || "Player").trim().slice(0, 40);

        if (!text) return;

        io.to(data.matchId).emit("chat-message", {
            matchId: data.matchId,
            sender,
            text
        });
    });

    socket.on("leave-match", id => {
        socket.leave(id);
        releaseSeat(socket);
    });

    socket.on("disconnect", () => {
        releaseSeat(socket);
        console.log("❌ Disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Ritik K Chess running on port ${PORT}`);
});
