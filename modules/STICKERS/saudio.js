import {
        prepareWAMessageMedia,
        proto,
        downloadMediaMessage,
        downloadContentFromMessage
} from '@whiskeysockets/baileys'

import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const execFileAsync = promisify(execFile)
const DURACION_MAXIMA = 25
const SEGUNDOS_SESION = 60

if (!globalThis.__audioStickerSessions) {
        globalThis.__audioStickerSessions = new Map()
}

const sesiones = globalThis.__audioStickerSessions

function modificarProto(p) {
        const M = p?.Message
        if (!M || M.__audioStickerPatchedV3) return

        if (M.StickerMessage) {
                const codificarStickerAnterior = M.StickerMessage.encode

                M.StickerMessage.encode = function (mensaje, writer) {
                        const audio = mensaje?.audioMessage

                        if (audio && Object.prototype.hasOwnProperty.call(mensaje, 'audioMessage')) {
                                delete mensaje.audioMessage
                        }

                        const w = codificarStickerAnterior.call(this, mensaje, writer)

                        if (audio && M.AudioMessage) {
                                mensaje.audioMessage = audio
                                M.AudioMessage.encode(audio, w.uint32(210).fork()).ldelim()
                        }

                        return w
                }

                if (typeof M.StickerMessage.fromObject === 'function') {
                        const convertirStickerAnterior = M.StickerMessage.fromObject

                        M.StickerMessage.fromObject = function (objeto) {
                                const mensaje = convertirStickerAnterior.call(this, objeto)

                                if (objeto?.audioMessage) {
                                        mensaje.audioMessage = M.AudioMessage?.fromObject
                                                ? M.AudioMessage.fromObject(objeto.audioMessage)
                                                : objeto.audioMessage
                                }

                                return mensaje
                        }
                }
        }

        const codificarMensajeAnterior = M.encode

        M.encode = function (mensaje, writer) {
                const audioSticker = mensaje?.audioStickerMessage

                if (audioSticker) {
                        if (Object.prototype.hasOwnProperty.call(mensaje, 'stickerMessage')) {
                                delete mensaje.stickerMessage
                        }

                        if (Object.prototype.hasOwnProperty.call(mensaje, 'audioStickerMessage')) {
                                delete mensaje.audioStickerMessage
                        }
                }

                const w = codificarMensajeAnterior.call(this, mensaje, writer)

                if (audioSticker && M.FutureProofMessage) {
                        mensaje.audioStickerMessage = audioSticker
                        M.FutureProofMessage.encode(audioSticker, w.uint32(1074).fork()).ldelim()
                }

                return w
        }

        if (typeof M.fromObject === 'function') {
                const convertirMensajeAnterior = M.fromObject

                M.fromObject = function (objeto) {
                        const mensaje = convertirMensajeAnterior.call(this, objeto)

                        if (objeto?.audioStickerMessage) {
                                const interno = objeto.audioStickerMessage.message || objeto.audioStickerMessage

                                if (interno?.stickerMessage && objeto.audioStickerMessage.message?.stickerMessage?.audioMessage) {
                                        interno.stickerMessage.audioMessage = objeto.audioStickerMessage.message.stickerMessage.audioMessage
                                }

                                mensaje.audioStickerMessage = { message: interno }
                                delete mensaje.stickerMessage

                                if (interno) {
                                        Object.setPrototypeOf(mensaje, interno)
                                }
                        }

                        return mensaje
                }
        }

        M.__audioStickerPatchedV3 = true
}

async function asegurarModificado() {
        modificarProto(proto)

        for (const paquete of ['kage-baileys', '@whiskeysockets/baileys', 'baileys']) {
                try {
                        const modulo = await import(paquete)

                        if (modulo?.proto) modificarProto(modulo.proto)
                        if (modulo?.default?.proto) modificarProto(modulo.default.proto)
                } catch {}
        }
}

function obtenerClaveSesion(m) {
        return `${m.chat}:${m.sender}`
}

function eliminarSesion(clave) {
        const existente = sesiones.get(clave)

        if (existente?.timer) {
                clearTimeout(existente.timer)
        }

        sesiones.delete(clave)
}

function desenvolverMensaje(raw) {
        let actual = raw

        for (let i = 0; i < 6 && actual; i++) {
                const siguiente =
                        actual.ephemeralMessage?.message ||
                        actual.viewOnceMessageV2?.message ||
                        actual.viewOnceMessageV2Extension?.message ||
                        actual.viewOnceMessage?.message ||
                        actual.documentWithCaptionMessage?.message ||
                        actual.editedMessage?.message

                if (!siguiente) break
                actual = siguiente
        }

        return actual || {}
}

