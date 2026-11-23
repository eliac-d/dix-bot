import fetch from 'node-fetch'
import { DAILY_LIMIT_MESSAGE, assertNoLimit, isLimitError } from '../../src/utils/dixLimit.js';

const getMimeFromFormat = (format) => {
    const map = {
        apk: 'application/vnd.android.package-archive',
        mp4: 'video/mp4',
        mkv: 'video/x-matroska',
        webm: 'video/webm',
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        ogg: 'audio/ogg',
        zip: 'application/zip',
        rar: 'application/x-rar-compressed',
        '7z': 'application/x-7z-compressed',
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif'
    }
    return map[String(format || '').toLowerCase()] || 'application/octet-stream'
}

export const teraboxDownloadModule = {
    category: 'descargas',
    commands: {
        terabox: {
            name: 'terabox',
            alias: ['tb', 'teraboxdl', 'tbox'],
            run: async (m, { conn, args }) => {
                if (!args[0]) return m.reply(`*✰ Ingresa un enlace de Terabox.*`)

                const regexTerabox = /^(https?:\/\/)?(www\.)?(terabox\.com|teraboxapp\.com|terabox\.app|1024terabox\.com|freeterabox\.com|nephobox\.com|4funbox\.com|mirrobox\.com|momerybox\.com|tibibox\.com|landclouddrive\.com)\/s\/[^\s]+$/i
                if (!regexTerabox.test(args[0])) return m.reply(`*ஐ Enlace no válido.*`)

                try {
                    if (m.react) await m.react("⏳")

                    const res = await fetch(`https://dix.lat/v1/d/terabox?url=${encodeURIComponent(args[0])}&apikey=${apikey}`, {
                        headers: {
                            'x-api-key': apikey,
                            'Accept': 'application/json'
                        }
                    })
                    const json = assertNoLimit(await res.json())

                    if (!json.success || !json.data) {
                        throw new Error("No data found")
                    }

                    const d = json.data
                    const caption = `\t\t\t*TERABOX DOWNLOADER*\n\n> ム *Título:* ${d.title || 'N/A'}\n> ღ *Autor:* ${d.author || 'N/A'}\n> ✰ *Link:* ${args[0]}\n`

                    const file = d.files?.[0]
                    const videoItem = d.videos?.[0]
                    const photoItem = d.photos?.[0]
                    const audioItem = d.audios?.[0]

                    if (file) {
                        const fileName = file.title
                            ? `${file.title}.${file.format}`
                            : `${(d.title || 'terabox_file').replace(/\.[^.]+$/, '')}.${file.format}`
                        await conn.sendMessage(m.chat, {
                            document: { url: file.url },
                            mimetype: getMimeFromFormat(file.format),
                            fileName,
                            caption
                        }, { quoted: m })
                    } else if (videoItem) {
                        await conn.sendMessage(m.chat, {
                            video: { url: videoItem.url },
                            caption
                        }, { quoted: m })
                    } else if (audioItem) {
                        await conn.sendMessage(m.chat, {
                            audio: { url: audioItem.url },
                            mimetype: 'audio/mpeg',
                            ptt: false
                        }, { quoted: m })
                        await conn.sendMessage(m.chat, { text: caption }, { quoted: m })
                    } else if (photoItem) {
                        await conn.sendMessage(m.chat, {
                            image: { url: photoItem.url },
                            caption
                        }, { quoted: m })
                    } else {
                        throw new Error("No media found")
                    }

                    if (m.react) await m.react("✅")
                } catch (e) {
                    if (m.react) await m.react("❌")
                    if (isLimitError(e)) return m.reply(DAILY_LIMIT_MESSAGE)
                    console.error(e)
                    m.reply(`⍰ No se pudo descargar el contenido.\n\n> Posiblemente el enlace no sea válido o el archivo sea privado.\n> Por favor intenta de nuevo o intenta con otro link.`)
                }
            }
        }
    }
}