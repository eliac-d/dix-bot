import * as db from '../../database/db_adapter.js';
import {
    loadCharacters,
    flattenCharacters
} from './gacha_utils.js';

export const waifusboardCommand = {
    category: 'gacha',
    commands: {
        waifusboard: {
            name: 'waifusboard',
            alias: ['waifustop', 'topwaifus', 'wtop'],
            run: async (m, { conn, args }) => {
                const usedPrefix = m.prefix || (m.text?.match(/^[^\w\s]/) || ['.'])[0];
                const commandName = (m.text || '').trim().slice(usedPrefix.length).split(/\s+/)[0] || 'waifusboard';
                
                try {
                    const structure = await loadCharacters();
                    const allCharacters = flattenCharacters(structure);
                    const enriched = [];
                    for (const c of allCharacters) {
                        const character = db.getCharacter(String(c.id));
                        const value = character?.value || Number(c.value || 0);
                        enriched.push({ name: c.name, value, id: c.id });
                    }
                    const page = parseInt(args[0]) || 1;
                    const perPage = 10;
                    const totalPages = Math.ceil(enriched.length / perPage);
                    if (page < 1 || page > totalPages) {
                        return m.reply(`✎ Página no válida. Hay un total de *${totalPages}* páginas.`);
                    }
                    const sorted = enriched.sort((a, b) => b.value - a.value);
                    const sliced = sorted.slice((page - 1) * perPage, page * perPage);
                    let message = '𖤍 *Personajes con más valor:*\n\n';
                    sliced.forEach((char, i) => {
                        message += `✰ ${((page - 1) * perPage) + i + 1} » *${char.name}*\n`;
                        message += `   → Valor: *${char.value}*\n`;
                    });
                    message += `\n➔ Página *${page}* de *${totalPages}*`;
                    if (page < totalPages) {
                        message += `\n> Para ver la siguiente página › *waifusboard ${page + 1}*`;
                    }
                    await conn.sendMessage(m.chat, { text: message.trim() }, { quoted: m });
                } catch (e) {
                    await m.reply(`> An unexpected error occurred while executing command *${usedPrefix}${commandName}*. Please try again or contact support if the issue persists.\n> [Error: *${e.message}*]`);
                }
            }
        }
    }
};