function detectarMedia(nodo) {
        if (!nodo) {
                return {
                        kind: null,
                        mime: '',
                        seconds: 0,
                        mediaObj: null,
                        dlType: null
                }
        }

        const contenedor = desenvolverMensaje(nodo.message || nodo.fakeObj?.message || {})

        const tipo =
                nodo.mtype ||
                nodo.type ||
                Object.keys(contenedor).find(k =>
                        /imageMessage|videoMessage|stickerMessage|audioMessage|documentMessage/i.test(k)
                ) ||
                ''

        const mensajeDirecto =
                nodo.msg && typeof nodo.msg === 'object' &&
                (nodo.msg.mediaKey || nodo.msg.url || nodo.msg.directPath || nodo.msg.mimetype)
                        ? nodo.msg
                        : null

        const mediaObj =
                mensajeDirecto ||
                contenedor[tipo] ||
                contenedor.videoMessage ||
                contenedor.imageMessage ||
                contenedor.stickerMessage ||
                contenedor.audioMessage ||
                contenedor.documentMessage ||
                (nodo.mediaKey || nodo.url || nodo.directPath ? nodo : null)

        const mime = String(nodo.mimetype || mediaObj?.mimetype || '').toLowerCase()
        const segundos = Number(mediaObj?.seconds || nodo.seconds || nodo.msg?.seconds || 0)

        if (/video/i.test(mime) || /videoMessage/i.test(tipo)) {
                const dlType = /documentMessage/i.test(tipo) ? 'document' : 'video'

                return {
                        kind: 'video',
                        mime: mime || 'video/mp4',
                        seconds: segundos,
                        mediaObj,
                        dlType
                }
        }

        if (/webp/i.test(mime) || /stickerMessage/i.test(tipo)) {
                return {
                        kind: 'webp',
                        mime: 'image/webp',
                        seconds: segundos,
                        isAnimated: Boolean(mediaObj?.isAnimated),
                        mediaObj,
                        dlType: 'sticker'
                }
        }

        if (/image/i.test(mime) || /imageMessage/i.test(tipo)) {
                const dlType = /documentMessage/i.test(tipo) ? 'document' : 'image'

                return {
                        kind: 'image',
                        mime: mime || 'image/jpeg',
                        seconds: 0,
                        mediaObj,
                        dlType
                }
        }

        if (/audio|ogg|opus|mpeg|mp3|wav|m4a|aac/i.test(mime) || /audioMessage/i.test(tipo)) {
                const dlType = /documentMessage/i.test(tipo) ? 'document' : 'audio'

                return {
                        kind: 'audio',
                        mime: mime || 'audio/mpeg',
                        seconds: segundos,
                        mediaObj,
                        dlType
                }
        }

        return {
                kind: null,
                mime: '',
                seconds: 0,
                mediaObj: null,
                dlType: null
        }
}

async function descargarBuffer(nodo, info, cliente) {
        if (!nodo) return null

        if (
                info?.mediaObj &&
                info?.dlType &&
                (info.mediaObj.mediaKey || info.mediaObj.directPath || info.mediaObj.url)
        ) {
                try {
                        const flujo = await downloadContentFromMessage(info.mediaObj, info.dlType)
                        const fragmentos = []

                        for await (const fragmento of flujo) {
                                fragmentos.push(fragmento)
                        }

                        const buffer = Buffer.concat(fragmentos)

                        if (buffer.length) return buffer
                } catch {}
        }

        if (nodo.fakeObj?.message || nodo.message) {
                try {
                        const objetoMensaje = nodo.fakeObj?.message ? nodo.fakeObj : nodo

                        const buffer = await downloadMediaMessage(
                                objetoMensaje,
                                'buffer',
                                {},
                                {
                                        logger: {
                                                info: () => {},
                                                error: () => {},
                                                warn: () => {}
                                        },
                                        reuploadRequest: cliente?.updateMediaMessage
                                }
                        )

                        if (buffer?.length) return buffer
                } catch {}
        }

        if (info?.mediaObj && info?.dlType) {
                try {
                        const sintetico = {
                                key: nodo.key || {
                                        remoteJid: nodo.chat || 'status@broadcast',
                                        id: '0'
                                },
                                message: {
                                        [`${info.dlType}Message`]: info.mediaObj
                                }
                        }

                        const buffer = await downloadMediaMessage(
                                sintetico,
                                'buffer',
                                {},
                                {
                                        logger: {
                                                info: () => {},
                                                error: () => {},
                                                warn: () => {}
                                        },
                                        reuploadRequest: cliente?.updateMediaMessage
                                }
                        )

                        if (buffer?.length) return buffer
                } catch {}
        }

        if (typeof nodo.download === 'function') {
                try {
                        const buffer = await nodo.download()

                        if (buffer?.length) return buffer
                } catch {}
        }

        return null
}

