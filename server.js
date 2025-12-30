const WebSocket = require('ws');
const db = require('./db'); // твой db.js
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const wss = new WebSocket.Server({ port: 8080 });
const games = {}; 
const roomStartTimers = {}; // roomId -> timeout
const DAY_DURATION = 20;   // секунды для дня
const NIGHT_DURATION = 30; // секунды для ночи
const PHASE_TICK_INTERVAL = 5000; // 5 секунд


//#region Authorization
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function findPlayerById(userId) {
    for (const roomId in games) {
        const game = games[roomId];
        if (!game || !game.players) continue;

        const player = game.players.find(p => p.user_id === userId);
        if (player) {
            
            player.roomId = roomId;
            return player;
        }
    }
    return null;
}

// Проверка токена
async function verifyToken(token) {
    const result = await db.query(
        'SELECT user_id FROM tokens WHERE token=$1 AND (expires_at IS NULL OR expires_at > NOW())',
        [token]
    );
    if (result.rows.length > 0) return result.rows[0].user_id;
    return null;
}

// Авто-продление токена на 15 минут
async function refreshToken(token) {
    const newExpiry = new Date(Date.now() + 15 * 60 * 1000); // +15 минут
    await db.query('UPDATE tokens SET expires_at=$1 WHERE token=$2', [newExpiry, token]);
}

// Регистрация нового игрока
async function registerUser(username, password) {
    const exists = await db.query('SELECT * FROM users WHERE username=$1', [username]);
    if (exists.rows.length > 0) return null; // ник занят

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.query(
        'INSERT INTO users(username, password, avatar_id, balance, experience) VALUES($1, $2, $3, $4, $5) RETURNING *',
        [username, hashedPassword, 1, 100, 0]
    );

    const token = generateToken();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // +15 минут
    await db.query('INSERT INTO tokens(user_id, token, expires_at) VALUES($1, $2, $3)', [result.rows[0].id, token, expires]);

    return { user: result.rows[0], token };
}

async function loginUser(username, password) {
    if (!username || !password) return null; // защита от пустых данных

    const userResult = await db.query('SELECT * FROM users WHERE username=$1', [username]);
    
    if (userResult.rows.length === 0) return null; // пользователь не найден

    const user = userResult.rows[0];
    
    if (!user.password) return null; // защита на случай пустого пароля

    const match = await bcrypt.compare(password, user.password);
    if (!match) return null; // неверный пароль

    // создаём токен
    const token = generateToken();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 минут
    await db.query('INSERT INTO tokens(user_id, token, expires_at) VALUES($1, $2, $3)', [user.id, token, expires]);

    return token;
}

async function getUserData(userId) {
    const result = await db.query(
        'SELECT username, balance, experience, level, avatar_id FROM users WHERE id = $1 LIMIT 1',
        [userId]
    );

    if (result.rows.length === 0) return null;
    
    return {
        username: result.rows[0].username,
        balance: result.rows[0].balance,
        experience: result.rows[0].experience,
        level: result.rows[0].level,
        avatar_id: result.rows[0].avatar_id
    };
}
//#endregion

//#region Room
async function clearOwnerRooms(userId) {
    // 1. Находим все комнаты, которые он создал
    const roomsRes = await db.query(
        `SELECT id FROM rooms WHERE created_by = $1`,
        [userId]
    );

    const roomIds = roomsRes.rows.map(r => r.id);

    if (roomIds.length > 0) {
        // 2. Удаляем игроков из этих комнат
        await db.query(
            `DELETE FROM room_players WHERE room_id = ANY($1::int[])`,
            [roomIds]
        );

        // 3. Удаляем сами комнаты
        await db.query(
            `DELETE FROM rooms WHERE id = ANY($1::int[])`,
            [roomIds]
        );

        // 4. Чистим память сервера
        roomIds.forEach(id => {
            delete games[id];
        });
    }

    // 5. Удаляем владельца из чужих комнат
    await db.query(
        `DELETE FROM room_players WHERE user_id = $1`,
        [userId]
    );
}

