const API_URL = 'https://dix.lat/v1/akinator';
const API_KEY = apikey;
const MAX_IDLE = 15 * 60 * 1000;
const LANGUAGE = 'es';

const THEME_LABELS = {
    characters: 'Personajes',
    animals: 'Animales',
    objects: 'Objetos'
};

const ANSWER_INDEX = {
    '0': 0,
    'si': 0,
    'yes': 0,
    '1': 1,
    'no': 1,
    '2': 2,
    'no se': 2,
    'no lo se': 2,
    'nose': 2,
    '3': 3,
    'probablemente': 3,
    'probablemente si': 3,
    '4': 4,
    'probablemente no': 4
};

const YES_WORDS = ['si', 'yes', '0'];
const NO_WORDS = ['no', '1'];
const BACK_WORDS = ['atras', 'back', 'undo'];
const EXIT_WORDS = ['saliraki', 'delaki', 'abandonar'];

const ENDPOINT = (() => {
    try {
        const u = new URL(API_URL);
        u.protocol = 'https:';
        return u.origin + u.pathname;
    } catch {
        return API_URL;
    }
})();

const extractSession = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const candidates = [
        raw.session,
        raw.sessionToken,
        raw.session_token,
        raw.token,
        raw.sid,
        raw.data?.session,
        raw.data?.sessionToken,
        raw.data?.token,
        raw.result?.session,
        raw.session?.session,
        raw.session?.token
    ];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim().length > 0) {
            return c.trim();
        }
    }
    return null;
};

const buildEndpointUrl = (payload = {}) => {
    const endpoint = new URL(ENDPOINT);
    if (API_KEY) {
        endpoint.searchParams.set('apikey', API_KEY);
    }
    if (payload.action) {
        endpoint.searchParams.set('action', String(payload.action));
    }
    return endpoint.toString();
};

const callAkiApi = async (payload) => {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    if (API_KEY) {
        headers['x-api-key'] = API_KEY;
    }

    const res = await fetch(buildEndpointUrl(payload), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        redirect: 'follow'
    });

    let data;
    try {
        data = await res.json();
    } catch {
        throw new Error(`Respuesta inválida del servidor (HTTP ${res.status})`);
    }

    if (data && data.service === 'akinator-api' && typeof data.session !== 'string') {
        throw new Error('El endpoint respondió desde su rama GET (redirect HTTP). Usa https:// en API_URL.');
    }

    const isOk = data?.ok === true || data?.success === true;
    if (!res.ok || !isOk) {
        const errMsg = typeof data?.error === 'string'
            ? data.error
            : data?.error?.message || `Error HTTP ${res.status}`;
        throw new Error(errMsg);
    }

    const merged = data?.data && typeof data.data === 'object' ? { ...data, ...data.data } : { ...data };
    const resolvedSession = extractSession(merged) || extractSession(data);
    if (resolvedSession) {
        merged.session = resolvedSession;
    }
    return merged;
};

const confirmWin = async (session, fallbackName) => {
    let name = fallbackName || 'Desconocido';
    for (let i = 0; i < 3; i++) {
        try {
            const winData = await callAkiApi({ action: 'win', session });
            if (winData && typeof winData.name === 'string' && winData.name.trim()) {
                name = winData.name.trim();
            }
            return name;
        } catch {
            await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        }
    }
    return name;
};

const normalize = (text) =>
    String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[¿?¡!.,]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

const tag = (jid) => `@${jid.split('@')[0]}`;