function crearExif(packname, author) {
        const json = {
                'sticker-pack-id': 'com.alya.ai.audiosticker',
                'sticker-pack-name': String(packname ?? ''),
                'sticker-pack-publisher': String(author ?? ''),
                emojis: ['🔊']
        }

        const atributoExif = Buffer.from([
                0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
                0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x16, 0x00, 0x00, 0x00
        ])

        const bufferJson = Buffer.from(JSON.stringify(json), 'utf-8')
        const exif = Buffer.concat([atributoExif, bufferJson])

        exif.writeUIntLE(bufferJson.length, 14, 4)

        return exif
}

function insertarExifWebp(webpBuffer, datosExif) {
        if (
                !Buffer.isBuffer(webpBuffer) ||
                webpBuffer.length < 16 ||
                webpBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
                webpBuffer.toString('ascii', 8, 12) !== 'WEBP'
        ) {
                return webpBuffer
        }

        const fragmentos = []
        let offset = 12
        let tieneVp8x = false
        let esAnimado = false

        while (offset + 8 <= webpBuffer.length) {
                const id = webpBuffer.toString('ascii', offset, offset + 4)
                const size = webpBuffer.readUInt32LE(offset + 4)
                const acolchado = size + (size % 2)
                const final = Math.min(webpBuffer.length, offset + 8 + acolchado)
                const fragmento = Buffer.from(webpBuffer.subarray(offset, final))

                if (id === 'VP8X') tieneVp8x = true
                if (id === 'ANIM' || id === 'ANMF') esAnimado = true

                if (id !== 'EXIF') {
                        fragmentos.push({
                                id,
                                fragmento
                        })
                }

                offset = final
        }

        if (!tieneVp8x) {
                const vp8x = Buffer.alloc(18)

                vp8x.write('VP8X', 0, 4, 'ascii')
                vp8x.writeUInt32LE(10, 4)
                vp8x[8] = 0x18
                vp8x.writeUIntLE(511, 12, 3)
                vp8x.writeUIntLE(511, 15, 3)

                fragmentos.unshift({
                        id: 'VP8X',
                        fragmento: vp8x
                })
        } else {
                const entradaVp8x = fragmentos.find(f => f.id === 'VP8X')

                if (entradaVp8x && entradaVp8x.fragmento.length >= 18) {
                        entradaVp8x.fragmento[8] |= 0x08

                        if (esAnimado) {
                                entradaVp8x.fragmento[8] |= 0x02
                        }
                }
        }

        const byteRelleno = datosExif.length % 2 === 1
                ? Buffer.from([0x00])
                : Buffer.alloc(0)

        const encabezadoExif = Buffer.alloc(8)

        encabezadoExif.write('EXIF', 0, 4, 'ascii')
        encabezadoExif.writeUInt32LE(datosExif.length, 4)

        fragmentos.push({
                id: 'EXIF',
                fragmento: Buffer.concat([encabezadoExif, datosExif, byteRelleno])
        })

        const cuerpo = Buffer.concat(fragmentos.map(f => f.fragmento))
        const encabezado = Buffer.alloc(12)

        encabezado.write('RIFF', 0, 4, 'ascii')
        encabezado.writeUInt32LE(cuerpo.length + 4, 4)
        encabezado.write('WEBP', 8, 4, 'ascii')

        return Buffer.concat([encabezado, cuerpo])
}

async function agregarExif(bufferWebp, packname, author) {
        const datosExif = crearExif(packname, author)

        try {
                const moduloWebp = await import('node-webpmux')
                const WebpImage = moduloWebp.default?.Image || moduloWebp.Image || moduloWebp.default

                if (WebpImage) {
                        const imagen = new WebpImage()

                        await imagen.load(bufferWebp)

                        imagen.exif = datosExif

                        return await imagen.save(null)
                }
        } catch {}

        return insertarExifWebp(bufferWebp, datosExif)
}

