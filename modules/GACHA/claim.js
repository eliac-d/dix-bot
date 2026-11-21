import * as db from '../../database/db_adapter.js';
import {
    loadCharacters,
    getCharacterById,
    getUserById
} from './gacha_utils.js';

export const claimCommand = {
    category: 'gacha',
    commands: {
        claim: {
            name: 'claim',
            alias: ['c', 'reclamar'],
            run: async (m, { conn, args }) => {
                const usedPrefix = m.prefix || (m.text?.match(/^[^\w\s]/) || ['.'])[0];
                const commandName = (m.text || '').trim().slice(usedPrefix.length).split(/\s+/)[0] || 'claim';
                try {

                    let chat = db.getChat(m.chat);

                    db.setCreate('chat_users', [m.chat, m.sender], 'lastClaim', 0);
                    let user = db.getChatUser(m.chat, m.sender);
                    const me = user;
                    const now = Date.now();
                    const claimCooldown = 30 * 60 * 1000;
                    if (me.lastClaim && now < me.lastClaim) {
                        const remaining = Math.ceil((me.lastClaim - now) / 1000);
                        const minutes = Math.floor(remaining / 60);
                        const seconds = remaining % 60;
                        let timeText = '';
                        if (minutes > 0) timeText += `${minutes} minuto${minutes !== 1 ? 's' : ''} `;
                        if (seconds > 0 || timeText === '') timeText += `${seconds} segundo${seconds !== 1 ? 's' : ''}`;
                        return m.reply(`ꕥ Debes esperar *${timeText.trim()}* para usar *${commandName}* de nuevo.`);
                    }
                    const quotedId = m.quoted?.id;
                    if (!quotedId || !chat.rolls || !chat.rolls[quotedId]) {
                        return m.reply(`⳻᷼⳺ Debes citar un personaje válido para reclamar.`);
                    }
                    const rollData = chat.rolls[quotedId];
                    const id = rollData.id;
                    const charKey = rollData.charKey || (m.chat + '__' + id);

                    const structure = await loadCharacters();
                    const sourceData = getCharacterById(id, structure);
                    if (!sourceData) return m.reply('★ Personaje no encontrado en characters.json');

                    db.setCreate('characters', charKey, 'name', sourceData.name);
                    let character = db.getCharacter(charKey);
                    if (!character) character = { id: charKey, name: sourceData.name, value: sourceData.value || 0, votes: 0 };

                    if (character.reservedBy && character.reservedBy !== m.sender && now < character.reservedUntil) {
                        const reserver = getUserById(character.reservedBy);
                        const reserverName = reserver?.name || character.reservedBy.split('@')[0];
                        const remaining = ((character.reservedUntil - now) / 1000).toFixed(1);
                        return m.reply(`♛ Este personaje está protegido por *${reserverName}* durante *${remaining}s.*`);
                    }
                    if (character.expiresAt && now > character.expiresAt && !character.user && !(character.reservedBy && now < character.reservedUntil)) {
                        const expiredTime = ((now - character.expiresAt) / 1000).toFixed(1);
                        return m.reply(`✘ El personaje ha expirado » ${expiredTime}s.`);
                    }
                    if (character.user) {
                        const owner = getUserById(character.user);
                        const ownerName = owner?.name || `@${character.user.split('@')[0]}`;
                        return m.reply(`♛ El personaje *${character.name}* ya ha sido reclamado por *${ownerName}*`);
                    }
                    character.user = m.sender;
                    character.claimedAt = now;
                    delete character.reservedBy;
                    delete character.reservedUntil;
                    db.setCharacter(charKey, character);

                    if (!Array.isArray(me.characters)) me.characters = [];
                    if (!me.characters.includes(id)) me.characters.push(id);
                    db.setChatUser(m.chat, m.sender, 'characters', me.characters);
                    db.setChatUser(m.chat, m.sender, 'lastClaim', now + claimCooldown);
                    chat.rolls[quotedId].claimed = true;
                    db.setChat(m.chat, 'rolls', chat.rolls);
                    const userGlobal = getUserById(m.sender);
                    const displayName = userGlobal?.name || m.sender.split('@')[0];
                    db.setCreate('users', m.sender, 'claimMessage', '');
                    const userWithMessage = getUserById(m.sender);
                    const custom = userWithMessage?.claimMessage;
                    const duration = character.expiresAt ? ((now - character.expiresAt + 60000) / 1000).toFixed(1) : '0.0';
                    const finalMessage = custom
                        ? custom.replace(/€user/g, `*${displayName}*`).replace(/€character/g, `*${character.name}*`)
                        : `*${character.name}* ha sido reclamado por *${displayName}*`;
                    await conn.sendMessage(m.chat, { text: `×͜× ${finalMessage} _(${duration}s)_` }, { quoted: m });
                } catch (e) {
                    await m.reply(`> An unexpected error occurred while executing command *${usedPrefix}${commandName}*. Please try again or contact support if the issue persists.\n> [Error: *${e.message}*]`);
                }
            }
        }
    }
};