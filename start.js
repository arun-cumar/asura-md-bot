import { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    Browsers, 
    delay, 
    makeCacheableSignalKeyStore 
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import axios from 'axios';
import path from 'path';

// ⚠️ താഴെയുള്ള രണ്ട് വിവരങ്ങൾ മാത്രം കൃത്യമായി നൽകുക
const GITHUB_TOKEN = "നിങ്ങളുടെ_GH_ടോക്കൺ"; 
const REPO_URL = "https://raw.githubusercontent.com/username/privaterepo/main/commands/";

async function startAsura() {
    const { state, saveCreds } = await useMultiFileAuthState('session');

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        printQRInTerminal: true, // Termux-ൽ QR വരാൻ ഇത് സഹായിക്കും
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu("Chrome")
    });

    // പെയറിംഗ് കോഡ് വേണമെങ്കിൽ (ഫോൺ നമ്പർ കൊടുത്താൽ മാത്രം)
    if (!sock.authState.creds.registered) {
        console.log("പെയറിംഗ് കോഡ് ഉപയോഗിക്കണമെങ്കിൽ ഫോൺ നമ്പർ നൽകുക...");
        // ഇവിടെ വേണമെങ്കിൽ ഒരു input logic ചേർക്കാം, അല്ലെങ്കിൽ QR ഉപയോഗിക്കാം.
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.buttonsResponseMessage?.selectedButtonId || "";

        if (!text.startsWith('.')) return;

        const args = text.trim().split(/ +/).slice(1);
        const command = text.split(" ")[0].slice(1).toLowerCase();

        try {
            // 🚀 ഗിറ്റഹബ്ബിൽ നിന്ന് കമാൻഡ് ഫെച്ച് ചെയ്യുന്നു
            const response = await axios.get(`${REPO_URL}${command}.js`, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            });

            const rawCode = response.data;
            
            // 'export default' ലോജിക് മെമ്മറിയിൽ റൺ ചെയ്യുന്നു
            const cleanCode = rawCode.replace(/export default/, "const handler =").concat("\nreturn handler;");
            const commandFunc = new Function('fs', 'axios', 'path', cleanCode)(fs, axios, path);
            
            await commandFunc(sock, msg, args);

        } catch (err) {
            console.log(`[Command Error]: ${command} - ഫയൽ റിപ്പോയിൽ ഉണ്ടോ എന്ന് പരിശോധിക്കുക.`);
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startAsura();
        } else if (connection === 'open') {
            console.log('✅ Asura MD Connected Successfully!');
        }
    });
}

startAsura();