function esWebpAnimado(buffer) {
        if (!Buffer.isBuffer(buffer) || buffer.length < 22) return false

        if (
                buffer.toString('ascii', 12, 16) === 'VP8X' &&
                (buffer[20] & 0x02) !== 0
        ) {
                return true
        }

        return buffer.includes(Buffer.from('ANIM'))
}

async function convertirVideoWebp(buffer) {
        const idTemporal = randomBytes(6).toString('hex')

        const rutaEntrada = path.join(os.tmpdir(), `as_vid_${idTemporal}.mp4`)
        const rutaSalida = path.join(os.tmpdir(), `as_out_${idTemporal}.webp`)

        const intentarCodificacion = async (fps, calidad) => {
                await execFileAsync('ffmpeg', [
                        '-y',
                        '-i', rutaEntrada,
                        '-t', String(DURACION_MAXIMA),
                        '-vf', `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1`,
                        '-c:v', 'libwebp',
                        '-lossless', '0',
                        '-compression_level', '6',
                        '-q:v', String(calidad),
                        '-loop', '0',
                        '-preset', 'picture',
                        '-an',
                        '-vsync', '0',
                        rutaSalida
                ])

                return await fs.readFile(rutaSalida)
        }

        try {
                await fs.writeFile(rutaEntrada, buffer)

                const perfiles = [
                        [10, 50],
                        [8, 36],
                        [6, 24],
                        [5, 16]
                ]

                let webp = null

                for (const [fps, calidad] of perfiles) {
                        webp = await intentarCodificacion(fps, calidad)

                        if (webp.length <= 880 * 1024) break
                }

                return webp
        } finally {
                await fs.unlink(rutaEntrada).catch(() => {})
                await fs.unlink(rutaSalida).catch(() => {})
        }
}

async function convertirImagenWebp(buffer) {
        try {
                const sharp = (await import('sharp')).default

                return await sharp(buffer, { animated: true })
                        .rotate()
                        .resize(512, 512, {
                                fit: 'contain',
                                background: {
                                        r: 0,
                                        g: 0,
                                        b: 0,
                                        alpha: 0
                                }
                        })
                        .webp({ quality: 82 })
                        .toBuffer()
        } catch {
                const idTemporal = randomBytes(6).toString('hex')

                const rutaEntrada = path.join(os.tmpdir(), `as_img_${idTemporal}.jpg`)
                const rutaSalida = path.join(os.tmpdir(), `as_img_out_${idTemporal}.webp`)

                try {
                        await fs.writeFile(rutaEntrada, buffer)

                        await execFileAsync('ffmpeg', [
                                '-y',
                                '-i', rutaEntrada,
                                '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1',
                                '-c:v', 'libwebp',
                                '-lossless', '0',
                                '-q:v', '80',
                                '-an',
                                rutaSalida
                        ])

                        return await fs.readFile(rutaSalida)
                } finally {
                        await fs.unlink(rutaEntrada).catch(() => {})
                        await fs.unlink(rutaSalida).catch(() => {})
                }
        }
}

async function crearStickerConExif(buffer, tipo, packname, author) {
        let webpOriginal = buffer

        if (tipo === 'video') {
                webpOriginal = await convertirVideoWebp(buffer)
        } else if (tipo === 'image') {
                webpOriginal = await convertirImagenWebp(buffer)
        }

        return await agregarExif(webpOriginal, packname, author)
}

function obtenerDuracionFfmpeg(textoError) {
        const coincidencias = [
                ...String(textoError || '').matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)
        ]

        if (!coincidencias.length) return 0

        const ultima = coincidencias[coincidencias.length - 1]

        const segundos =
                Number(ultima[1]) * 3600 +
                Number(ultima[2]) * 60 +
                Number(ultima[3])

        return Number.isFinite(segundos) ? segundos : 0
}

function generarFormaDeOnda(bufferBase, longitud = 64) {
        const forma = Buffer.alloc(longitud)

        for (let i = 0; i < longitud; i++) {
                const byte = bufferBase && bufferBase.length
                        ? bufferBase[(i * 19 + 7) % bufferBase.length]
                        : i * 11

                forma[i] = 18 + (byte % 76)
        }

        return forma
}

