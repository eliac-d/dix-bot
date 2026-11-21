import * as db from '../../database/db_adapter.js';
import {
    loadCharacters,
    flattenCharacters,
    getSeriesNameByCharacter
} from './gacha_utils.js';

export const voteCommand = {
    category: 'gacha',
    commands: {
        vote: {
            name: 'vote',
            alias: ['votar'],
            run: async (m, { conn, args }) => {
                const usedPrefix = m.prefix || (m.text?.match(/^[^\w\s]/) || ['.'])[0];
                const commandName = (m.text || '').trim().slice(usedPrefix.length).split(/\s+/)[0] || 'vote';
                try {
                    let chat = db.getChat(chatId);
                    
                    db.setCreate('chat_users', [m.chat, m.sender], 'lastVote', 0);
                    const user = db.getChatUser(m.chat, m.sender);
                    const now = Date.now();
                    const cooldown = 1 * 60 * 60 * 1000;

                    if (user.lastVote && now < user.lastVote) {
                        const timeLeft = Math.ceil((user.lastVote - now) / 1000);
                        const hours = Math.floor(timeLeft / 3600);
                        const minutes = Math.floor((timeLeft % 3600) / 60);
                        const seconds = timeLeft % 60;
                        let timeText = '';
                        if (hours > 0) timeText += `${hours} hora${hours !== 1 ? 's' : ''} `;
                        if (minutes > 0) timeText += `${minutes} minuto${minutes !== 1 ? 's' : ''} `;
                        if (seconds > 0 || timeText === '') timeText += `${seconds} segundo${seconds !== 1 ? 's' : ''}`;
                        return m.reply(`✰ Debes esperar *${timeText.trim()}* para usar *${commandName}* de nuevo.`);
                    }

                    const name = args.join(' ').trim();
                    if (!name) return m.reply('✎ Debes especificar un personaje para votarlo.');

                    const structure = await loadCharacters();
                    const allCharacters = flattenCharacters(structure);
                    const character = allCharacters.find(c => String(c.name || '').toLowerCase() === name.toLowerCase());

                    if (!character) {
                        return m.reply(`×᷼× Personaje no encontrado. Asegúrate de que el nombre esté correcto.`);
                    }

                    const charId = String(character.id);
                    let characterData = db.getCharacter(charId);

                    if (!characterData) {
                        characterData = { name: character.name, value: Number(character.value || 0), votes: 0, dailyIncrement: {} };
                    }
                    if (!characterData.dailyIncrement) characterData.dailyIncrement = {};

                    if (characterData.lastVotedAt && now < characterData.lastVotedAt + cooldown) {
                        const remaining = characterData.lastVotedAt + cooldown - now;
                        const totalSec = Math.ceil(remaining / 1000);
                        const h = Math.floor(totalSec / 3600);
                        const m_ = Math.floor((totalSec % 3600) / 60);
                        const s = totalSec % 60;
                        let timeText = '';
                        if (h > 0) timeText += `${h} hora${h !== 1 ? 's' : ''} `;
                        if (m_ > 0) timeText += `${m_} minuto${m_ !== 1 ? 's' : ''} `;
                        if (s > 0 || timeText === '') timeText += `${s} segundo${s !== 1 ? 's' : ''}`;
                        return m.reply(`⍰ *${characterData.name}* ha sido votada recientemente.\n> Debes esperar *${timeText.trim()}* para votarla de nuevo.`);
                    }

                    const today = new Date().toISOString().slice(0, 10);
                    const currentValue = characterData.dailyIncrement[today] || 0;
                    const increment = Math.min(900 - currentValue, Math.floor(Math.random() * 201) + 50);

                    if (increment >= 20500) {
                        return m.reply(`➫ El personaje *${characterData.name}* ya tiene el valor máximo.`);
                    }

                    characterData.value = (characterData.value || 0) + increment;
                    characterData.votes = (characterData.votes || 0) + 1;
                    characterData.lastVotedAt = now;
                    characterData.dailyIncrement[today] = currentValue + increment;

                    db.setCharacter(charId, characterData);
                    db.setChatUser(m.chat, m.sender, 'lastVote', now + cooldown);

                    const source = getSeriesNameByCharacter(structure, character.id);
                    await m.reply(`♕➫ Votaste por *${characterData.name}*\n> Su nuevo valor es *${characterData.value}*`);
                } catch (e) {
                    await m.reply(`> An unexpected error occurred while executing command *${usedPrefix}${commandName}*. Please try again or contact support if the issue persists.\n> [Error: *${e.message}*]`);
                }
            }
        }
    }
};