const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    getContentType,
    downloadContentFromMessage 
} = require('@whiskeysockets/baileys');
const nsfw = require('nsfwjs');
const tf = require('@tensorflow/tfjs-node');
const pino = require('pino');
const { Boom } = require('@hapi/boom');

let model;

// AI മോഡൽ മെമ്മറിയിലേക്ക് ലോഡ് ചെയ്യുന്നു
async function loadAI() {
    console.log("✨ AI നിരീക്ഷണ സംവിധാനം തയ്യാറെടുക്കുന്നു...");
    model = await nsfw.load();
    console.log("✅ AI സിസ്റ്റം ഓൺലൈൻ ആയി!");
}

async function startBot() {
    await loadAI();
    
    // സെഷൻ സേവ് ചെയ്യാൻ 'auth_info' എന്ന ഫോൾഡർ ഉപയോഗിക്കും
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['🛡️ AI Guard', 'MacOS', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    // --- 1. മോഡേൺ വെൽക്കം & വാർണിംഗ് സിസ്റ്റം ---
    sock.ev.on('group-participants.update', async (anu) => {
        if (anu.action === 'add') {
            for (let user of anu.participants) {
                const welcomeMsg = `╭━━━ ✨ *WELCOME* ✨ ━━━╮\n┃\n┃ 👋 ഹലോ @${user.split("@")[0]}!\n┃ ഗ്രൂപ്പിലേക്ക് സ്വാഗതം.\n┃\n┃ ⚠️ *ശ്രദ്ധിക്കുക:* \n┃ 🔞 18+ ഉള്ളടക്കങ്ങൾ പാടില്ല.\n┃ 🔗 ലിങ്കുകൾ അനുവദനീയമല്ല.\n┃\n┃ _ഈ ഗ്രൂപ്പ് AI സംരക്ഷണത്തിലാണ്!_\n╰━━━━━━━━━━━━━━━━╯`;
                await sock.sendMessage(anu.id, { text: welcomeMsg, mentions: [user] });
            }
        }
    });

    // --- 2. ആന്റി-ലിങ്ക് & അഡൽറ്റ് ഫിൽട്ടർ ലോജിക് ---
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const msg = chatUpdate.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            if (!isGroup) return;

            const type = getContentType(msg.message);
            const body = (type === 'conversation') ? msg.message.conversation : 
                         (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : 
                         (type === 'imageMessage' || type === 'videoMessage') ? msg.message[type].caption : '';

            // --- A. എല്ലാ ലിങ്കുകളും തടയുന്നു ---
            const linkRegex = /https?:\/\/\S+/gi;
            if (linkRegex.test(body)) {
                console.log("🚫 ലിങ്ക് കണ്ടെത്തി! നീക്കം ചെയ്യുന്നു...");
                return await sock.sendMessage(from, { delete: msg.key });
            }

            // --- B. AI അഡൽറ്റ് മീഡിയ സ്കാനിംഗ് ---
            if (type === 'imageMessage' || type === 'stickerMessage' || type === 'videoMessage') {
                const isVideo = type === 'videoMessage';
                // വീഡിയോ ആണെങ്കിൽ അതിന്റെ തംബ്നൈൽ സ്കാൻ ചെയ്യും
                const stream = await downloadContentFromMessage(msg.message[type], isVideo ? 'video' : (type === 'imageMessage' ? 'image' : 'sticker'));
                
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                // AI ഇമേജ് പ്രോസസ്സിംഗ്
                const image = tf.node.decodeImage(buffer, 3);
                const predictions = await model.classify(image);
                image.dispose(); // മെമ്മറി ക്ലിയർ ചെയ്യുന്നു

                // Porn, Hentai, Sexy കാറ്റഗറികൾ പരിശോധിക്കുന്നു
                const isNsfw = predictions.some(p => 
                    (p.className === 'Porn' || p.className === 'Hentai' || p.className === 'Sexy') && p.probability > 0.65
                );

                if (isNsfw) {
                    console.log("🔞 അഡൽറ്റ് കണ്ടന്റ് കണ്ടെത്തി!");
                    await sock.sendMessage(from, { delete: msg.key });
                    await sock.sendMessage(from, { text: "⚠️ *AI ALERT:* നിയമവിരുദ്ധമായ ദൃശ്യങ്ങൾ അയച്ചതിനാൽ ആ മെസ്സേജ് ഡിലീറ്റ് ചെയ്തു." });
                }
            }
        } catch (err) {
            console.log("Error:", err.message);
        }
    });

    // കണക്ഷൻ സ്റ്റാറ്റസ്
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('\n🚀 🛡️ AI GUARD BOT സജീവമായി!');
            console.log('ഗ്രൂപ്പുകൾ ഇപ്പോൾ സുരക്ഷിതമാണ്.\n');
        }
    });
}

startBot();