async function createRoom(userId, data) {
    await clearOwnerRooms(userId);
    
    let hashedPassword = null;
    if (data.password) {
        hashedPassword = await bcrypt.hash(data.password, 10);
    }

    const result = await db.query(
        `INSERT INTO rooms(name, password, min_players, max_players, level, roles, created_by, mafia_count) 
         VALUES($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [data.name, hashedPassword, data.min_players, data.max_players, data.level || 1, JSON.stringify(data.roles), userId, data.mafia_count]
    );
    const room = result.rows[0];

    // Автоматически присоединяем создателя
    const players = await joinedRoom(userId, room.id);
    room.players = players;

    return room;
}

async function joinRoom(userId, roomId, password) {
    
    // комната
    const roomRes = await db.query(
        `SELECT * FROM rooms WHERE id = $1`,
        [roomId]
    );
    if (roomRes.rows.length === 0)
        return { error: "Комната не найдена" };

    const room = roomRes.rows[0];

    if (room.password) {
    const match = await bcrypt.compare(password || '', room.password);
    if (!match) return { error: "Неверный пароль" };
}
    // уже в комнате?
    const existsRes = await db.query(
        `SELECT * FROM room_players WHERE room_id = $1 AND user_id = $2`,
        [roomId, userId]
    );

    if (existsRes.rows.length > 0)
        return { error: "Вы уже находитесь в этой комнате" };

    // записываем игрока
    await db.query(
        `INSERT INTO room_players (room_id, user_id, role, is_alive)
         VALUES ($1, $2, null, true)`,
        [roomId, userId]
    );

    // получаем список игроков
    const playersRes = await db.query(
        `SELECT rp.user_id as id, u.username, u.avatar_id
         FROM room_players rp
         JOIN users u ON u.id = rp.user_id
         WHERE rp.room_id = $1`,
        [roomId]
    );  

    return {
        room: {
            ...room,
            players: playersRes.rows
        }
    };
}

async function joinedRoom(userId, roomId, role = null) {
    // Проверяем, что игрок ещё не в комнате
    const exists = await db.query(
        'SELECT * FROM room_players WHERE room_id=$1 AND user_id=$2',
        [roomId, userId]
    );
    if (exists.rows.length > 0) return;

    // Добавляем игрока в комнату
    await db.query(
        'INSERT INTO room_players(room_id, user_id, role) VALUES($1, $2, $3)',
        [roomId, userId, role]
    );

    // Получаем обновлённый список игроков комнаты
    const playersRes = await db.query(
        'SELECT u.id, u.username, u.avatar_id FROM room_players rp JOIN users u ON rp.user_id = u.id WHERE rp.room_id=$1',
        [roomId]
    );

    return playersRes.rows;
}

async function leaveRoom(userId) {
    // 1. Находим комнату игрока
    const playerRes = await db.query(
    `SELECT id, username, avatar_id FROM users WHERE id = $1`,
    [userId]
);

    const leavingPlayer = playerRes.rows[0];

    const roomRes = await db.query(
        `SELECT r.id, r.created_by
         FROM room_players rp
         JOIN rooms r ON r.id = rp.room_id
         WHERE rp.user_id = $1`,
        [userId]
    );

    if (roomRes.rows.length === 0) return null;

    const { id: roomId, created_by } = roomRes.rows[0];

    // 2. Удаляем игрока из комнаты
    await db.query(
        `DELETE FROM room_players WHERE room_id=$1 AND user_id=$2`,
        [roomId, userId]
    );
    

    // 3. Сколько игроков осталось
    const countRes = await db.query(
        `SELECT COUNT(*) FROM room_players WHERE room_id=$1`,
        [roomId]
    );
    const playersLeft = Number(countRes.rows[0].count);

    // 4. Если игроков не осталось — УДАЛЯЕМ комнату
    if (playersLeft === 0) {

        // чистим игру из памяти
        if (games[roomId]) {
            clearTimeout(games[roomId].timer);
            delete games[roomId];
        }

        // чистим автозапуск
        if (roomStartTimers[roomId]) {
            clearTimeout(roomStartTimers[roomId]);
            delete roomStartTimers[roomId];
        }

        // удаляем комнату из БД
        await db.query(`DELETE FROM rooms WHERE id=$1`, [roomId]);

        return {
            roomId,
            leavingPlayer
        };
    }

    // 5. Если вышел владелец — передаём владельца
    if (created_by === userId) {
        const newOwnerRes = await db.query(
            `SELECT user_id FROM room_players WHERE room_id=$1 LIMIT 1`,
            [roomId]
        );

        if (newOwnerRes.rows.length > 0) {
            await db.query(
                `UPDATE rooms SET created_by=$1 WHERE id=$2`,
                [newOwnerRes.rows[0].user_id, roomId]
            );
        }
    }

    return {
        roomId,
        leavingPlayer
    };
}



async function sendRoomUpdate(roomId, enteringPlayer = null, leavingPlayer = null) {
    const playersRes = await db.query(
        `SELECT rp.user_id as id, u.username, u.avatar_id
         FROM room_players rp
         JOIN users u ON u.id = rp.user_id
         WHERE rp.room_id = $1`,
        [roomId]
    );

    broadcastToRoom(roomId, {
        type: "room_update",
        players: playersRes.rows,
        playerCount: playersRes.rows.length,
        player_enter: enteringPlayer,
        player_left: leavingPlayer // будет null или объект игрока
    });
}

//#endregion

//#region GameLogic
const DAY_VOTE_DURATION = 20; // секунды на дневное голосование
const DAY_RESULTS_DURATION = 5; // задержка для показа итогов

function startDayVoting(roomId) {
    const game = games[roomId];
    if (!game) return;
    game.votes.day = {};
    if (game.timer) clearTimeout(game.timer);

    game.phase = "vote";

    broadcastToRoom(roomId, {
        type: "phase_update",
        phase: "vote",
        duration: DAY_VOTE_DURATION
    });
    startPhaseTimer(roomId, "vote", DAY_VOTE_DURATION);


    game.timer = setTimeout(
        () => endDayVoting(roomId),
        DAY_VOTE_DURATION * 1000
    );
}

async function startDay(roomId) {
    const game = games[roomId];
    if (!game) return;

    game.dayBlocked = [];

    game.phase = "day";
    resetVotes(roomId); // сбрасываем голоса

    broadcastToRoom(roomId, {
        type: "phase_update",
        phase: "day",
        duration: DAY_DURATION
    });
    startPhaseTimer(roomId, "day", DAY_DURATION);

    // считаем stats
    const totalMafia = game.players.filter(p => p.role === "mafia").length;
    const totalPeaceful = game.players.length - totalMafia;
    const aliveMafia = game.players.filter(p => p.role === "mafia" && p.is_alive).length;
    const alivePeaceful = game.players.filter(p => p.role !== "mafia" && p.is_alive).length;

    // рассылаем игрокам список живых игроков
    game.players.forEach(p => {
        const ws = Array.from(wss.clients).find(c => c.readyState === 1 && c.userId === p.user_id);
        if (!ws) return;

        const alivePlayersList = game.players
            .filter(pl => pl.is_alive)
            .map(pl => ({
                user_id: pl.user_id,
                username: pl.username,
                avatar_id: pl.avatar_id,
                is_mafia: p.role === "mafia" && pl.role === "mafia"
            }));

            

        ws.send(JSON.stringify({
            type: "day_players_list",
            day: game.dayNumber,
            players: alivePlayersList,
            stats: {
                alive_peaceful: alivePeaceful,
                dead_peaceful: totalPeaceful-alivePeaceful,
                alive_mafia: aliveMafia,
                dead_mafia: totalMafia-aliveMafia
            }
        }));
    });

    if (game.dayNumber === 1) {
        // ❌ В первый день НЕТ голосования
        game.timer = setTimeout(() => startNight(roomId), DAY_DURATION * 1000);
    } else {
        // ✅ Остальные дни — с голосованием
        game.timer = setTimeout(() => startDayVoting(roomId), DAY_DURATION * 1000);
    }

}
async function checkAutoStart(roomId) {
    const roomRes = await db.query(`SELECT * FROM rooms WHERE id=$1`, [roomId]);
    if (roomRes.rows.length === 0) return;
    const room = roomRes.rows[0];

    // Игра уже началась — не нужно автозапускать
    if (room.game_started) return;

    const playersRes = await db.query(
        `SELECT COUNT(*) FROM room_players WHERE room_id=$1`,
        [roomId]
    );
    const count = Number(playersRes.rows[0].count);

    // Если игроков меньше минимума — отменяем таймер
    if (count < room.min_players) {
        if (roomStartTimers[roomId]) {
            clearTimeout(roomStartTimers[roomId]);
            delete roomStartTimers[roomId];

            broadcastToRoom(roomId, {
                type: "auto_start_cancelled"
            });
        }
        return;
    }

    // Если игроков достаточно и таймера нет — запускаем обратный отсчёт
    if (!roomStartTimers[roomId]) {
        broadcastToRoom(roomId, {
            type: "auto_start_timer",
            seconds: 15
        });

        roomStartTimers[roomId] = setTimeout(async () => {
            delete roomStartTimers[roomId];

            // На всякий случай — проверим снова количество игроков
            const playersRes2 = await db.query(
                `SELECT COUNT(*) FROM room_players WHERE room_id=$1`,
                [roomId]
            );
            const count2 = Number(playersRes2.rows[0].count);

            if (count2 >= room.min_players) {
                await tryStartGame(room.created_by);
            } else {
                broadcastToRoom(roomId, {
                    type: "auto_start_cancelled"
                });
            }

        }, 15000);
    }
}

function endDayVoting(roomId) {
    stopPhaseTimer(roomId);

    const game = games[roomId];
    if (!game) return;

    const voteMap = {};

    // считаем голоса только за живых
    Object.values(game.votes.day).forEach(v => {
    const tId = Number(v);
    const player = game.players.find(p => p.user_id === tId && p.is_alive);
    if (!player) return;
    voteMap[tId] = (voteMap[tId] || 0) + 1;
    });

    // формируем список живых игроков с голосами
    const playersWithVotes = game.players
        .filter(p => p.is_alive)
        .map(p => ({
            user_id: p.user_id,
            username: p.username,
            avatar_id: p.avatar_id,
            votes: voteMap[p.user_id] || 0
        }));

    // определяем, кто убит
    let maxVotes = 0;
    let candidates = [];
    for (const p of playersWithVotes) {
        if (p.votes > maxVotes) {
            maxVotes = p.votes;
            candidates = [p];
        } else if (p.votes === maxVotes) {
            candidates.push(p);
        }
    }

    let killedPlayer = null;
    if (candidates.length === 1 && maxVotes > 0) {
        const p = game.players.find(pl => pl.user_id === candidates[0].user_id);
        if (p) {
            p.is_alive = false;
            killedPlayer = {
                user_id: p.user_id,
                username: p.username,
                avatar_id: p.avatar_id,
                role: p.role   // ✅ РОЛЬ РАСКРЫТА
            };
        }
    }

    // 🆕 детальный список голосов
const detailedVotes = [];

for (const [fromUserId, targetUserId] of Object.entries(game.votes.day)) {
    const from = game.players.find(p => p.user_id === Number(fromUserId));
    const to   = game.players.find(p => p.user_id === Number(targetUserId));

    if (!from || !to) continue;
    if (!from.is_alive) continue;

    detailedVotes.push({
        from: {
            user_id: from.user_id,
            username: from.username,
            avatar_id: from.avatar_id
        },
        to: {
            user_id: to.user_id,
            username: to.username,
            avatar_id: to.avatar_id
        }
    });
}

    const totalMafia = game.players.filter(p => p.role === "mafia").length;
    const totalPeaceful = game.players.length - totalMafia;
    const aliveMafia = game.players.filter(p => p.role === "mafia" && p.is_alive).length;
    const alivePeaceful = game.players.filter(p => p.role !== "mafia" && p.is_alive).length;

    // рассылаем игрокам список живых игроков
    game.players.forEach(p => {
        const ws = Array.from(wss.clients).find(c => c.readyState === 1 && c.userId === p.user_id);
        if (!ws) return;

        const alivePlayersList = game.players
            .filter(pl => pl.is_alive)
            .map(pl => ({
                user_id: pl.user_id,
                username: pl.username,
                avatar_id: pl.avatar_id,
                is_mafia: p.role === "mafia" && pl.role === "mafia"
            }));

            

        ws.send(JSON.stringify({
            type: "day_players_list",
            day: game.dayNumber,
            players: alivePlayersList,
            stats: {
                alive_peaceful: alivePeaceful,
                dead_peaceful: totalPeaceful-alivePeaceful,
                alive_mafia: aliveMafia,
                dead_mafia: totalMafia-aliveMafia
            }
        }));
    });

    // рассылаем всем итог дневного голосования
    broadcastToRoom(roomId, {
        type: "day_end_summary",
        votes: detailedVotes,        // 🆕 кто за кого
        killed: killedPlayer
    });

    // очищаем дневные голоса
    game.votes.day = {};

    checkWinCondition(roomId);
    // через небольшую задержку запускаем ночь
    game.timer = setTimeout(() => startNight(roomId), DAY_RESULTS_DURATION * 1000);
}

async function startNight(roomId) {
    resetVotes(roomId);
    const game = games[roomId];
    if (!game) return;

    game.phase = "night";

    // Обновляем фазу в БД
    await db.query(`UPDATE rooms SET phase='night' WHERE id=$1`, [roomId]);

    // Всем игрокам рассылаем, что началась ночь
    broadcastToRoom(roomId, {
        type: "phase_update",
        phase: "night",
        duration: NIGHT_DURATION
    });
    startPhaseTimer(roomId, "night", NIGHT_DURATION);


    // Отправляем ночное действие только игрокам с активной ролью ночью
    const nightActors = game.players.filter(p =>
    ["mafia", "doctor", "sherif", "lover", "bodyguard", "sniper", "priest"].includes(p.role) && p.is_alive
);
    nightActors.forEach(p => {
        const ws = Array.from(wss.clients).find(c => c.readyState === WebSocket.OPEN && c.userId === p.user_id);
        if (!ws) return;

        // Формируем список игроков для действия ночью
        const playersList = game.players
            .filter(pl => pl.is_alive)
            .map(pl => ({
                user_id: pl.user_id,
                username: pl.username,
                avatar_id: pl.avatar_id,
                // Если текущий игрок — мафия, отмечаем других мафий
                is_mafia: p.role === "mafia" && pl.role === "mafia"
            }));

        ws.send(JSON.stringify({
            type: "night_action_start",
            role: p.role,
            duration: NIGHT_DURATION,
            players: playersList
        }));
    });

    // Таймер ночи
    game.timer = setTimeout(() => endNight(roomId), NIGHT_DURATION * 1000);
}


async function tryStartGame(userId) {
    // 1. Получаем комнату игрока
    const roomRes = await db.query(
        `SELECT r.* 
         FROM room_players rp 
         JOIN rooms r ON r.id = rp.room_id 
         WHERE rp.user_id = $1 
         LIMIT 1`,
        [userId]
    );

    if (roomRes.rows.length === 0) return { error: "Вы не в комнате" };
    const room = roomRes.rows[0];

    if (room.created_by !== userId) return { error: "Только владелец комнаты может начать игру" };
    if (room.game_started) return { error: "Игра уже началась" };

    // 2. Получаем всех игроков комнаты
    const playersRes = await db.query(
        'SELECT user_id FROM room_players WHERE room_id=$1',
        [room.id]
    );
    const players = playersRes.rows;

    if (players.length < room.min_players)
        return { error: `Не хватает игроков (${players.length}/${room.min_players})` };

    // 3. Назначаем роли
    const assignedRoles = await assignRoles(room.id, room.roles, room.mafia_count, players);

    // 4. Обновляем статус комнаты
    await db.query(
        `UPDATE rooms SET game_started=TRUE, phase='day' WHERE id=$1`,
        [room.id]
    );

    // 5. Создаём объект игры с игроками и их ролями
    games[room.id] = {
        phase: "day",
        timer: null,
        dayNumber: 1,
        players: assignedRoles.map(p => ({
            user_id: p.user_id,
            username: p.username,
            avatar_id: p.avatar_id,
            role: p.role,
            is_alive: true,
            lastDoctorHealSelf: false,
            lastLoverTarget: null,
            hasShot: false        // снайпер
        })),
        votes: {
            day: {},
            mafia: {},
            doctor: {},
            sherif: {},
            lover: {},
            bodyguard: {},
            priest: {},
            sniper: {}
        }

    };

    startDay(room.id);

    return { success: true };
}

function validateVote(game, voter, targetId, voteType) {
    targetId = Number(targetId);
    if (Number.isNaN(targetId)) return "Неверная цель";

    // 1. Игрок жив?
    if (!voter.is_alive) {
        return "Вы мертвы и не можете голосовать";
    }

    // 2. Цель существует и жива?
    const target = game.players.find(p => p.user_id === targetId);
    if (!target || !target.is_alive) {
        return "Нельзя голосовать за мертвого игрока";
    }

    // 3. Фазы
    if (voteType === "day" && game.phase !== "vote") {
        return "Сейчас не фаза голосования";
    }
    if (voteType !== "day" && game.phase !== "night") {
        return "Сейчас не ночь";
    }

    // 4. Нельзя менять голос
    if (game.votes[voteType]?.[voter.user_id]) {
        return "Вы уже проголосовали";
    }

    // ===============================
    // 🔥 ИСКЛЮЧЕНИЯ ПО РОЛЯМ
    // ===============================

    // 🩺 ДОКТОР
    if (voteType === "doctor") {

        // нельзя лечить себя два раза подряд
        if (voter.user_id === targetId && voter.lastDoctorHealSelf) {
            return "Нельзя лечить себя две ночи подряд";
        }

        return null; // ✅ доктору разрешено лечить себя
    }
    if (voteType === "lover" && voter.user_id === targetId) {
    return "Любовница не может выбрать себя";
    }
    if (voteType === "lover" && voter.lastLoverTarget === targetId) {
        return "Нельзя блокировать одного и того же игрока две ночи подряд";
    }
    if (voteType === "bodyguard" && voter.user_id === targetId) {
    return "Телохранитель не может охранять себя";
    }
    if (voteType === "sniper" && voter.hasShot) {
        return "Вы уже использовали выстрел";
    }



    // ===============================
    // ❌ ОБЩИЕ ЗАПРЕТЫ
    // ===============================

    // нельзя голосовать за себя (для всех КРОМЕ доктора)
    if (voter.user_id === targetId) {
        return "Нельзя голосовать за себя";
    }

    // 🧨 мафия не может убивать мафию
    if (voteType === "mafia" && voter.role === "mafia" && target.role === "mafia") {
        return "Мафия не может голосовать за мафию";
    }

    // 🕵️ шериф не проверяет себя
    if (voteType === "sherif" && voter.user_id === targetId) {
        return "Шериф не может проверять себя";
    }

    return null; // ✅ всё ок
}

function registerVote(roomId, voteType, fromUserId, targetId, ws = null) {
    fromUserId = Number(fromUserId);
    targetId = Number(targetId);
    const game = games[roomId];
    if (!game) return;

    if (Number.isNaN(fromUserId) || Number.isNaN(targetId)) {
        if (ws) ws.send(JSON.stringify({ type: "vote_failed", message: "Неверная цель" }));
        return;
    }

    const voter = game.players.find(p => p.user_id === fromUserId);
    if (!voter) return;

    const error = validateVote(game, voter, targetId, voteType);

    if (error) {
        if (ws) {
            ws.send(JSON.stringify({
                type: "vote_failed",
                message: error
            }));
        }
        return;
    }

    // сохраняем число (не строку)
    game.votes[voteType][fromUserId] = targetId;
    broadcastVoteState(roomId, voteType);
}



function broadcastVoteState(roomId, voteType) {
    const game = games[roomId];
    if (!game || !game.votes[voteType]) return;

    const votesMap = {};

    // считаем голоса
    Object.values(game.votes[voteType]).forEach(targetId => {
        votesMap[targetId] = (votesMap[targetId] || 0) + 1;
    });

    game.players.forEach(receiver => {
        const ws = [...wss.clients]
            .find(c => c.readyState === 1 && c.userId === receiver.user_id);
        if (!ws) return;

        // ограничения по ролям
        if (voteType === "mafia" && receiver.role !== "mafia") return;
        if (voteType === "doctor" && receiver.role !== "doctor") return;
        if (voteType === "sherif" && receiver.role !== "sherif") return;
        if (voteType === "lover" && receiver.role !== "lover") return;
        if (voteType === "bodyguard" && receiver.role !== "bodyguard") return;
        if (voteType === "sniper" && receiver.role !== "sniper") return;
        if (voteType === "priest" && receiver.role !== "priest") return;

        // 🔑 персональный список
        const playersWithVotes = game.players
            .filter(p => p.is_alive)
            .map(p => ({
                user_id: p.user_id,
                username: p.username,
                avatar_id: p.avatar_id,
                votes: votesMap[p.user_id] || 0,
                is_mafia:
                    receiver.role === "mafia" && p.role === "mafia"
            }));

        ws.send(JSON.stringify({
            type: "vote_state_update",
            voteType,
            players: playersWithVotes
        }));
    });
}


function handleNightAction(userId, targetId) {
    const player = findPlayerById(userId);
    if (!player) return;

    const game = games[player.roomId];
    if (!game || game.phase !== "night") return;
    if (!player.is_alive) return;

    let voteType = null;    

    if (player.role === "mafia") voteType = "mafia";
    if (player.role === "doctor") voteType = "doctor";
    if (player.role === "sherif") voteType = "sherif";
    if (player.role === "lover") voteType = "lover";
    if (player.role === "bodyguard") voteType = "bodyguard";
    if (player.role === "sniper") voteType = "sniper";
    if (player.role === "priest") voteType = "priest";


    if (!voteType) return;


    const ws = [...wss.clients].find(c => c.userId === userId);
    registerVote(player.roomId, voteType, userId, targetId, ws);
}

function startPhaseTimer(roomId, phase, durationSeconds) {
    const game = games[roomId];
    if (!game) return;

    // очищаем старый тикер
    if (game.phaseTicker) {
        clearInterval(game.phaseTicker);
        game.phaseTicker = null;
    }

    game.phaseEndsAt = Date.now() + durationSeconds * 1000;

    // сразу отправляем первый тик
    sendPhaseTick(roomId, phase);

    game.phaseTicker = setInterval(() => {
        sendPhaseTick(roomId, phase);
    }, PHASE_TICK_INTERVAL);
}

function stopPhaseTimer(roomId) {
    const game = games[roomId];
    if (!game) return;

    if (game.phaseTicker) {
        clearInterval(game.phaseTicker);
        game.phaseTicker = null;
    }
}

function sendPhaseTick(roomId, phase) {
    const game = games[roomId];
    if (!game || !game.phaseEndsAt) return;

    const secondsLeft = Math.max(
        0,
        Math.ceil((game.phaseEndsAt - Date.now()) / 1000)
    );

    broadcastToRoom(roomId, {
        type: "phase_timer",
        phase,
        seconds_left: secondsLeft
    });
}

// Функция назначения ролей
// players — это массив объектов { user_id, username, avatar_id } из базы
async function assignRoles(roomId, rolesArray, mafiaCount, players) {
    // Перемешиваем игроков
    const shuffled = [...players].sort(() => Math.random() - 0.5);

    const assigned = {}; // userId -> role

    // Назначаем мафию
    const mafiaPlayers = shuffled.slice(0, mafiaCount);
    mafiaPlayers.forEach(p => assigned[p.user_id] = "mafia");

    // Остальные — мирные
    const civilians = shuffled.slice(mafiaCount);
    const shuffledRoles = [...rolesArray].sort(() => Math.random() - 0.5);

    for (let i = 0; i < civilians.length; i++) {
        assigned[civilians[i].user_id] = i < shuffledRoles.length ? shuffledRoles[i] : "citizen";
    }

    const playerData = [];

    for (const p of players) {
        // Сохраняем роль и статус живого в БД
        await db.query(
            `UPDATE room_players SET role=$1, is_alive=TRUE WHERE room_id=$2 AND user_id=$3`,
            [assigned[p.user_id], roomId, p.user_id]
        );

        // Получаем username и avatar_id
        const userRes = await db.query(
            `SELECT username, avatar_id FROM users WHERE id=$1`,
            [p.user_id]
        );

        playerData.push({
            user_id: p.user_id,
            username: userRes.rows[0].username,  // теперь точно есть
            avatar_id: userRes.rows[0].avatar_id,
            role: assigned[p.user_id],
            is_alive: true
        });
    }

    // Отправка каждому игроку его роли
    const mafiaList = mafiaPlayers.map(p => p.user_id);

    for (const p of playerData) {
        const ws = Array.from(wss.clients).find(c => c.readyState === WebSocket.OPEN && c.userId === p.user_id);
        if (!ws) continue;

        const payload = { type: "your_role", role: p.role };
        if (p.role === "mafia") payload.mafiaList = mafiaList;

        ws.send(JSON.stringify(payload));
    }

    return playerData; // теперь в game.players будут все поля
}


function endNight(roomId) {
    stopPhaseTimer(roomId);

    const game = games[roomId];
    if (!game) return;

    // ===============================
    // Собираем ночные цели
    // ===============================
    const loverTargetId     = Number(Object.values(game.votes.lover)[0]) || null;
    const bodyguardTargetId = Number(Object.values(game.votes.bodyguard)[0]) || null;
    const doctorTargetId    = Number(Object.values(game.votes.doctor)[0]) || null;
    const sniperTargetId    = Number(Object.values(game.votes.sniper)[0]) || null;
    const priestBlocked     = Object.values(game.votes.priest || {}).map(v => Number(v));
    const mafiaVotes        = game.votes.mafia;
    const sherifVotes       = game.votes.sherif;

    const deaths = [];

    const isPlayerBlocked = (player) =>
        !!(loverTargetId && player && player.user_id === loverTargetId);

    // Переменные для фиксации атак (используются при проверке доктора)
    let mafiaAttackTargetId = null;
    let sniperAttackTargetId = null;

    // ===============================
    // СНАЙПЕР
    // ===============================
    if (sniperTargetId) {
        const sniper = game.players.find(p => p.role === "sniper" && p.is_alive);
        const target = game.players.find(p => p.user_id === sniperTargetId && p.is_alive);

        if (sniper && target && !sniper.hasShot && !isPlayerBlocked(sniper)) {
            sniper.hasShot = true;
            sniperAttackTargetId = target.user_id;

            const doctor = game.players.find(p => p.role === "doctor" && p.is_alive);

            // Телохранитель — ищем только если цель есть
            const guard = game.players.find(
                p => p.role === "bodyguard" && p.is_alive && bodyguardTargetId === target.user_id
            );

            if (guard) {
                // если телохранитель стоял на цели — он погибает, снайпер тоже
                guard.is_alive = false;
                deaths.push({ user_id: guard.user_id, username: guard.username, avatar_id: guard.avatar_id, role: guard.role });

                sniper.is_alive = false;
                deaths.push({ user_id: sniper.user_id, username: sniper.username, avatar_id: sniper.avatar_id, role: sniper.role });
            }
            else if (doctor && doctorTargetId === target.user_id && !isPlayerBlocked(doctor)) {
                // доктор спас — ничего не добавляем в deaths
            }
            else {
                // цель умирает
                target.is_alive = false;
                deaths.push({ user_id: target.user_id, username: target.username, avatar_id: target.avatar_id, role: target.role });

                // если цель не мафия — снайпер рискует умереть
                if (target.role !== "mafia") {
                    sniper.is_alive = false;
                    deaths.push({ user_id: sniper.user_id, username: sniper.username, avatar_id: sniper.avatar_id, role: sniper.role });
                }
            }
        }
    }

    // ===============================
    // МАФИЯ
    // ===============================
    const mafiaCanKill = game.players.some(p => p.role === "mafia" && p.is_alive && !isPlayerBlocked(p));

    if (mafiaCanKill) {
        const killMap = {};
        Object.entries(mafiaVotes).forEach(([fromId, targetId]) => {
            const mafiaPlayer = game.players.find(p => p.user_id === Number(fromId) && p.role === "mafia" && p.is_alive);
            if (!mafiaPlayer || isPlayerBlocked(mafiaPlayer)) return;
            const tId = Number(targetId);
            killMap[tId] = (killMap[tId] || 0) + 1;
        });

        let maxVotes = 0;
        for (const id in killMap) {
            if (killMap[id] > maxVotes) {
                maxVotes = killMap[id];
                mafiaAttackTargetId = Number(id);
            }
        }

        if (mafiaAttackTargetId) {
            const target = game.players.find(p => p.user_id === mafiaAttackTargetId && p.is_alive);
            if (target) {
                const guard = game.players.find(p => p.role === "bodyguard" && p.is_alive && bodyguardTargetId === target.user_id);
                const doctor = game.players.find(p => p.role === "doctor" && p.is_alive);

                if (guard) {
                    // телохранитель умирает вместо цели
                    guard.is_alive = false;
                    deaths.push({ user_id: guard.user_id, username: guard.username, avatar_id: guard.avatar_id, role: guard.role });
                }
                else if (doctor && doctorTargetId === target.user_id && !isPlayerBlocked(doctor)) {
                    // доктор спас — ничего не добавляем
                }
                else {
                    target.is_alive = false;
                    deaths.push({ user_id: target.user_id, username: target.username, avatar_id: target.avatar_id, role: target.role });
                }
            }
        }
    }

    // ===============================
    // ШЕРИФ
    // ===============================
    const sherifTargetId = Number(Object.values(sherifVotes)[0]) || null;
    if (sherifTargetId) {
        const sherif = game.players.find(p => p.role === "sherif" && p.is_alive);
        const target = game.players.find(p => p.user_id === sherifTargetId);
        if (sherif && target && !isPlayerBlocked(sherif)) {
            const ws = [...wss.clients].find(c => c.userId === sherif.user_id);
            if (ws) {
                ws.send(JSON.stringify({
                    type: "sherif_result",
                    target: { user_id: target.user_id, username: target.username, avatar_id: target.avatar_id, role: target.role }
                }));
            }
        }
    }

    // ===============================
    // Любовница и священник
    // ===============================
    const lover = game.players.find(p => p.role === "lover" && p.is_alive);
    if (lover) lover.lastLoverTarget = loverTargetId;
    game.dayBlocked = priestBlocked;

    // ===============================
    // Доктор — учитываем только УСПЕШНОЕ лечение
    // ===============================
    const doctor = game.players.find(p => p.role === "doctor" && p.is_alive);
    let healedPlayerId = null;

    if (
        doctor &&
        doctorTargetId &&
        !isPlayerBlocked(doctor) &&
        (
            mafiaAttackTargetId === doctorTargetId ||
            sniperAttackTargetId === doctorTargetId
        ) &&
        deaths.every(d => d.user_id !== doctorTargetId)
    ) {
        healedPlayerId = doctorTargetId;
    }

    if (doctor) {
        doctor.lastDoctorHealSelf = (doctorTargetId === doctor.user_id);
    }
    
    let blockedPlayer = null;

    if (loverTargetId) {
        const p = game.players.find(pl => pl.user_id === loverTargetId);
        if (p) {
            blockedPlayer = {
                user_id: p.user_id,
                username: p.username,
                avatar_id: p.avatar_id
            };
        }
    }

    let healedPlayer = null;

if (healedPlayerId) {
    const p = game.players.find(pl => pl.user_id === healedPlayerId);
    if (p) {
        healedPlayer = {
            user_id: p.user_id,
            username: p.username,
            avatar_id: p.avatar_id
            // role НЕ добавляем — лечение не раскрывает роль
        };
    }
}
    // ===============================
    // Итог ночи — рассылка
    // ===============================
    broadcastToRoom(roomId, {
        type: "night_end_summary",
        deaths,                 // кто реально умер
        healed: healedPlayer, // id или null
        blocked: blockedPlayer  // id или null
    });

    resetVotes(roomId);
    checkWinCondition(roomId);

    game.dayNumber++;
    setTimeout(() => startDay(roomId), 4000);
}




function handleDayVote(userId, targetId) {
    const player = findPlayerById(userId);
    if (!player) return;

    const game = games[player.roomId];
    if (!game || game.phase !== "vote") return;
    if (!player.is_alive) return;
    
    if (game.dayBlocked?.includes(userId)) {
    const ws = [...wss.clients].find(c => c.userId === userId);
    if (ws) {
        ws.send(JSON.stringify({
            type: "vote_failed",
            message: "Вы лишены права голоса"
        }));
    }
    return;
}

    const target = game.players.find(
        p => p.user_id === targetId && p.is_alive
    );
    if (!target) return;

    const ws = [...wss.clients].find(c => c.userId === userId);
    registerVote(player.roomId, "day", userId, targetId, ws);
}


function broadcastToRoom(roomId, message) {
    const msg = JSON.stringify(message);

    wss.clients.forEach(client => {
        if (client.readyState === 1 && client.roomId === roomId) {
            client.send(msg);
        }
    });
}
function resetVotes(roomId) {
    if (!games[roomId]) return;
    games[roomId].votes = {
        day: {},
        mafia: {},
        doctor: {},
        sherif: {},
        lover: {},
        bodyguard: {},
        priest: {},
        sniper: {}
    };
}

function checkWinCondition(roomId) {
    const game = games[roomId];
    if (!game) return;

    const alive = game.players.filter(p => p.is_alive);
    const aliveMafia = alive.filter(p => p.role === "mafia").length;
    const alivePeaceful = alive.length - aliveMafia;

    let winner = null;

    // ✅ Победа мафии
    if (aliveMafia >= alivePeaceful && aliveMafia > 0) {
        winner = "mafia";
    }

    // ✅ Победа мирных
    if (aliveMafia === 0 && alive.length > 0) {
        winner = "peaceful";
    }

    if (!winner) return; // игра продолжается

    // ✅ Отправляем всем результат
    broadcastToRoom(roomId, {
        type: "game_over",
        winner, // "mafia" или "peaceful"
        players: game.players.map(p => ({
            user_id: p.user_id,
            username: p.username,
            avatar_id: p.avatar_id,
            role: p.role,
            is_alive: p.is_alive
        }))
    });

    // ✅ Завершаем игру
    finishGame(roomId);
}
async function finishGame(roomId) {
    stopPhaseTimer(roomId);

    const game = games[roomId];
    if (!game) return;

    clearTimeout(game.timer);

    // ✅ Сбрасываем комнату в БД
    await db.query(
        `UPDATE rooms SET game_started=FALSE, phase='lobby' WHERE id=$1`,
        [roomId]
    );

    // ✅ Сбрасываем игроков
    await db.query(
        `UPDATE room_players SET role=NULL, is_alive=TRUE WHERE room_id=$1`,
        [roomId]
    );

    // ✅ Полностью удаляем игру из памяти
    delete games[roomId];
}
async function restoreGameState(ws) {
    if (!ws.roomId) return;

    const roomId = ws.roomId;
    const game = games[roomId];

    // ===============================
    // 🏠 ЛОББИ (игра не началась)
    // ===============================
    if (!game) {
        const playersRes = await db.query(
            `
            SELECT rp.user_id AS id, u.username, u.avatar_id
            FROM room_players rp
            JOIN users u ON u.id = rp.user_id
            WHERE rp.room_id = $1
            `,
            [roomId]
        );

        ws.send(JSON.stringify({
            type: "room_update",
            players: playersRes.rows,
            playerCount: playersRes.rows.length,
            player_enter: null,
            player_left: null
        }));

        return;
    }

    // ===============================
    // 🎮 ИГРА ИДЁТ
    // ===============================
    const player = game.players.find(p => p.user_id === ws.userId);
    if (!player) return;

    // 1️⃣ Отправляем роль
    const rolePayload = { type: "your_role", role: player.role };
    if (player.role === "mafia") {
        rolePayload.mafiaList = game.players
            .filter(p => p.role === "mafia")
            .map(p => p.user_id);
    }
    ws.send(JSON.stringify(rolePayload));

    // 2️⃣ Текущая фаза
    ws.send(JSON.stringify({
        type: "phase_update",
        phase: game.phase,
        duration:
            game.phase === "night" ? NIGHT_DURATION :
            game.phase === "vote"  ? DAY_VOTE_DURATION :
            DAY_DURATION
    }));

    // 3️⃣ Список живых игроков + статы
    const totalMafia = game.players.filter(p => p.role === "mafia").length;
    const totalPeaceful = game.players.length - totalMafia;
    const aliveMafia = game.players.filter(p => p.role === "mafia" && p.is_alive).length;
    const alivePeaceful = game.players.filter(p => p.role !== "mafia" && p.is_alive).length;

    ws.send(JSON.stringify({
        type: "day_players_list",
        day: game.dayNumber,
        players: game.players
            .filter(p => p.is_alive)
            .map(p => ({
                user_id: p.user_id,
                username: p.username,
                avatar_id: p.avatar_id,
                is_mafia: player.role === "mafia" && p.role === "mafia"
            })),
        stats: {
            alive_peaceful: alivePeaceful,
            dead_peaceful: totalPeaceful - alivePeaceful,
            alive_mafia: aliveMafia,
            dead_mafia: totalMafia - aliveMafia
        }
    }));

    // 4️⃣ Если ночь — снова отправляем night_action_start
    if (game.phase === "night") {
        if (
            ["mafia", "doctor", "sherif", "lover", "bodyguard", "sniper", "priest"]
                .includes(player.role) &&
            player.is_alive
        ) {
            ws.send(JSON.stringify({
                type: "night_action_start",
                role: player.role,
                duration: NIGHT_DURATION,
                players: game.players
                    .filter(p => p.is_alive)
                    .map(p => ({
                        user_id: p.user_id,
                        username: p.username,
                        avatar_id: p.avatar_id,
                        is_mafia: player.role === "mafia" && p.role === "mafia"
                    }))
            }));
        }
    }
    sendPhaseTick(ws.roomId, game.phase);
}


//#endregion


// Очистка просроченных токенов каждые 5 минут
setInterval(async () => {
    await db.query('DELETE FROM tokens WHERE expires_at < NOW()');
    // console.log('Просроченные токены удалены');
}, 5 * 60 * 1000);

wss.on('connection', ws => {
    console.log('Новый клиент подключился');
        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });
    ws.on('message', async message => {
        try {
            const data = JSON.parse(message.toString());
            // console.log('Разобранный JSON:', data);
            // 🔐 Проверка токена СРАЗУ
            if (!['login', 'register', 'auth'].includes(data.type)) {
                const userId = await verifyToken(data.token);
                if (!userId) {
                    ws.send(JSON.stringify({ type: 'auth_failed' }));
                    return ws.close();
                }
                ws.userId = userId;
                await refreshToken(data.token);
            }

            // Регистрация
            if (data.type === 'register') {
                const res = await registerUser(data.username, data.password);
                if (res) ws.send(JSON.stringify({ type: 'register_success', token: res.token, userId: res.user.id }));
                else ws.send(JSON.stringify({ type: 'register_failed', message: 'Ник занят' }));
            }
            // Логин
            if (data.type === 'login') {
                try {
                    const token = await loginUser(data.username, data.password);
                    if (token) {
                        ws.send(JSON.stringify({ type: 'login_success', token }));
                    } else {
                        ws.send(JSON.stringify({ type: 'login_failed', message: 'Неверный ник или пароль' }));
                    }
                } catch (e) {
                    console.error('Ошибка при логине:', e);
                    ws.send(JSON.stringify({ type: 'login_failed', message: 'Ошибка сервера при логине' }));
                }
            }   
            // Авторизация
            if (data.type === 'auth') {
                const userId = await verifyToken(data.token);
                if (!userId) {
                    ws.send(JSON.stringify({ type: 'auth_failed' }));
                    ws.close();
                    return;
                }

                ws.userId = userId;
                ws.token = data.token;

                const userData = await getUserData(userId);
                ws.username = userData.username;
                ws.userData = userData;

                // 1️⃣ базовая авторизация
                ws.send(JSON.stringify({
                    type: 'auth_success',
                    userId,
                    userData
                }));

                // 2️⃣ если игрок состоит в комнате — отправляем ПОЛНУЮ ИНФУ О КОМНАТЕ
                    const roomInfoRes = await db.query(
                    `
                    SELECT
                        r.id,
                        r.name,
                        r.password,
                        r.min_players,
                        r.max_players,
                        r.level,
                        r.roles,
                        r.created_by,
                        r.created_at,
                        r.phase,
                        r.game_started,
                        r.mafia_count,
                        COUNT(rp.user_id)::int AS alive_count
                    FROM room_players rp
                    JOIN rooms r ON r.id = rp.room_id
                    WHERE rp.user_id = $1
                    GROUP BY r.id
                    LIMIT 1
                    `,
                    [userId]
                    );

                    if (roomInfoRes.rows.length > 0) {
                        const room = roomInfoRes.rows[0];

                        ws.roomId = room.id;

                        // получаем игроков комнаты
                        const playersRes = await db.query(
                            `
                            SELECT
                                u.id,
                                u.username,
                                u.avatar_id
                            FROM room_players rp
                            JOIN users u ON u.id = rp.user_id
                            WHERE rp.room_id = $1
                            `,
                            [room.id]
                        );

                        ws.send(JSON.stringify({
                            type: "room_info",
                            room: {
                                id: room.id,
                                name: room.name,
                                password: null, // ❗ никогда не отправляем хеш
                                min_players: room.min_players,
                                max_players: room.max_players,
                                level: room.level,
                                roles: room.roles,
                                created_by: room.created_by,
                                created_at: room.created_at,
                                phase: room.phase,
                                game_started: room.game_started,
                                mafia_count: room.mafia_count,
                                alive_count: room.alive_count,
                                players: playersRes.rows
                            }
                        }));

                        // 3️⃣ восстановление состояния (лобби или игра)
                        await restoreGameState(ws);
                    }


                // 4️⃣ продление токена
                await refreshToken(data.token);
                console.log('Игрок авторизован и токен продлён:', userId);
            }

            // Получение списка комнат
            if (data.type === 'get_rooms') {
                try {
                    const roomsRes = await db.query(
                        `SELECT r.id, r.name, r.level, r.min_players, r.max_players, r.roles, COUNT(rp.user_id)::int as current_players
                        FROM rooms r
                        LEFT JOIN room_players rp ON r.id = rp.room_id
                        GROUP BY r.id`
                    );

                    ws.send(JSON.stringify({ type: 'get_rooms_success', rooms: roomsRes.rows }));
                } catch (e) {
                    console.error(e);
                    ws.send(JSON.stringify({ type: 'get_rooms_failed', message: 'Ошибка сервера' }));
                }
            }
            if (data.type === 'create_room') {
                try {
                    const {
                        name,
                        min_players,
                        max_players,
                        mafia_count,
                        roles
                    } = data;

                    // --- Проверка минимального количества игроков ---
                    if (min_players < 5) {
                        return ws.send(JSON.stringify({
                            type: 'create_room_failed',
                            message: 'Минимальное количество игроков должно быть не меньше 5'
                        }));
                    }

                    // --- Проверка что max >= min ---
                    if (max_players < min_players) {
                        return ws.send(JSON.stringify({
                            type: 'create_room_failed',
                            message: 'Максимальное количество игроков не может быть меньше минимального'
                        }));
                    }

                    // --- Проверка количества ролей ---
                    const peacefulCount = max_players - mafia_count;
                    if (roles.length > peacefulCount) {
                        return ws.send(JSON.stringify({
                            type: 'create_room_failed',
                            message: `Слишком много мирных ролей. Доступно максимум: ${peacefulCount}`
                        }));
                    }

                    // --- Создаём комнату ---
                    const room = await createRoom(ws.userId, data);

                    ws.roomId = room.id;

                    // --- Ответ создателю ---
                    ws.send(JSON.stringify({
                        type: 'create_room_success',
                        room
                    }));

                    // ✅ ROOM UPDATE (КАК ПРИ JOIN)
                    await sendRoomUpdate(
                        room.id,
                        {
                            user_id: ws.userId,
                            username: ws.userData.username,
                            avatar_id: ws.userData.avatar_id
                        },
                        null
                    );

                    // --- Проверка автозапуска ---
                    checkAutoStart(room.id);

                } catch (e) {
                    console.error(e);
                    ws.send(JSON.stringify({
                        type: 'create_room_failed',
                        message: 'Ошибка сервера'
                    }));
                }
            }

            // Вход в комнату
            if (data.type === 'join_room') {
            try {
                const res = await joinRoom(ws.userId, data.roomId, data.password);

                if (res.error) {
                    ws.send(JSON.stringify({
                        type: 'join_room_failed',
                        message: res.error
                    }));
                } else {
                    ws.roomId = data.roomId;

                    ws.send(JSON.stringify({
                        type: 'join_room_success',
                        room: res.room
                    }));

                    // отправляем всем обновлённый список игроков
                    
                    await sendRoomUpdate(data.roomId, 
                        {
                        user_id: ws.userId,
                        username: ws.userData.username,
                        avatar_id: ws.userData.avatar_id
                        }
                    );
                    checkAutoStart(data.roomId);
                }

                } catch (e) {
                    console.error(e);
                    ws.send(JSON.stringify({
                        type: 'join_room_failed',
                        message: 'Ошибка сервера'
                    }));
                }
            }
            // Выход из комнаты
            if (data.type === 'leave_room') {
                try {
                    const result = await leaveRoom(ws.userId);

                    if (result?.roomId) {
                        await sendRoomUpdate(
                            result.roomId,
                            null,
                            result.leavingPlayer
                        );
                        checkAutoStart(result.roomId);
                    }

                    ws.send(JSON.stringify({
                        type: 'leave_room_success'
                    }));


                    ws.roomId = null;
                } catch (e) {
                    console.error(e);
                    ws.send(JSON.stringify({
                        type: 'leave_room_failed',
                        message: 'Ошибка сервера'
                    }));
                }
            }

            
            if (data.type === 'start_game') {
                try {
                    const result = await tryStartGame(ws.userId);
                    if (result.error) {
                        ws.send(JSON.stringify({ type: 'start_game_failed', message: result.error }));
                    } else {
                        ws.send(JSON.stringify({ type: 'start_game_success' }));
                    }
                } catch (e) {
                    console.error(e);
                    ws.send(JSON.stringify({ type: 'start_game_failed', message: "Ошибка сервера" }));
                }
            }
            if (data.type === 'night_action') {
                handleNightAction(ws.userId, data.targetId);
            }
            if (data.type === "day_vote") {
                handleDayVote(ws.userId, data.targetId);
            }
            if (data.type === "send_chat") {

                // Проверка: у клиента должен быть roomId (он должен быть в комнате)
                if (!ws.roomId) {
                    return;
                }

                const roomId = ws.roomId;
                const game = games[roomId];

                // Если игры нет — это лобби. Рассылаем всем клиентам с client.roomId === roomId
                if (!game) {
                    // Дополнительно можно проверить, что пользователь действительно есть в room_players в БД,
                    // но предположим, что ws.roomId выставлен при join_room и это достаточно.
                    const now = new Date();
                    const msg = {
                        type: "chat_message",
                        user_id: ws.userId,
                        username: ws.username || "Player",
                        avatar_id: ws.avatar_id || 1,
                        text: data.text,
                        time: now.toTimeString().slice(0,5),
                    };

                    // Рассылаем всем подключенным клиентам в той же комнате (лобби)
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
                            try { client.send(JSON.stringify(msg)); }
                            catch (e) {  }
                        }
                    });

                    return;
                }

                // Если игра есть — проверяем игрока внутри game
                const player = game.players.find(p => p.user_id === ws.userId);
                if (!player) {
                    return;
                }

                if (!player.is_alive) {
                    return;
                }

                if (game.phase === "night" && player.role !== "mafia") {
                    return;
                }

                const now = new Date();
                const msg = {
                    type: "chat_message",
                    user_id: ws.userId,
                    username: player.username,
                    avatar_id: player.avatar_id,
                    text: data.text,
                    time: now.toTimeString().slice(0,5),
                };

                const targets = game.phase === "night"
                    ? game.players.filter(p => p.is_alive && p.role === "mafia")
                    : game.players.filter(p => p.is_alive);

                targets.forEach(p => {
                    const clientWs = [...wss.clients].find(c => c.readyState === WebSocket.OPEN && c.userId === p.user_id);

                    if (clientWs) {
                        try {
                            clientWs.send(JSON.stringify(msg));
                        } catch (e) {
                            console.log("Send error:", e);
                        }
                    }
                });
            }
            if (data.type === "search_users") {
                const query = data.query?.trim();
                if (!query || query.length < 2) {
                    return ws.send(JSON.stringify({
                        type: "search_users_result",
                        users: []
                    }));
                }

                const result = await db.query(
                    `
                    SELECT id AS user_id, username, avatar_id
                    FROM users
                    WHERE LOWER(username) LIKE LOWER($1)
                    AND id != $2
                    LIMIT 20
                    `,
                    [`%${query}%`, ws.userId]
                );

                ws.send(JSON.stringify({
                    type: "search_users_result",
                    users: result.rows
                }));
            }
            if (data.type === "send_friend_request") {
                const toUserId = Number(data.to_user_id);
                if (!toUserId || toUserId === ws.userId) return;

                // уже друзья?
                const alreadyFriends = await db.query(
                    `SELECT 1 FROM friends WHERE user_id=$1 AND friend_id=$2`,
                    [ws.userId, toUserId]
                );
                if (alreadyFriends.rows.length > 0) {
                    return ws.send(JSON.stringify({
                        type: "friend_request_failed",
                        message: "Вы уже друзья"
                    }));
                }

                // уже есть заявка?
                const exists = await db.query(
                    `
                    SELECT 1 FROM friend_requests
                    WHERE from_user_id=$1 AND to_user_id=$2 AND status='pending'
                    `,
                    [ws.userId, toUserId]
                );
                if (exists.rows.length > 0) {
                    return ws.send(JSON.stringify({
                        type: "friend_request_failed",
                        message: "Заявка уже отправлена"
                    }));
                }

                await db.query(
                    `
                    INSERT INTO friend_requests (from_user_id, to_user_id)
                    VALUES ($1, $2)
                    `,
                    [ws.userId, toUserId]
                );

                // уведомляем получателя если онлайн
                const targetWs = [...wss.clients].find(c => c.userId === toUserId);
                if (targetWs) {
                    const userRes = await db.query(
                        `SELECT id AS user_id, username, avatar_id FROM users WHERE id=$1`,
                        [ws.userId]
                    );

                    targetWs.send(JSON.stringify({
                        type: "friend_request_received",
                        from: userRes.rows[0]
                    }));
                }

                ws.send(JSON.stringify({
                    type: "friend_request_sent",
                    to_user_id: toUserId
                }));
            }
            if (data.type === "get_friend_requests") {
                const result = await db.query(
                    `
                    SELECT 
                        fr.id,
                        u.id AS user_id,
                        u.username,
                        u.avatar_id,
                        fr.created_at
                    FROM friend_requests fr
                    JOIN users u ON u.id = fr.from_user_id
                    WHERE fr.to_user_id = $1
                    AND fr.status = 'pending'
                    ORDER BY fr.created_at DESC
                    `,
                    [ws.userId]
                );

                ws.send(JSON.stringify({
                    type: "friend_requests_list",
                    requests: result.rows
                }));
            }
            if (data.type === "accept_friend_request") {
                const requestId = Number(data.request_id);
                if (!requestId) return;

                const reqRes = await db.query(
                    `
                    SELECT from_user_id
                    FROM friend_requests
                    WHERE id=$1 AND to_user_id=$2 AND status='pending'
                    `,
                    [requestId, ws.userId]
                );

                if (reqRes.rows.length === 0) return;

                const fromUserId = reqRes.rows[0].from_user_id;

                // добавляем в друзья (в обе стороны)
                await db.query(
                    `
                    INSERT INTO friends (user_id, friend_id)
                    VALUES ($1, $2), ($2, $1)
                    `,
                    [ws.userId, fromUserId]
                );

                await db.query(
                    `UPDATE friend_requests SET status='accepted' WHERE id=$1`,
                    [requestId]
                );

                const userRes = await db.query(
                    `SELECT id AS user_id, username, avatar_id FROM users WHERE id=$1`,
                    [fromUserId]
                );

                ws.send(JSON.stringify({
                    type: "friend_added",
                    user: userRes.rows[0]
                }));

                // уведомляем второго пользователя
                const targetWs = [...wss.clients].find(c => c.userId === fromUserId);
                if (targetWs) {
                    const meRes = await db.query(
                        `SELECT id AS user_id, username, avatar_id FROM users WHERE id=$1`,
                        [ws.userId]
                    );

                    targetWs.send(JSON.stringify({
                        type: "friend_added",
                        user: meRes.rows[0]
                    }));
                }
            }
            if (data.type === "get_friends") {
                const result = await db.query(
                    `
                    SELECT 
                        u.id AS user_id,
                        u.username,
                        u.avatar_id
                    FROM friends f
                    JOIN users u ON u.id = f.friend_id
                    WHERE f.user_id = $1
                    ORDER BY u.username
                    `,
                    [ws.userId]
                );

                const friends = result.rows.map(friend => {
                    const isOnline = [...wss.clients].some(
                        c => c.readyState === WebSocket.OPEN && c.userId === friend.user_id
                    );

                    return {
                        user_id: friend.user_id,
                        username: friend.username,
                        avatar_id: friend.avatar_id,
                        is_online: isOnline
                    };
                });

                ws.send(JSON.stringify({
                    type: "friends_list",
                    friends
                }));
            }
            if (data.type === "invite_to_game") {
                const friendId = Number(data.friend_id);
                if (!friendId) return;

                if (!ws.roomId) {
                    ws.send(JSON.stringify({
                        type: "invite_failed",
                        message: "Вы не в комнате"
                    }));
                    return;
                }

                // ищем WS приглашённого (ЕСЛИ ЕСТЬ — отправим)
                const friendWs = [...wss.clients].find(
                    c => c.readyState === WebSocket.OPEN && c.userId === friendId
                );

                if (friendWs) {
                    friendWs.send(JSON.stringify({
                        type: "game_invite",
                        from: {
                            user_id: ws.userId,
                            username: ws.userData.username,
                            avatar_id: ws.userData.avatar_id
                        },
                        room_id: ws.roomId
                    }));
                }

                // всегда отвечаем приглашающему
                ws.send(JSON.stringify({
                    type: "invite_sent",
                    to: friendId,
                    room_id: ws.roomId
                }));
            }
            if (data.type === "get_user_friends") {
                const targetUserId = Number(data.user_id);
                if (!targetUserId) return;

                const result = await db.query(
                    `
                    SELECT 
                        u.id AS user_id,
                        u.username,
                        u.avatar_id
                    FROM friends f
                    JOIN users u ON u.id = f.friend_id
                    WHERE f.user_id = $1
                    ORDER BY u.username
                    `,
                    [targetUserId]
                );

                const friends = result.rows.map(friend => {
                    const isOnline = [...wss.clients].some(
                        c => c.readyState === WebSocket.OPEN && c.userId === friend.user_id
                    );

                    return {
                        user_id: friend.user_id,
                        username: friend.username,
                        avatar_id: friend.avatar_id,
                        is_online: isOnline
                    };
                });

                ws.send(JSON.stringify({
                    type: "user_friends_list",
                    user_id: targetUserId,
                    friends
                }));
            }
            if (data.type === "get_rating") {
                const limit = Math.min(Number(data.limit) || 50, 100);
                const userId = ws.userId;

                // 1️⃣ ТОП РЕЙТИНГА
                const topRes = await db.query(
                    `
                    SELECT
                        place,
                        user_id,
                        username,
                        avatar_id,
                        experience
                    FROM (
                        SELECT
                            ROW_NUMBER() OVER (ORDER BY experience DESC, id ASC) AS place,
                            id AS user_id,
                            username,
                            avatar_id,
                            experience
                        FROM users
                    ) ranked
                    ORDER BY place
                    LIMIT $1
                    `,
                    [limit]
                );


                // 2️⃣ МОЁ МЕСТО В РЕЙТИНГЕ
                const meRes = await db.query(
                    `           
                    SELECT
                        place,
                        user_id,
                        username,
                        avatar_id,
                        experience
                    FROM (
                        SELECT
                            ROW_NUMBER() OVER (ORDER BY experience DESC, id ASC) AS place,
                            id AS user_id,
                            username,
                            avatar_id,
                            experience
                        FROM users
                    ) ranked
                    WHERE user_id = $1
                    LIMIT 1
                    `,
                    [userId]
                );


                ws.send(JSON.stringify({
                    type: "rating_result",
                    top: topRes.rows,
                    me: meRes.rows[0] || null
                }));
            }



        } catch (e) {
            console.error(e);
            ws.send(JSON.stringify({
            type: "json_error",
            message: "Неверный формат JSON"
        }));
        }
    });

        ws.on('close', async () => {
    console.log('Игрок отключился');

    if (!ws.userId) return;

    // узнаём комнату игрока
    const roomRes = await db.query(
        'SELECT room_id FROM room_players WHERE user_id = $1',
        [ws.userId]
    );

    if (roomRes.rows.length === 0) return;

    const roomId = roomRes.rows[0].room_id;
    const game = games[roomId];

    // ===============================
    // 🎮 ИГРА УЖЕ НАЧАЛАСЬ → AFK
    // ===============================
    if (game) {
        // НИЧЕГО НЕ ДЕЛАЕМ
        // игрок остаётся в игре, просто без WS
        return;
    }

    // ===============================
    // 🏠 ИГРА НЕ НАЧАЛАСЬ → ВЫХОД
    // ===============================
    const result = await leaveRoom(ws.userId);

    if (result?.roomId) {
        await sendRoomUpdate(
            result.roomId,
            null,
            result.leavingPlayer
        );
        checkAutoStart(result.roomId);
    }
});




});

setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

console.log('WebSocket сервер запущен на ws://localhost:8080');
