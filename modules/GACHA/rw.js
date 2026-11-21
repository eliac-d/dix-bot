import axios from 'axios';
import * as db from '../../database/db_adapter.js';
import {
    rollLocks,
    cleanOldLocks,
    loadCharacters,
    flattenCharacters,
    getSeriesNameByCharacter,
    formatTag,
    buscarImagenDelirius,
    getRefererForUrl,
    getUserById
} from './gacha_utils.js';

export const rollwaifuCommand = {
    category: 'gacha',
    commands: {
        rollwaifu: {
            name: 'rollwaifu',
            alias: ['rw', 'roll'],
            run: async (m, { conn, args, store }) => {
                const userId = m.sender;
                const chatId = m.chat;
                const usedPrefix = m.prefix || (m.text?.match(/^[^\w\s]/) || ['.'])[0];
                const commandName = (m.text || '').trim().slice(usedPrefix.length).split(/\s+/)[0] || 'rollwaifu';

                cleanOldLocks();

                if (rollLocks.has(userId)) {
                    const lockTime = rollLocks.get(userId);
                    const now = Date.now();
                    if (now - lockTime < 15000) return;
                    rollLocks.delete(userId);
                }

                let chat = db.getChat(chatId);

                db.setCreate('chat_users', [chatId, userId], 'lastRoll', 0);
                let user = db.getChatUser(chatId, userId);
                let me = user;
                const now = Date.now();
                const cooldown = 0 * 60 * 1000;

                if (me.lastRoll && now < me.lastRoll) {
                    const r = Math.ceil((me.lastRoll - now) / 1000);
                    const min = Math.floor(r / 60);
                    const sec = r % 60;
                    let timeText = '';
                    if (min > 0) timeText += `${min} minuto${min !== 1 ? 's' : ''} `;
                    if (sec > 0 || timeText === '') timeText += `${sec} segundo${sec !== 1 ? 's' : ''}`;
                    return m.reply(`❐ Debes esperar *${timeText.trim()}* para usar *${usedPrefix}rw* de nuevo.`);
                }

                rollLocks.set(userId, now);

                try {
                    await m.react('🕓');

                    const chars = await loadCharacters();
                    const all = flattenCharacters(chars);

                    if (all.length === 0) {
                        rollLocks.delete(userId);
                        await m.react('❌');
                        return m.reply('❏ No hay personajes disponibles para hacer *roll* en este momento.');
                    }

                    const selected = all[Math.floor(Math.random() * all.length)];
                    const id = String(selected.id);
                    const source = getSeriesNameByCharacter(chars, selected.id);
                    const baseTag = formatTag(selected.tags?.[0] || '');
                    const mediaList = await buscarImagenDelirius(baseTag);
                    const media = mediaList[Math.floor(Math.random() * mediaList.length)];

                    if (!media) {
                        rollLocks.delete(userId);
                        await m.react('❌');
                        return m.reply(`×᷼× No se encontró imágenes para el personaje *${selected.name}*.`);
                    }

                    const charKey = chatId + '__' + id;
                    if (!db.getCharacter(charKey)) {
                        db.setCharacter(charKey, { name: String(selected.name || 'Sin nombre') });
                    } else if (!db.getCharacter(charKey)?.name) {
                        db.setCharacter(charKey, { ...db.getCharacter(charKey), name: String(selected.name || 'Sin nombre') });
                    }

                    const globalChar = db.getCharacter(id) || {};
                    let chatChar = db.getCharacter(charKey) || {};
                    chatChar.name = String(selected.name || 'Sin nombre');
                    chatChar.value = typeof globalChar.value === 'number' ? globalChar.value : Number(selected.value) || 100;
                    chatChar.votes = Number(chatChar.votes || globalChar.votes || 0);
                    chatChar.reservedBy = userId;
                    chatChar.reservedUntil = now + 20000;
                    chatChar.expiresAt = now + 60000;
                    db.setCharacter(charKey, chatChar);

                    const claimedBy = chatChar?.user || null;
                    const owner = claimedBy ? (getUserById(claimedBy)?.name || claimedBy.split('@')[0]) : 'desconocido';
                    const caption = `➤ Nombre » *${chatChar.name}*\n웃 Género » *${selected.gender || 'Desconocido'}*\n✰ Valor » *${chatChar.value}*\n𖤍 Estado » *${claimedBy ? `Reclamado por ${owner}` : 'Libre'}*\n⌬ Fuente » *${source}*\u206c`;

                    const imgRes = await axios.get(media, {
                        responseType: 'arraybuffer',
                        timeout: 15000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Referer': getRefererForUrl(media)
                        }
                    });
                    const buffer = Buffer.from(imgRes.data);

                    const sent = await conn.sendMessage(chatId, { image: buffer, caption }, { quoted: m });

                    chat.rolls = chat.rolls || {};
                    chat.rolls[sent.key.id] = {
                        id,
                        charKey,
                        name: chatChar.name,
                        expiresAt: chatChar.expiresAt,
                        reservedBy: userId,
                        reservedUntil: chatChar.reservedUntil
                    };
                    db.setChat(chatId, 'rolls', chat.rolls);
                    db.setChatUser(chatId, userId, 'lastRoll', now + cooldown);

                    await m.react('✅');
                } catch (e) {
                    await m.react('✖️');
                    await m.reply(`> An unexpected error occurred while executing command *${usedPrefix}${commandName}*. Please try again or contact support if the issue persists.\n> [Error: *${e.message}*]`);
                } finally {
                    rollLocks.delete(userId);
                }
            }
        }
    }
};