import * as db from '../../database/db_adapter.js';
import {
    loadCharacters,
    flattenCharacters,
    getSeriesNameByCharacter,
    getUserById
} from './gacha_utils.js';

function formatElapsed(ms) {
    if (!ms || ms <= 0) return '—';
    const sec = Math.floor(ms / 1000);
    const w = Math.floor(sec / 604800);
    const d = Math.floor((sec % 604800) / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m_ = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (w > 0) parts.push(`${w}w`);
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m_ > 0) parts.push(`${m_}m`);
    if (s > 0) parts.push(`${s}s`);
    return parts.join(' ');
}

export const charinfoCommand = {
    category: 'gacha',
    commands: {
        charinfo: {
            name: 'charinfo',
            alias: ['winfo', 'waifuinfo'],
            run: async (m, { conn, args }) => {
                const usedPrefix = m.prefix || (m.text?.match(/^[^\w\s]/) || ['.'])[0];
                const commandName = (m.text || '').trim().slice(usedPrefix.length).split(/\s+/)[0] || 'charinfo';
                try {
                    
                    if (!args.length) {
                        return m.reply(`ʕ˖͜͡˖ʔ Por favor, proporciona el nombre de un personaje.\n> Ejemplo » *${usedPrefix}${commandName} Hitori Gotou*`);
                    }
                    const structure = await loadCharacters();
                    const allCharacters = flattenCharacters(structure);
                    const nameQuery = args.join(' ').toLowerCase().trim();
                    const character = allCharacters.find(c => String(c.name).toLowerCase() === nameQuery)
                        || allCharacters.find(c => String(c.name).toLowerCase().includes(nameQuery) || (Array.isArray(c.tags) && c.tags.some(tag => String(tag).toLowerCase().includes(nameQuery))))
                        || allCharacters.find(c => nameQuery.split(' ').some(q => String(c.name).toLowerCase().includes(q) || (Array.isArray(c.tags) && c.tags.some(tag => String(tag).toLowerCase().includes(q)))));
                    if (!character) {
                        return m.reply(`✘ No se ha encontrado el personaje *${nameQuery}*.\n> Para añadir animes al bot » *${usedPrefix}addanime*`);
                    }
                    const charId = String(character.id);
                    const source = getSeriesNameByCharacter(structure, character.id);
                    let characterData = db.getCharacter(charId);
                    if (!characterData) {
                        characterData = { name: character.name, value: Number(character.value) || 100, votes: 0 };
                    }
                    const rawChatUsers = db.getChatUser(m.chat);
                    const allChatUsers = Array.isArray(rawChatUsers) ? rawChatUsers : (rawChatUsers ? [rawChatUsers] : []);
                    for (const u of allChatUsers) {
                        if (u.characters && typeof u.characters === 'string') {
                            try { u.characters = JSON.parse(u.characters); } catch { u.characters = []; }
                        }
                    }
                    const userEntry = allChatUsers.find(u => Array.isArray(u.characters) && u.characters.some(cid => String(cid) === charId));
                    let ownerName = 'Desconocido';
                    let claimedDateLine = '';
                    if (userEntry) {
                        const ownerGlobal = getUserById(userEntry.user_id);
                        ownerName = ownerGlobal?.name?.trim() || String(userEntry.user_id).split('@')[0];
                        const claimedChar = db.getCharacter(m.chat + '__' + charId);
                        if (claimedChar?.claimedAt) {
                            claimedDateLine = `\n♛ Fecha de reclamo » *${new Date(claimedChar.claimedAt).toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}*`;
                        }
                    }
                    const lastVoteAgo = typeof characterData.lastVotedAt === 'number'
                        ? `hace *${formatElapsed(Date.now() - characterData.lastVotedAt)}*`
                        : '*Nunca*';
                    const allCharactersData = [];
                    for (const c of allCharacters) {
                        const charData = db.getCharacter(String(c.id));
                        if (charData?.value) {
                            allCharactersData.push({ name: c.name, value: charData.value });
                        }
                    }
                    const sorted = allCharactersData.sort((a, b) => b.value - a.value);
                    const rank = sorted.findIndex(c => c.name === character.name) + 1 || '—';
                    const caption = `★ Nombre » *${characterData.name}*
웃 Género » *${character.gender || 'Desconocido'}*
✰ Valor » *${characterData.value}*
✎ Estado » ${userEntry ? `Reclamado por *${ownerName}*` : '*Libre*'}${claimedDateLine}
𖤍 Fuente » *${source}*
❏ Puesto » *#${rank}*
ⴵ Último voto » ${lastVoteAgo}`.trim();
                    await conn.sendMessage(m.chat, { text: caption }, { quoted: m });
                } catch (e) {
                    await m.reply(`> An unexpected error occurred while executing command *${usedPrefix}${commandName}*. Please try again or contact support if the issue persists.\n> [Error: *${e.message}*]`);
                }
            }
        }
    }
};