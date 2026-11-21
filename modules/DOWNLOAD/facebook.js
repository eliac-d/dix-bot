import fetch from 'node-fetch'
import { DAILY_LIMIT_MESSAGE, assertNoLimit, isLimitError } from '../../src/utils/dixLimit.js';

export const facebookDownloadModule = {
    category: 'descargas',
    commands: {
        facebook: {
            name: 'facebook',
            alias: ['fb', 'fbdl'],
            run: async (m, { conn, args }) => {
                if (!args[0]) return m.reply(`*⍰ Ingresa un enlace de Facebook...*`)

                const regexFacebook = /^(https?:\/\/)?(www\.)?(facebook\.com|fb\.watch|fb\.gg)\/[^\s]+$/i
                if (!regexFacebook.test(args[0])) return m.reply(`*ஐ Enlace de Facebook no válido.*`)

                try {
                    if (m.react) await m.react("⏳")

                    const response = await fetch(`https://dix.lat/v1/facebook?url=${encodeURIComponent(args[0])}`, {
                        headers: {
                            'x-api-key': apikey,
                            'Accept': 'application/json'
                        }
                    })

                    const json = assertNoLimit(await response.json())

                    if (!json.success || !json.data || !json.data.data || !Array.isArray(json.data.data) || json.data.data.length === 0) {
                        throw new Error("No data found")
                    }

                    const directMedia = json.data.data.find(item => !item.shouldRender && item.url) || json.data.data[0]

                    if (!directMedia || !directMedia.url) {
                        throw new Error("No direct download link available")
                    }

                    const videoUrl = directMedia.url
                    const quality = directMedia.resolution || "HD"

                    const caption = `\t\t\t 𝗙𝗔𝗖𝗘𝗕𝗢𝗢𝗞 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥\n\n> ღ *Título:* Video de Facebook\n> ✰ *Calidad:* ${quality}\n> ✎ *Enlace:* ${args[0]}\n\n`

                    const videoRes = await fetch(videoUrl, {
                        headers: {
                            'user-agent': 'TelegramBot (like TwitterBot)'
                        }
                    })

                    const videoBuffer = Buffer.from(await videoRes.arrayBuffer())
                    const sizeMB = videoBuffer.length / (1024 * 1024)

                    if (sizeMB > 80) {
                        await conn.sendMessage(m.chat, { 
                            document: videoBuffer, 
                            caption: caption,
                            fileName: `fb_video.mp4`,
                            mimetype: 'video/mp4'
                        }, { quoted: m })
                    } else {
                        await conn.sendMessage(m.chat, { 
                            video: videoBuffer, 
                            caption: caption,
                            fileName: `fb_video.mp4`,
                            mimetype: 'video/mp4'
                        }, { quoted: m })
                    }

                    if (m.react) await m.react("✅")

                } catch (e) {
                    if (m.react) await m.react("❌")
                    if (isLimitError(e)) return m.reply(DAILY_LIMIT_MESSAGE)
                    console.error(e)
                    m.reply(`⍰ No se pudo descargar el contenido.\n\n> Posiblemente es privado o la URL no sea de un video de Facebook.\n> Por favor intenta de nuevo o intenta con otro link.`)
                }
            }
        }
    }
}