async function convertirAOggOpus(buffer, extension = 'mp3') {
        const idTemporal = randomBytes(6).toString('hex')

        const rutaEntrada = path.join(os.tmpdir(), `ptt_in_${idTemporal}.${extension}`)
        const rutaSalida = path.join(os.tmpdir(), `ptt_out_${idTemporal}.ogg`)

        try {
                await fs.writeFile(rutaEntrada, buffer)

                const { stderr } = await execFileAsync('ffmpeg', [
                        '-y',
                        '-i', rutaEntrada,
                        '-vn',
                        '-map', '0:a:0',
                        '-t', String(DURACION_MAXIMA),
                        '-af', 'aresample=48000:async=1:first_pts=0',
                        '-c:a', 'libopus',
                        '-b:a', '48k',
                        '-vbr', 'on',
                        '-compression_level', '10',
                        '-ac', '1',
                        '-ar', '48000',
                        '-application', 'audio',
                        '-avoid_negative_ts', 'make_zero',
                        '-f', 'ogg',
                        rutaSalida
                ])

                const bufferOgg = await fs.readFile(rutaSalida)

                if (!bufferOgg || bufferOgg.length < 200) {
                        throw new Error('El archivo de audio está vacío o es demasiado corto.')
                }

                const duracionReal = obtenerDuracionFfmpeg(stderr)

                return {
                        oggBuffer: bufferOgg,
                        realSeconds: duracionReal
                }
        } finally {
                await fs.unlink(rutaEntrada).catch(() => {})
                await fs.unlink(rutaSalida).catch(() => {})
        }
}

async function crearMensajeAudio(cliente, buffer, extension, segundosAlternativos = 0) {
        const { oggBuffer, realSeconds } = await convertirAOggOpus(buffer, extension)

        const { audioMessage } = await prepareWAMessageMedia(
                {
                        audio: oggBuffer,
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: true
                },
                {
                        upload: cliente.waUploadToServer
                }
        )

        const segundosElegidos =
                realSeconds > 0
                        ? realSeconds
                        : segundosAlternativos > 0
                                ? segundosAlternativos
                                : 5

        const segundosFinales = Math.max(
                1,
                Math.min(DURACION_MAXIMA, Math.round(segundosElegidos))
        )

        audioMessage.seconds = segundosFinales
        audioMessage.ptt = true
        audioMessage.mimetype = 'audio/ogg; codecs=opus'

        if (!audioMessage.waveform || !audioMessage.waveform.length) {
                audioMessage.waveform = generarFormaDeOnda(oggBuffer)
        }

        return audioMessage
}

async function enviarStickerConAudio(cliente, chat, bufferSticker, animado, mensajeAudio) {
        await asegurarModificado()

        const preparado = await prepareWAMessageMedia(
                {
                        sticker: bufferSticker,
                        isAnimated: animado
                },
                {
                        upload: cliente.waUploadToServer
                }
        )

        preparado.stickerMessage.isAnimated = Boolean(animado)
        preparado.stickerMessage.audioMessage = mensajeAudio

        const carga = {
                __proto__: preparado,
                audioStickerMessage: {
                        message: preparado
                },
                messageContextInfo: {
                        messageSecret: randomBytes(32)
                }
        }

        await cliente.relayMessage(chat, carga, {})
}

function iniciarSesionSticker({
        m,
        client,
        send,
        stickerBuffer,
        isAnimated,
        packname,
        author,
        usedPrefix,
        command
}) {
        const clave = obtenerClaveSesion(m)

        eliminarSesion(clave)

        const timer = setTimeout(() => {
                if (sesiones.has(clave)) {
                        sesiones.delete(clave)

                        if (client?.sendMessage) {
                                client.sendMessage(
                                        m.chat,
                                        {
                                                text:
                                                        `⏰ *SESIÓN DE AUDIO STICKER FINALIZADA*\n` +
                                                        `> _El tiempo de espera de ${SEGUNDOS_SESION} segundos ha terminado. Envía nuevamente la foto si deseas crear otro Audio Sticker._`
                                        },
                                        {
                                                quoted: m
                                        }
                                ).catch(() => {})
                        }
                }
        }, SEGUNDOS_SESION * 1000)

        sesiones.set(clave, {
                stickerBuffer,
                isAnimated,
                packname,
                author,
                expiresAt: Date.now() + SEGUNDOS_SESION * 1000,
                processing: false,
                timer
        })

        return send(
                `✦ *SESIÓN DE AUDIO STICKER ACTIVADA* ✦\n` +
                `> _La imagen del sticker se ha guardado temporalmente en la sesión._\n\n` +
                `╭─「 *DETALLES DE LA SESIÓN* 」\n` +
                `│ ◦ *Paquete* : *${packname}*\n` +
                `│ ◦ *Autor* : *${author}*\n` +
                `│ ◦ *Tipo* : \`${isAnimated ? 'GIF animado' : 'Imagen estática'}\`\n` +
                `│ ◦ *Duración máxima del audio* : \`${DURACION_MAXIMA} segundos\`\n` +
                `│ ◦ *Tiempo de espera* : \`${SEGUNDOS_SESION} segundos\`\n` +
                `╰───────────────\n\n` +
                `╭─「 *SIGUIENTE PASO* 」\n` +
                `│ 1. Envía un *Audio MP3 / Nota de voz / Video* a este chat.\n` +
                `│ 2. También puedes responder a un audio con \`${usedPrefix}${command}\`.\n` +
                `│ 3. Escribe \`${usedPrefix}${command} cancelar\` para cancelar.\n` +
                `╰───────────────`
        )
}

