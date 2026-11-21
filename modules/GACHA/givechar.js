import * as db from '../../database/db_adapter.js';
import {
    loadCharacters,
    flattenCharacters,
    getUserById
} from './gacha_utils.js';

export const givecharCommand = {
    category: 'gacha',
    commands: {
        givechar: {
            name: 'givechar',
            alias: ['givewaifu', 'regalar'],
            run: async (m, { conn, args }) => {
                const usedPrefix = m.prefix || (m.text?.match(/^[^\w\s]/) || ['.'])[0];
                const commandName = (m.text || '').trim().slice(usedPrefix.length).split(/\s+/)[0] || 'givechar';
                try {
                    
                    if (!args.length) {
                        return m.reply(`✰ Debes mencionar a quien quieras regalarle un personaje.`);
                    }
                    const targetId = m.mentionedJid?.[0] || null;
                    if (!targetId) return m.reply(`✫ Debes mencionar a quien quieras regalarle un personaje.`);
                    let sender = db.getChatUser(m.chat, m.sender);
                    let target = db.getChatUser(m.chat, targetId);
                    if (!target) return m.reply('✰ El usuario mencionado no está registrado.');

                    if (sender.characters && typeof sender.characters === 'string') {
                        try { sender.characters = JSON.parse(sender.characters); } catch { sender.characters = []; }
                    }
                    if (!Array.isArray(sender.characters)) sender.characters = [];
                    if (target.characters && typeof target.characters === 'string') {
                        try { target.characters = JSON.parse(target.characters); } catch { target.characters = []; }
                    }
                    if (!Array.isArray(target.characters)) target.characters = [];

                    const characterName = m.quoted ? args.join(' ').toLowerCase().trim() : args.slice(0, -1).join(' ').toLowerCase().trim();
                    const structure = await loadCharacters();
                    const allCharacters = flattenCharacters(structure);
                    const character = allCharacters.find(c => String(c.name).toLowerCase() === characterName);
                    if (!character) {
                        return m.reply(`×᷼× No se encontró el personaje *${characterName}*.`);
                    }
                    const charId = String(character.id);
                    if (!sender.characters.some(cid => String(cid) === charId)) {
                        return m.reply(`♛ *${character.name}* no está reclamado por ti.`);
                    }
                    const charKey = m.chat + '__' + charId;
                    db.setCreate('characters', charKey, 'name', character.name);
                    let characterData = db.getCharacter(charKey);
                    if (!characterData) characterData = { name: character.name, value: Number(character.value || 100), votes: 0 };
                    characterData.user = targetId;
                    characterData.claimedAt = Date.now();
                    delete characterData.reservedBy;
                    delete characterData.reservedUntil;
                    db.setCharacter(charKey, characterData);

                    sender.characters = sender.characters.filter(cid => String(cid) !== charId);
                    db.setChatUser(m.chat, m.sender, 'characters', sender.characters);

                    if (!target.characters.some(cid => String(cid) === charId)) {
                        target.characters.push(charId);
                        db.setChatUser(m.chat, targetId, 'characters', target.characters);
                    }

                    const senderGlobal = getUserById(m.sender);
                    const targetGlobal = getUserById(targetId);
                    const senderName = senderGlobal?.name?.trim() || String(m.sender).split('@')[0];
                    const receiverName = targetGlobal?.name?.trim() || String(targetId).split('@')[0];

                    await conn.sendMessage(m.chat, {
                        text: `♛ *${character.name}* ha sido regalado a *${receiverName}* por *${senderName}*.`,
                        mentions: [targetId]
                    }, { quoted: m });
                } catch (e) {
                    await m.reply(`> An unexpected error occurred while executing command *${usedPrefix}${commandName}*. Please try again or contact support if the issue persists.\n> [Error: *${e.message}*]`);
                }
            }
        }
    }
};