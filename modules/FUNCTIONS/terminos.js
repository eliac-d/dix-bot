export const terminos = {
    category: 'main',
    commands: {
        ter: {
            name: 'terminos',
            alias: ['condiciones'],
            run: async (m, { conn }) => {
                try {
                    let mensaje = `📋 *TÉRMINOS, CONDICIONES Y POLÍTICA DE PRIVACIDAD*
*Sistema de Automatización: ᯓᴋᴀᴛsᴜᴋɪ ᴍᴅ ➫*

» *Resumen rápido:* No leemos tus chats privados, tus datos están seguros, no vendemos tu información y el 100% de nuestra infraestructura es propia. Al usar el bot o un Subbot, aceptas los riesgos de usar automatización en WhatsApp.

Al hacer uso de este bot, sus funciones, comandos o al vincular una sesión de Subbot, aceptas de manera explícita y sin excepciones los siguientes términos y condiciones de servicio:

───────────────
1. *NATURALEZA DEL PROYECTO Y DESLINDE LEGAL*
• Este bot es un proyecto 100% independiente desarrollado con fines recreativos y de automatización para grupos.
• No está afiliado, asociado, patrocinado, autorizado ni respaldado de ninguna manera por Meta Platforms, Inc., WhatsApp LLC, ni por ninguna de sus filiales.
• El personaje, nombre o elementos visuales utilizados son propiedad exclusiva de sus respectivos creadores. Se emplean únicamente bajo el concepto de apreciación estética y caracterización, sin pretender atribuirse derechos de propiedad intelectual sobre los mismos.

───────────────
2. *INFRAESTRUCTURA Y SERVICIOS (APIs)*
• El 100% de los servicios de procesamiento, APIs y herramientas internas son de desarrollo propio, garantizando la máxima estabilidad, velocidad y seguridad.
• El sistema no depende de infraestructuras inestables de terceros para su funcionamiento principal.
• No nos hacemos responsables por fallas, interrupciones o retrasos causados por caídas en plataformas externas de las cuales se extraiga contenido (ej. TikTok, Instagram, Spotify, etc.).

───────────────
3. *USO DE SUBBOTS Y RIESGO DE CUENTA*
• La vinculación de tu cuenta de WhatsApp como Subbot o la interacción con el sistema se realiza bajo tu propia responsabilidad y riesgo.
• Entiendes y aceptas que el uso de herramientas de automatización no oficiales puede violar las Condiciones de Servicio de WhatsApp LLC, lo que podría acarrear sanciones a tu número telefónico (incluyendo suspensiones temporales o baneos permanentes).
• El equipo de desarrollo NO se responsabiliza por la pérdida de cuentas, baneos, bloqueos, pérdida de chats o cualquier otro daño directo o indirecto derivado del uso del bot o sus subbots.

───────────────
4. *NORMAS DE USO Y SUSPENSIÓN DEL SERVICIO*
Queda estrictamente prohibido:
a) Utilizar el bot o subbots para realizar spam, envíos masivos no solicitados o acoso.
b) Intentar saturar, vulnerar, realizar ataques de denegación de servicio (DDoS) o explotar fallos en los servidores.
c) Utilizar el sistema para la distribución de contenido ilícito, dañino o que vulnere derechos de terceros.

Nos reservamos el derecho de suspender, revocar o banear el acceso a cualquier usuario o sesión de Subbot de forma inmediata y sin previo aviso en caso de detectar un uso malicioso o abusivo.

───────────────
5. *PRIVACIDAD Y TRATAMIENTO DE DATOS*
• *Cifrado:* El equipo de desarrollo NO tiene acceso a tus conversaciones, mensajes privados, imágenes ni chats. El cifrado de extremo a extremo de WhatsApp se mantiene intacto.
• *Datos temporales:* Los comandos, archivos y texto procesados por el bot se gestionan en memoria de manera temporal únicamente para generar la respuesta solicitada y no son almacenados permanentemente.
• *Base de datos:* Tu número telefónico y configuraciones asociadas al bot se conservan en nuestra base de datos de forma segura para el control de sesiones y son purgados/eliminados tras periodos de inactividad.
• *Comercialización:* Garantizamos que NINGÚN dato personal o información de uso es vendida, alquilada o compartida con terceros.
• *Contactos:* Tus listas de contactos y datos personales permanecen exclusivamente en tu dispositivo y cuenta personal.

───────────────
6. *MANTENIMIENTO Y DISPONIBILIDAD*
• El servicio se ofrece "tal cual" (AS IS), sin garantías de disponibilidad ininterrumpida del 100%.
• El equipo puede realizar reinicios, actualizaciones o suspensiones temporales del servidor para mantenimiento sin previo aviso.

───────────────
7. *MODIFICACIONES A LOS TÉRMINOS*
• Nos reservamos el derecho de modificar o actualizar estos Términos y Condiciones en cualquier momento. El uso continuado del bot tras cualquier modificación constituye la aceptación tácita de los nuevos términos.

───────────────
📌 *Nota:* Si no estás de acuerdo con alguna de las cláusulas aquí descritas, debes abstenerte de interactuar con el bot y desconectar cualquier sesión de Subbot activa.
`;

                    await conn.sendMessage(m.chat, {
                        product: {
                            productImage: {
                                url: typeof global.img === 'function' ? global.img(conn) : ''
                            },
                            title: "TÉRMINOS Y CONDICIONES",
                            retailerId: "1466",
                            productId: "37199733896340479",
                            productImageCount: 1,
                        },
                        businessOwnerJid: "50432955554@s.whatsapp.net",
                        footer: mensaje
                    }, { messageType: 'product', quoted: m });

                    m.react('✅');

                } catch (e) {
                    console.error(e);
                    m.react('❌');
                }
            }
        }
    }
};