async function consumirSesionConAudio(m, client, send, react, session, audioNode, audioInfo) {
        const clave = obtenerClaveSesion(m)

        session.processing = true

        await react('⏳')

        try {
                const audioBuffer = await descargarBuffer(audioNode, audioInfo, client)

                if (!audioBuffer || !audioBuffer.length) {
                        throw new Error('No se pudo descargar el archivo de audio o video.')
                }

                const extension =
                        audioInfo.kind === 'video'
                                ? 'mp4'
                                : /ogg|opus/i.test(audioInfo.mime)
                                        ? 'ogg'
                                        : /mp4|m4a|aac/i.test(audioInfo.mime)
                                                ? 'm4a'
                                                : 'mp3'

                const mensajeAudio = await crearMensajeAudio(
                        client,
                        audioBuffer,
                        extension,
                        audioInfo.seconds
                )

                await enviarStickerConAudio(
                        client,
                        m.chat,
                        session.stickerBuffer,
                        session.isAnimated,
                        mensajeAudio
                )

                eliminarSesion(clave)

                await react('✅')
        } catch (error) {
                session.processing = false

                console.error('[ERROR SESIÓN AUDIO STICKER]', error)

                await react('❌')

                await send(
                        `❌ No se pudo combinar el audio con el sticker: ${error?.message || String(error)}`
                )
        }
}

