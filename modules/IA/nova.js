import axios from 'axios';

const NOVA_ENDPOINT = 'https://dix.lat/v1/nova';
const NOVA_APIKEY = apikey; 

const memoryStore = new Map();
const MAX_CONVERSATIONS = 9;
const MAX_HISTORY = MAX_CONVERSATIONS * 2;
const MAX_AGE = 30 * 60 * 1000;
const CLEAN_INTERVAL = 10 * 60 * 1000;

const getMemoryKey = (m) => `${m.chat}_${m.sender}`;

function getHistory(m) {
    const key = getMemoryKey(m);
    const entry = memoryStore.get(key);
    if (!entry) return [];
    if (Date.now() - entry.lastUpdate > MAX_AGE) {
        memoryStore.delete(key);
        return [];
    }
    return entry.history;
}

function addToHistory(m, userText, assistantText) {
    const key = getMemoryKey(m);
    const entry = memoryStore.get(key) || { history: [], lastUpdate: 0 };
    entry.history.push({ role: 'user', content: userText });
    entry.history.push({ role: 'assistant', content: assistantText });
    if (entry.history.length > MAX_HISTORY) {
        entry.history = entry.history.slice(-MAX_HISTORY);
    }
    entry.lastUpdate = Date.now();
    memoryStore.set(key, entry);
}

function clearHistory(m) {
    memoryStore.delete(getMemoryKey(m));
}

function formatHistory(history) {
    if (!history.length) return '';
    const lines = history.map(h =>
        h.role === 'user'
            ? `Usuario: "${h.content}"`
            : `Nova: "${h.content}"`
    );
    return (
        `[CONVERSACIÓN ANTERIOR]\n` +
        `${lines.join('\n')}\n` +
        `[FIN CONVERSACIÓN ANTERIOR]\n\n`
    );
}

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore.entries()) {
        if (now - entry.lastUpdate > MAX_AGE) memoryStore.delete(key);
    }
}, CLEAN_INTERVAL).unref?.();

export const novaCommand = {
    category: 'ai',
    commands: {
        nova: {
            name: 'nova',
            alias: ['catia'],
            run: async (m, { conn, text }) => {
                if (!text) return m.reply(`> *✎ Hola, ¿en qué puedo ayudarte hoy?*`);

                if (/^(reset|clear|olvida|olvidar|borrar|memoria)$/i.test(text.trim())) {
                    clearHistory(m);
                    return m.reply('> *🧠 Memoria borrada. Empezamos de cero.*');
                }

                await m.react('💬');

                try {
                    const history = getHistory(m);
                    const historyPrefix = formatHistory(history);

                    const payloadText =
                        `${historyPrefix}` +
                        `Mensaje actual del usuario: "${text}"\n\n` +
                        `Tu respuesta:`;

                    const body = {
                        text: payloadText,
                        historial: []
                    };

                    const { data } = await axios.post(
                        `${NOVA_ENDPOINT}?apikey=${NOVA_APIKEY}`,
                        body,
                        { headers: { 'Content-Type': 'application/json' } }
                    );

                    if (!data || !data.success || !data.data || !data.data.response) {
                        throw new Error('Respuesta inválida del servicio Nova');
                    }

                    const response = data.data.response.trim();
                    addToHistory(m, text, response);

                    await conn.sendPreviewMessage(m.chat, response, {
                        type: 3,
                        ratio: 'landscape',
                        url: global.surl ? global.surl(conn) : 'https://whatsapp.com',
                        thumbnail: 'https://cdn.dix.lat/me/d22cc191-db42-42d0-9560-f7a1efa730a1.jpg',
                        title: 'NOVA AI',
                        body: 'CATEGORÍA: Inteligencia Artificial',
                        quoted: m,
                        mentions: [m.sender],
                        contextInfo: {
                            ...channelInfo,
                            mentionedJid: [m.sender]
                        }
                    });

                    await m.react('✅');

                } catch (e) {
                    console.error('Error en Nova IA:', e.response ? JSON.stringify(e.response.data) : e.message);
                    await m.react('✖️');
                    m.reply(`> *⚠ Error al procesar la respuesta.*`);
                }
            }
        }
    }
};