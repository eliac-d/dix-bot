import * as db from '../../database/db_adapter.js';
import {
    loadCharacters,
    flattenCharacters,
    getUserById
} from './gacha_utils.js';

export const haremCommand = {
    category: 'gacha',
    commands: {
        harem: {
            name: 'harem',
            alias: ['waifus', 'claims'],
            run: async (m, { conn, args }) => {
                const usedPrefix = m.prefix || (m.text?.match(/^[^\w\s]/) || ['.'])[0];
                const commandName = (m.text || '').trim().slice(usedPrefix.length).split(/\s+/)[0] || 'harem';
                try {
                    
                    const userId = m.mentionedJid?.[0] || m.quoted?.sender || m.sender;
                    const userGlobal = getUserById(userId);
                    const name = userGlobal?.name || userId.split('@')[0];
                    const structure = await loadCharacters();
                    const allCharacters = flattenCharacters(structure);
                    let ownedIDs = [];
                    const userData = db.getChatUser(m.chat, userId);
                    if (userData && userData.characters) {
                        if (typeof userData.characters === 'string') {
                            try { userData.characters = JSON.parse(userData.characters); } catch { userData.characters = []; }
                        }
                        ownedIDs = Array.isArray(userData.characters) ? userData.characters : [];
                    }
                    if (ownedIDs.length === 0) {
                        const isSelf = userId === m.sender;
                        const replyText = isSelf ? 'ꕥ No tienes personajes reclamados.' : `✖ *${name}* no tiene personajes reclamados.`;
                        return conn.sendMessage(m.chat, { text: replyText, mentions: [userId] }, { quoted: m });
                    }
                    const charactersWithValues = [];
                    for (const id of ownedIDs) {
                        const globalChar = db.getCharacter(id);
                        const chatChar = db.getCharacter(m.chat + '__' + id);
                        const value = typeof globalChar?.value === 'number' ? globalChar.value : chatChar?.value || 0;
                        charactersWithValues.push({ id, value });
                    }
                    charactersWithValues.sort((a, b) => b.value - a.value);
                    const sortedIDs = charactersWithValues.map(item => item.id);
                    const page = parseInt(args[1]) || 1;
                    const perPage = 64;
                    const totalPages = Math.ceil(sortedIDs.length / perPage);
                    if (page < 1 || page > totalPages) {
                        return m.reply(`✘ Página no válida. Hay un total de *${totalPages}* páginas.`);
                    }
                    const start = (page - 1) * perPage;
                    const end = Math.min(start + perPage, sortedIDs.length);
                    let message = `✰ Personajes reclamados ✎\n`;
                    message += `➤ Usuario: *${name}*\n`;
                    message += `웃 Personajes: *(${sortedIDs.length})*\n\n`;
                    for (let i = start; i < end; i++) {
                        const id = sortedIDs[i];
                        const globalChar2 = db.getCharacter(id);
                        const chatChar2 = db.getCharacter(m.chat + '__' + id);
                        const jsonRec = allCharacters.find(c => String(c.id) === String(id));
                        const charName = jsonRec?.name || chatChar2?.name || globalChar2?.name || `ID:${id}`;
                        const value = typeof globalChar2?.value === 'number' ? globalChar2.value : chatChar2?.value || 0;
                        message += `» *${charName}* (*${value}*)\n`;
                    }
                    message += `\n✎ _Página *${page}* de *${totalPages}*_`;
                    if (page < totalPages) {
                        const nameArgs = args.filter(arg => isNaN(parseInt(arg))).join(' ');
                        message += `\n> Usa *${usedPrefix}${commandName} ${nameArgs} ${page + 1}* para ver la siguiente página.`;
                    }
                    await conn.sendMessage(m.chat, { image: { url: img(conn) }, caption: message.trim(), mentions: [userId] }, { quoted: m });
                } catch (e) {
                    await m.reply(`> An unexpected error occurred while executing command *${usedPrefix}${commandName}*. Please try again or contact support if the issue persists.\n> [Error: *${e.message}*]`);
                }
            }
        }
    }
};