async function ejecutarComandoAudioSticker(m, extra = {}) {
        const {
                sock,
                conn,
                text,
                reply,
                usedPrefix = '.',
                command = 'audiosticker'
        } = extra

        const client = sock || conn || m.conn || global.conn || global.sock

        const send = reply || (
                texto => client.sendMessage(
                        m.chat,
                        { text: texto },
                        { quoted: m }
                )
        )

        const react = async emoji => {
                if (client?.sendMessage) {
                        await client.sendMessage(
                                m.chat,
                                {
                                        react: {
                                                text: emoji,
                                                key: m.key
                                        }
                                }
                        ).catch(() => {})
                }
        }

        const clave = obtenerClaveSesion(m)
        const sesionActiva = sesiones.get(clave)
        const textoIngresado = String(text || '').trim()

        if (/^(cancelar|cancel|batal|stop)$/i.test(textoIngresado)) {
                if (!sesionActiva) {
                        return send('⚠️ No hay ninguna sesión de Audio Sticker activa.')
                }

                eliminarSesion(clave)

                await react('✅')

                return send('✅ La sesión de Audio Sticker se ha cancelado correctamente.')
        }

        const infoPropia = detectarMedia(m)
        const citado = m.quoted
        const infoCitada = detectarMedia(citado)

        const tieneVisualPropio =
                infoPropia.kind === 'video' ||
                infoPropia.kind === 'image' ||
                infoPropia.kind === 'webp'

        const tieneVisualCitado =
                infoCitada.kind === 'video' ||
                infoCitada.kind === 'image' ||
                infoCitada.kind === 'webp'

        const tieneAudioPropio = infoPropia.kind === 'audio'
        const tieneAudioCitado = infoCitada.kind === 'audio'

        if (
                sesionActiva &&
                !sesionActiva.processing &&
                (tieneAudioPropio || tieneAudioCitado) &&
                !tieneVisualPropio
        ) {
                const nodoAudio = tieneAudioPropio ? m : citado
                const infoAudio = tieneAudioPropio ? infoPropia : infoCitada

                return await consumirSesionConAudio(
                        m,
                        client,
                        send,
                        react,
                        sesionActiva,
                        nodoAudio,
                        infoAudio
                )
        }

        if (
                !tieneVisualPropio &&
                !tieneVisualCitado &&
                !tieneAudioPropio &&
                !tieneAudioCitado
        ) {
                if (sesionActiva) {
                        const segundosRestantes = Math.max(
                                1,
                                Math.ceil((sesionActiva.expiresAt - Date.now()) / 1000)
                        )

                        return send(
                                `⏳ *SESIÓN ACTIVA (${segundosRestantes} SEGUNDOS)*\n\n` +
                                `Envía un *Audio MP3 / Nota de voz* o responde a un audio con \`${usedPrefix}${command}\`.\n` +
                                `Escribe \`${usedPrefix}${command} cancelar\` para cancelar la sesión.`
                        )
                }

                return send(
                        `✦ *GENERADOR DE AUDIO STICKER* ✦\n` +
                        `> _Crea stickers de imágenes o GIF animados que reproducen sonido al tocarlos._\n\n` +
                        `╭─「 *CÓMO USARLO (FOTOS)* 」\n` +
                        `│ 1. Envía o responde a una *Foto* con \`${usedPrefix}${command}\`.\n` +
                        `│ 2. El bot activará una sesión durante *${SEGUNDOS_SESION} segundos*.\n` +
                        `│ 3. Envía un *Audio MP3 / Nota de voz* (máximo ${DURACION_MAXIMA} segundos).\n` +
                        `╰───────────────\n\n` +
                        `╭─「 *CÓMO USARLO (VIDEOS)* 」\n` +
                        `│ ◦ Envía o responde a un *Video* (máximo ${DURACION_MAXIMA} segundos) con \`${usedPrefix}${command}\`.\n` +
                        `│ ◦ Se convertirá automáticamente en un GIF animado con el sonido del video.\n` +
                        `│ ◦ Personalizar paquete: \`${usedPrefix}${command} NombreDelPack|Autor\`.\n` +
                        `╰───────────────`
                )
        }

        if (
                !tieneVisualPropio &&
                !tieneVisualCitado &&
                (tieneAudioPropio || tieneAudioCitado)
        ) {
                return send(
                        `⚠️ *NO SE HA SELECCIONADO UNA FOTO O STICKER*\n\n` +
                        `Primero envía o responde a una *Foto / Sticker* con el comando \`${usedPrefix}${command}\`. Después tendrás *${SEGUNDOS_SESION} segundos* para enviar el audio.`
                )
        }

        await react('⏳')

        try {
                await asegurarModificado()

                const [paquetePersonalizado, autorPersonalizado] = textoIngresado.includes('|')
                        ? textoIngresado.split('|').map(s => s.trim())
                        : [textoIngresado, '']

                const packname =
                        paquetePersonalizado ||
                        global.packname ||
                        global.stickpack ||
                        global.name() ||
                        ''

                const author =
                        autorPersonalizado ||
                        global.author ||
                        global.stickauth ||
                        global.namaOwner ||
                        m.pushName ||
                        'Sticker'

                const nodoVisual = tieneVisualPropio ? m : citado
                const infoVisual = tieneVisualPropio ? infoPropia : infoCitada

                const esVideo = infoVisual.kind === 'video'
                const duracionVideo = infoVisual.seconds || 0

                if (esVideo && duracionVideo > DURACION_MAXIMA) {
                        await react('❌')

                        return send(
                                `⚠️ La duración máxima del video para crear un Audio Sticker es de *${DURACION_MAXIMA} segundos*.`
                        )
                }

                const datosVisuales = await descargarBuffer(
                        nodoVisual,
                        infoVisual,
                        client
                )

                if (!datosVisuales || !datosVisuales.length) {
                        throw new Error('No se pudo descargar el archivo de imagen o video.')
                }

                const stickerBuffer = await crearStickerConExif(
                        datosVisuales,
                        infoVisual.kind,
                        packname,
                        author
                )

                const esAnimado =
                        esVideo || esWebpAnimado(stickerBuffer)

                if (tieneVisualPropio && tieneAudioCitado) {
                        const audioBuffer = await descargarBuffer(
                                citado,
                                infoCitada,
                                client
                        )

                        if (!audioBuffer || !audioBuffer.length) {
                                throw new Error('No se pudo descargar el audio citado.')
                        }

                        const extension =
                                /ogg|opus/i.test(infoCitada.mime)
                                        ? 'ogg'
                                        : /mp4|m4a|aac/i.test(infoCitada.mime)
                                                ? 'm4a'
                                                : 'mp3'

                        const mensajeAudio = await crearMensajeAudio(
                                client,
                                audioBuffer,
                                extension,
                                infoCitada.seconds
                        )

                        await enviarStickerConAudio(
                                client,
                                m.chat,
                                stickerBuffer,
                                esAnimado,
                                mensajeAudio
                        )

                        eliminarSesion(clave)

                        await react('✅')

                        return
                }

                if (esVideo) {
                        try {
                                const mensajeAudio = await crearMensajeAudio(
                                        client,
                                        datosVisuales,
                                        'mp4',
                                        duracionVideo
                                )

                                await enviarStickerConAudio(
                                        client,
                                        m.chat,
                                        stickerBuffer,
                                        true,
                                        mensajeAudio
                                )

                                eliminarSesion(clave)

                                await react('✅')

                                return
                        } catch {
                                await react('⏳')

                                return await iniciarSesionSticker({
                                        m,
                                        client,
                                        send,
                                        stickerBuffer,
                                        isAnimated: true,
                                        packname,
                                        author,
                                        usedPrefix,
                                        command
                                })
                        }
                }

                return await iniciarSesionSticker({
                        m,
                        client,
                        send,
                        stickerBuffer,
                        isAnimated: esAnimado,
                        packname,
                        author,
                        usedPrefix,
                        command
                })
        } catch (error) {
                console.error('[ERROR AUDIO STICKER]', error)

                await react('❌')

                await send(
                        `❌ No se pudo procesar el archivo: ${error?.message || String(error)}`
                )
        }
}