const photoUrl = (value) => {
    if (!value) return null;
    const url = String(value).replace(/\\\//g, '/').trim();
    if (!url) return null;
    return url.startsWith('//') ? `https:${url}` : url;
};

const progressText = (game) => `${Number(game.progression || 0).toFixed(1)}%`;

const optionsText = () =>
    `*Responde con:*\n` +
    `⓿ *Sí*\n` +
    `❶ *No*\n` +
    `❷ *No sé*\n` +
    `❸ *Probablemente sí*\n` +
    `❹ *Probablemente no*\n\n` +
    `↩ *atras* para volver una pregunta\n` +
    `✰ *saliraki* para terminar la partida\n\n` +
    `_Puedes escribir la palabra o el número, sin prefijo._`;

const getGame = (chat) => {
    global.akiGames = global.akiGames || {};
    const game = global.akiGames[chat];
    if (game && Date.now() - game.updated > MAX_IDLE) {
        delete global.akiGames[chat];
        return null;
    }
    return game || null;
};

const send = (conn, m, game, content) =>
    conn.sendMessage(
        m.chat,
        { ...content, contextInfo: { mentionedJid: [game.player] } },
        { quoted: m }
    );

const track = (game, sent) => {
    if (sent?.key?.id) game.msgIds.push(sent.key.id);
};

const sendQuestion = async (conn, m, game, header) => {
    const text = `${header}\n\n✰ *Pregunta ${game.numQuestion}:* ${game.question}\n\n${optionsText()}`;
    track(game, await send(conn, m, game, { text }));
};

const sendProposal = async (conn, m, game) => {
    const p = game.proposal;
    const caption =
        `✧ *¿ES ESTE TU PERSONAJE?*\n\n` +
        `♛ *Nombre:* ${p.name}\n` +
        `✎ *Descripción:* ${p.desc || 'Sin descripción'}\n` +
        `✰ *Progreso:* ${progressText(game)}\n\n` +
        `➔ Responde *sí* o *no*.`;
    let sent;
    if (p.photo) {
        try {
            sent = await send(conn, m, game, { image: { url: p.photo }, caption });
        } catch {
            sent = await send(conn, m, game, { text: caption });
        }
    } else {
        sent = await send(conn, m, game, { text: caption });
    }
    track(game, sent);
};

const applyResult = async (conn, m, game, result) => {
    const r = result || {};

    if (r.session) game.session = r.session;
    game.updated = Date.now();
    game.step = r.step ?? game.step;
    game.progression = r.progression ?? game.progression;

    if (r.won === true) {
        const w = r.win || {};
        game.proposal = {
            name: w.name || 'Desconocido',
            desc: w.description || null,
            photo: photoUrl(w.photo)
        };
        return sendProposal(conn, m, game);
    }

    if (r.ko === true) {
        delete global.akiGames[m.chat];
        return conn.sendMessage(m.chat, { text: `🏁 Akinator se rindió. ¡Ganaste! 🎉` }, { quoted: m });
    }

    if (typeof r.question === 'string' && r.question) {
        game.proposal = null;
        game.question = r.question;
        return sendQuestion(
            conn,
            m,
            game,
            `✪ *AKINATOR* (Paso: ${game.step} | Progreso: ${progressText(game)})`
        );
    }

    delete global.akiGames[m.chat];
    return conn.sendMessage(m.chat, { text: `🏁 Akinator no pudo continuar la partida.` }, { quoted: m });
};

const handleExit = async (conn, m) => {
    delete global.akiGames[m.chat];
    await m.react('👋');
    return conn.sendMessage(
        m.chat,
        {
            text: `✔ *PARTIDA DE AKINATOR FINALIZADA*\n\n${tag(m.sender)} ha decidido abandonar la partida.`,
            contextInfo: { mentionedJid: [m.sender] }
        },
        { quoted: m }
    );
};

const handleBack = async (conn, m, game) => {
    if (game.numQuestion <= 1) {
        return conn.sendMessage(m.chat, { text: `⚠️ Ya estás en la primera pregunta.` }, { quoted: m });
    }
    if (!game.session) {
        return conn.sendMessage(m.chat, { text: `❌ Sesión de partida no encontrada.` }, { quoted: m });
    }
    await m.react('↩️');
    try {
        const result = await callAkiApi({
            action: 'back',
            session: game.session
        });
        game.numQuestion = Math.max(1, game.numQuestion - 1);
        await applyResult(conn, m, game, result);
    } catch (e) {
        await conn.sendMessage(m.chat, { text: `❌ No se pudo volver atrás: ${e.message}` }, { quoted: m });
    }
};

const handleProposal = async (conn, m, game, key) => {
    if (!game.session) {
        return conn.sendMessage(m.chat, { text: `❌ Sesión de partida no encontrada.` }, { quoted: m });
    }
    await m.react('⏳');
    try {
        if (YES_WORDS.includes(key)) {
            const name = await confirmWin(game.session, game.proposal.name);
            delete global.akiGames[m.chat];
            await m.react('🎉');
            return conn.sendMessage(
                m.chat,
                {
                    text: `✰ *¡AKINATOR HA GANADO!* ʕ˖͜͡˖ʔ\n\n✎ *Personaje:* ${name}\n\nGracias por jugar, ${tag(m.sender)} 😎`,
                    contextInfo: { mentionedJid: [m.sender] }
                },
                { quoted: m }
            );
        }
        const result = await callAkiApi({
            action: 'continue',
            session: game.session
        });
        await m.react('✅');
        await applyResult(conn, m, game, result);
    } catch (e) {
        await conn.sendMessage(m.chat, { text: `❌ Error al continuar la partida: ${e.message}` }, { quoted: m });
    }
};

const handleAnswer = async (conn, m, game, index) => {
    if (!game.session) {
        return conn.sendMessage(m.chat, { text: `❌ Sesión de partida no encontrada.` }, { quoted: m });
    }
    await m.react('⏳');
    try {
        const result = await callAkiApi({
            action: 'answer',
            session: game.session,
            answer: index
        });
        game.numQuestion += 1;
        await m.react('✅');
        await applyResult(conn, m, game, result);
    } catch (e) {
        await conn.sendMessage(m.chat, { text: `❌ Error al comunicarse con Akinator: ${e.message}` }, { quoted: m });
    }
};

const startGame = async (m, conn, args) => {
    let themeKey = 'characters';
    let childMode = false;

    for (const a of args || []) {
        const v = String(a).toLowerCase();
        if (v === 'animal' || v === 'animales') themeKey = 'animals';
        else if (v === 'objeto' || v === 'objetos' || v === 'objects') themeKey = 'objects';
        else if (v === 'child' || v === 'niño' || v === 'nino') childMode = true;
    }

    await m.react('🔮');

    try {
        const first = await callAkiApi({
            action: 'start',
            language: LANGUAGE,
            theme: themeKey,
            childMode
        });

        if (!first.session) {
            throw new Error('La API no devolvió un token de session válido al iniciar.');
        }
        if (typeof first.question !== 'string' || !first.question) {
            throw new Error('La API no devolvió una pregunta inicial.');
        }

        const game = {
            session: first.session,
            player: m.sender,
            msgIds: [],
            question: first.question,
            step: first.step ?? 0,
            progression: first.progression ?? 0,
            proposal: null,
            numQuestion: 1,
            busy: false,
            updated: Date.now()
        };

        global.akiGames[m.chat] = game;

        await sendQuestion(
            conn,
            m,
            game,
            `✎ *AKINATOR - INICIO* (Tema: ${THEME_LABELS[themeKey]}${childMode ? ' | Modo niño' : ''})\n👤 Jugador: ${tag(m.sender)}`
        );
    } catch (e) {
        delete global.akiGames[m.chat];
        await conn.sendMessage(m.chat, { text: `❌ No se pudo iniciar Akinator: ${e.message}` }, { quoted: m });
    }
};

export const akinatorCommand = {
    category: 'game',
    commands: {
        akinator: {
            name: 'akinator',
            alias: ['aki', 'saliraki', 'delaki'],
            libre: true,

            async before(m, { conn }) {
                const game = getGame(m.chat);
                if (!game || m.isBaileys || m.fromMe || m.sender !== game.player) return false;

                const quotedId = m.quoted?.id || m.msg?.contextInfo?.stanzaId;
                if (quotedId && !game.msgIds.includes(quotedId)) return false;

                const key = normalize(m.text);
                if (!key) return false;

                const isExit = EXIT_WORDS.includes(key);
                const isBack = BACK_WORDS.includes(key);
                const isProposalAnswer = !!game.proposal && (YES_WORDS.includes(key) || NO_WORDS.includes(key));
                const index = game.proposal ? undefined : ANSWER_INDEX[key];

                if (!isExit && !isBack && !isProposalAnswer && index === undefined) return false;
                if (game.busy) return true;

                game.busy = true;
                try {
                    if (isExit) await handleExit(conn, m);
                    else if (isBack) await handleBack(conn, m, game);
                    else if (isProposalAnswer) await handleProposal(conn, m, game, key);
                    else await handleAnswer(conn, m, game, index);
                } finally {
                    game.busy = false;
                }
                return true;
            },

            run: async (m, { conn, command, args }) => {
                const cmd = (command || '').toLowerCase();
                const game = getGame(m.chat);

                if (cmd === 'saliraki' || cmd === 'delaki') {
                    if (!game) {
                        return conn.sendMessage(m.chat, { text: `⚠️ No hay ninguna partida de Akinator activa en este grupo.` }, { quoted: m });
                    }
                    if (m.sender !== game.player) {
                        return conn.sendMessage(m.chat, { text: `❌ Solo el jugador participante puede cancelar la partida.` }, { quoted: m });
                    }
                    delete global.akiGames[m.chat];
                    return conn.sendMessage(m.chat, { text: `🏁 La partida de Akinator ha sido cancelada.` }, { quoted: m });
                }

                if (game) {
                    return conn.sendMessage(m.chat, { text: `⚠️ Ya hay una partida de Akinator activa en este grupo.` }, { quoted: m });
                }

                await startGame(m, conn, args);
                return true;
            }
        }
    }
};