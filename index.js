import { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    Browsers, 
    makeCacheableSignalKeyStore 
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import axios from 'axios';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 10000;

// Env Variables
const SESSION_ID = process.env.SESSION_ID; // ASURA_MD_...
const GH_KEY = process.env.GH_KEY; 
const REPO_URL = process.env.REPO_URL; // Example: "username/privaterepo/commands"

const commands = new Map();

// 1. Session Decoder (ID-യെ ഫയൽ ആക്കി മാറ്റുന്നു)
if (SESSION_ID && !fs.existsSync('./session/creds.json')) {
    if (!fs.existsSync('./session')) fs.mkdirSync('./session');
    try {
        const base64Data = SESSION_ID.replace('ASURA_MD_', '');
        const jsonCreds = Buffer.from(base64Data, 'base64').toString('utf-8');
        fs.writeFileSync('./session/creds.json', jsonCreds);
        console.log("✅ Session Loaded from Environment Variable");
    } catch (e) {
        console.error("❌ Invalid Session ID");
    }
}

// 2. RAM Loader (No Download to Disk)
async function loadCommandsToRAM() {
    if (!GH_KEY || !REPO_URL) return console.log("⚠️ Missing GH_KEY or REPO_URL");
    try {
        const [owner, repo, folder] = REPO_URL.split('/');
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${folder}`;
        
        const { data } = await axios.get(apiUrl, {
            headers: { 'Authorization': `token ${GH_KEY}` }
        });

        for (const file of data) {
            if (file.name.endsWith('.js')) {
                const { data: code } = await axios.get(file.download_url, {
                    headers: { 'Authorization': `token ${GH_KEY}` }
                });
                const cleanCode = code.replace(/export default/, "const handler =").concat("\nreturn handler;");
                const handler = new Function('fs', 'axios', 'path', cleanCode)(fs, axios, {});
                commands.set(file.name.replace('.js', '').toLowerCase(), handler);
            }
        }
        console.log(`✅ Loaded ${commands.size} commands directly to RAM.`);
    } catch (e) {
        console.error("❌ Repo Loading Failed");
    }
}

// 3. Main Bot Startup
async function startAsura() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu("Chrome")
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log("✅ Connection Successful!");
            await loadCommandsToRAM();

            // Session ID DM അയക്കുന്നു
            const creds = fs.readFileSync('./session/creds.json', 'utf-8');
            const sessionID = `ASURA_MD_${Buffer.from(creds).toString('base64')}`;
            
            await sock.sendMessage(sock.user.id, { 
                text: `*👺 ASURA MD CONNECTED*\n\nYour Session ID:\n\n\`\`\`${sessionID}\`\`\`` 
            });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startAsura();
            else {
                console.log("Logged out. Deleting session...");
                fs.rmSync('./session', { recursive: true, force: true });
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith('.')) return;

        const cmd = text.split(" ")[0].slice(1).toLowerCase();
        if (commands.has(cmd)) {
            try {
                await commands.get(cmd)(sock, msg, text.split(" ").slice(1));
            } catch (err) { console.error(err); }
        }
    });
}

// 4. API for Pairing
app.get('/get-pair', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.json({ error: "Number required" });

    const { state, saveCreds } = await useMultiFileAuthState(`./temp/${num}`);
    const pairingSock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu("Chrome")
    });

    if (!pairingSock.authState.creds.registered) {
        try {
            let code = await pairingSock.requestPairingCode(num);
            res.json({ code: code });
        } catch { res.json({ error: "Failed" }); }
    }

    pairingSock.ev.on('creds.update', saveCreds);
    pairingSock.ev.on('connection.update', async (up) => {
        if (up.connection === 'open') {
            const creds = fs.readFileSync(`./temp/${num}/creds.json`, 'utf-8');
            const sid = `ASURA_MD_${Buffer.from(creds).toString('base64')}`;
            await pairingSock.sendMessage(pairingSock.user.id, { text: sid });
            fs.rmSync(`./temp/${num}`, { recursive: true, force: true });
        }
    });
});

app.listen(PORT, () => console.log(`Asura Server on ${PORT}`));
if (SESSION_ID) startAsura();
