export const viewOnceCommand = {
  category: 'tools',
  commands: {
    viewonce: {
      name: 'viewonce',
      alias: ['vo', 'veruna'],
      libre: true,
      run: async function (m, { conn }) {
        // Extrae el texto que el usuario escriba después del comando
        const textArgs = m.text ? m.text.trim().split(/\s+/).slice(1).join(' ') : '';
        const mensajeTexto = textArgs || 'Hola, este es un mensaje de prueba';

        try {
          // Envía el mensaje estructurado con la propiedad viewOnce activada
          await conn.sendMessage(m.chat, {
            text: mensajeTexto,
            viewOnce: true
          }, { quoted: m });

        } catch (e) {
          await m.reply(`❌ Error al enviar el mensaje de una sola vez: ${e.message}`);
        }
      }
    }
  }
};