export const audioStickerCommand = {
        category: "tools",
        commands: {
                audiosticker: {
                        name: "audiosticker",
                        run: async (m, extra = {}) => {
                                return await ejecutarComandoAudioSticker(m, { ...extra, command: extra.command || "audiosticker" })
                        }
                },
                stikeraudio: {
                        name: "stikeraudio",
                        run: async (m, extra = {}) => {
                                return await ejecutarComandoAudioSticker(m, { ...extra, command: extra.command || "stikeraudio" })
                        }
                },
                stickeraudio: {
                        name: "stickeraudio",
                        run: async (m, extra = {}) => {
                                return await ejecutarComandoAudioSticker(m, { ...extra, command: extra.command || "stickeraudio" })
                        }
                },
                figurinhasom: {
                        name: "figurinhasom",
                        run: async (m, extra = {}) => {
                                return await ejecutarComandoAudioSticker(m, { ...extra, command: extra.command || "figurinhasom" })
                        }
                },
                saudio: {
                        name: "saudio",
                        run: async (m, extra = {}) => {
                                return await ejecutarComandoAudioSticker(m, { ...extra, command: extra.command || "saudio" })
                        }
                }
        },
        before: async (m, extra = {}) => {
                if (!m || m.fromMe) return false

                const clave = obtenerClaveSesion(m)
                const sesion = sesiones.get(clave)

                if (!sesion || sesion.processing) return false

                if (Date.now() > sesion.expiresAt) {
                        eliminarSesion(clave)
                        return false
                }

                const textoMensaje = String(m.text || m.body || '').trim()

                if (/^[./!#]?(audiosticker|stikeraudio|stickeraudio|figurinhasom|saudio)\b/i.test(textoMensaje)) {
                        return false
                }

                const infoPropia = detectarMedia(m)
                const citado = m.quoted
                const infoCitada = detectarMedia(citado)

                const esAudioDirecto = infoPropia.kind === 'audio'
                const esRespuestaAudio = !textoMensaje && infoCitada.kind === 'audio'

                if (!esAudioDirecto && !esRespuestaAudio) {
                        return false
                }

                const {
                        sock,
                        conn,
                        reply
                } = extra

                const client = sock || conn || m.conn || global.conn || global.sock

                const send = reply || (
                        texto => client.sendMessage(
                                m.chat,
                                { text: texto },
                                { quoted: m }
                        )
                )

                const react = async emoji => {
                        if (client?.sendMessage) {
                                await client.sendMessage(
                                        m.chat,
                                        {
                                                react: {
                                                        text: emoji,
                                                        key: m.key
                                                }
                                        }
                                ).catch(() => {})
                        }
                }

                const nodoAudio = esAudioDirecto ? m : citado
                const infoAudio = esAudioDirecto ? infoPropia : infoCitada

                await consumirSesionConAudio(
                        m,
                        client,
                        send,
                        react,
                        sesion,
                        nodoAudio,
                        infoAudio
                )

                return true
        }
}