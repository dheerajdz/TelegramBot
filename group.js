const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

// 🔹 ENV Variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID;
const adminIds = new Set((process.env.ADMIN_IDS || "").split(',').map(id => id.trim()));
const API_KEY = process.env.API_KEY;
const options = { timeZone: "Asia/Kolkata", hour12: false };

// 🔹 Initialize Bot
const bot = new TelegramBot(token, { polling: true });

// 🔹 File Helpers
function readJSON(filename, defaultValue = []) {
    if (!fs.existsSync(filename)) {
        fs.writeFileSync(filename, JSON.stringify(defaultValue, null, 2));
        return defaultValue;
    }
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function writeJSON(filename, data) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

// 🔹 Persistent Data
let previousArticleIds = new Set(readJSON('previousArticleIds.json'));
let unpublishedArticles = readJSON('unpublishedArticles.json', []);
let activeMessages = readJSON('activeMessages.json', {});

// 🔹 Save Helpers
function appendToPreviousArticles(newIds) {
    newIds.forEach(id => previousArticleIds.add(id));
    writeJSON('previousArticleIds.json', Array.from(previousArticleIds));
}

function saveActiveMessages() {
    writeJSON('activeMessages.json', activeMessages);
}

function addToUnpublishedArticles(articleId, slug, deletedBy) {
    unpublishedArticles.push({ articleId, slug, deletedBy });
    writeJSON('unpublishedArticles.json', unpublishedArticles);
}

// 🔹 Fetch Latest Articles
async function fetchLatestArticles() {
    try {
        const res = await axios.get("https://www.xdc.dev/api/articles/latest");
        if (!res.data || !Array.isArray(res.data)) return [];
        return res.data.map(a => ({
            articleId: a.id,
            title: a.title,
            link: a.url
        }));
    } catch (err) {
        console.error(`[${new Date().toLocaleString("en-IN", options)}] Error fetching articles:`, err.message);
        return [];
    }
}

// 🔹 Get Article Details
async function getArticleDetails(articleId) {
    try {
        const res = await axios.get(`https://www.xdc.dev/api/articles/${articleId}`, {
            headers: { 'api-key': API_KEY }
        });
        return res.data || null;
    } catch (err) {
        console.error(`[${new Date().toLocaleString("en-IN", options)}] Error fetching article details:`, err.message);
        return null;
    }
}

// 🔹 Send Article Notification
async function sendArticleNotification(article) {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Unpublish", callback_data: `unpublish_${article.articleId}` }]
            ]
        }
    };

    try {
        const msg = await bot.sendMessage(groupChatId, `${article.title}\n${article.link}`, options);
        activeMessages[article.articleId] = { messageId: msg.message_id };
        saveActiveMessages();
    } catch (err) {
        console.error("Error sending article message:", err.message);
    }
}

// 🔹 Unpublish Logic
async function unpublishArticle(articleId, msg) {
    const userId = msg.from.id.toString();
    if (!adminIds.has(userId)) {
        return bot.answerCallbackQuery(msg.id, { text: 'Unauthorized access', show_alert: true });
    }

    const details = await getArticleDetails(articleId);
    if (!details) {
        return bot.answerCallbackQuery(msg.id, { text: 'Article not found', show_alert: true });
    }

    try {
        await axios.put(`https://www.xdc.dev/api/articles/${articleId}`, {
            article: { published: false }
        }, {
            headers: {
                'api-key': API_KEY,
                'accept': 'application/vnd.forem.api-v1+json',
                'Content-Type': 'application/json',
            }
        });

        console.log(`[${new Date().toLocaleString("en-IN", options)}] Unpublished article ${articleId}`);

        addToUnpublishedArticles(articleId, details.slug, msg.message.chat.id);

        const messageId = activeMessages[articleId]?.messageId;
        if (messageId) {
            await bot.deleteMessage(groupChatId, messageId);
            delete activeMessages[articleId];
            saveActiveMessages();
        }

        return bot.answerCallbackQuery(msg.id, { text: 'Unpublished successfully', show_alert: true });
    } catch (err) {
        console.error("Error unpublishing article:", err.response?.data || err.message);
        return bot.answerCallbackQuery(msg.id, { text: 'Failed to unpublish', show_alert: true });
    }
}

// 🔹 Handle Callback Queries (Unpublish Button)
bot.on('callback_query', async (msg) => {
    const data = msg.data;
    if (data.startsWith('unpublish_')) {
        const articleId = data.split('_')[1];
        await unpublishArticle(articleId, msg);
    }
});

// 🔹 Article Polling Logic
async function checkAndSendNewArticles() {
    const latestArticles = await fetchLatestArticles();
    const newArticles = latestArticles.filter(article =>
        !previousArticleIds.has(article.articleId) &&
        !unpublishedArticles.some(u => u.articleId === article.articleId)
    ).slice(0, 10);

    for (const article of newArticles) {
        await sendArticleNotification(article);
        previousArticleIds.add(article.articleId);
    }

    appendToPreviousArticles(newArticles.map(a => a.articleId));

    console.log(`[${new Date().toLocaleString("en-IN", options)}] Checked and sent ${newArticles.length} articles.`);
}

// 🔹 Start Bot
console.log(`[${new Date().toLocaleString("en-IN", options)}] Bot started for group: ${groupChatId}`);
checkAndSendNewArticles();
setInterval(checkAndSendNewArticles, 60 * 1000); // Check every 1 min

module.exports = checkAndSendNewArticles;
