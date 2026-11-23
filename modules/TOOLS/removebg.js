import { readFileSync } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

const pkgPath = join(process.cwd(), 'package.json');
let pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

export const removebgCommand = {
    category: 'tools',
    commands: {
        removebg: {
            name: 'removebg',
            alias: ['sinfondo', 'rmbg'],
            run: async (m, { conn }) => {
                try {
                    const quoted = m.quoted ? m.quoted : m;
                    const mime = (quoted.msg || quoted).mimetype || '';

                    if (!/image/.test(mime)) {
                        return await conn.sendMessage(
                            m.chat,
                            { text: '⚠️ Por favor, responde o envía una imagen para quitarle el fondo.' },
                            { quoted: m }
                        );
                    }

                    

                    let mediaBuffer;
                    if (typeof quoted.download === 'function') {
                        mediaBuffer = await quoted.download();
                    } else if (typeof conn.downloadMediaMessage === 'function') {
                        mediaBuffer = await conn.downloadMediaMessage(quoted);
                    }

                    if (!mediaBuffer || !Buffer.isBuffer(mediaBuffer)) {
                        return await conn.sendMessage(
                            m.chat,
                            { text: '❌ No se pudo descargar el archivo de la imagen.' },
                            { quoted: m }
                        );
                    }

                    const extension = mime.split('/')[1] || 'png';
                    const form = new FormData();
                    form.append('file', mediaBuffer, {
                        filename: `archivo.${extension}`,
                        contentType: mime
                    });

                    const removeBgResponse = await fetch('https://dix.lat/v1/removebg', {
                        method: 'POST',
                        body: form,
                        headers: {
                            ...form.getHeaders(),
                            'x-api-key': apikey
                        }
                    });

                    const removeBgResult = await removeBgResponse.json();

                    if (!removeBgResult || !removeBgResult.success || !removeBgResult.data || !removeBgResult.data.url) {
                        return await conn.sendMessage(
                            m.chat,
                            { text: '❌ No se logró remover el fondo de la imagen proporcionada.' },
                            { quoted: m }
                        );
                    }

                    const resultImageUrl = removeBgResult.data.url;
                    const captionText = `🖼️ *FONDO REMOVIDO*\n\n` +
                                        `• *Plataforma:* ${removeBgResult.platform || 'dix.lat'}\n` +
                                        `• *Tiempo:* ${removeBgResult.meta?.executionTimeMs ?? 'N/A'} ms`;

                    await conn.sendMessage(
                        m.chat,
                        {
                            image: { url: resultImageUrl },
                            caption: captionText
                        },
                        { quoted: m }
                    );

                } catch (error) {
                    const errorReport = `❌ *REPORTE DE ERROR INTERNO*\n\n` +
                                        `• *Módulo:* removebg.js\n` +
                                        `• *Comando:* removebg\n` +
                                        `• *Error:* ${error.message}\n\n` +
                                        `*Trazado de la pila (Stack):*\n\`\`\`${error.stack}\`\`\``;

                    try {
                        await conn.sendMessage(m.chat, { text: errorReport }, { quoted: m });
                    } catch (sendError) {
                        console.error('Incapaz de transmitir el reporte de error al chat de origen:', sendError);
                    }
                }
            }
        }
    }
};
