const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatIds = process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID.split(',') : [];
const adminIds = new Set(process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : []);
const API_KEY = process.env.API_KEY;
const options = { timeZone: "Asia/Kolkata", hour12: false }; //  IST Format

const bot = new TelegramBot(token, { polling: true });

// 🔹 Utility Functions for JSON Read/Write
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

// 🔹 Load Persistent Data
let previousArticleIds = new Set(readJSON('previousArticleIds.json'));
let unpublishedArticles = new Set(readJSON('unpublishedArticles.json'));
let activeMessages = readJSON('activeMessages.json', {});

// 🔹 Append New Articles to `previousArticleIds.json`
function appendToPreviousArticles(newArticles) {
    newArticles.forEach(articleId => previousArticleIds.add(articleId));
    writeJSON('previousArticleIds.json', Array.from(previousArticleIds));
}

// 🔹 Save Active Messages to File
function saveActiveMessages() {
    writeJSON('activeMessages.json', activeMessages);
}

// 🔹 Send Article Notification
async function sendArticleNotification(chatId, article) {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Unpublish", callback_data: `unpublish_${article.articleId}` }]
            ]
        }
    };

    try {
        const sentMessage = await bot.sendMessage(chatId, `${article.title} - ${article.link} (Article ID: ${article.articleId})`, options);

        if (!activeMessages[article.articleId]) {
            activeMessages[article.articleId] = [];
        }
        activeMessages[article.articleId].push({ chatId, messageId: sentMessage.message_id });

        saveActiveMessages(); // Save updated messages

    } catch (error) {
        console.error(`[${new Date().toLocaleString("en-IN", options)}]  Error sending message:`, error);
    }
}

// 🔹 Fetch Latest Articles
async function fetchLatestArticles() {
    try {
        console.log(`[${new Date().toLocaleString("en-IN", options)}] Fetching latest articles...`);
        const response = await axios.get(`https://www.xdc.dev/api/articles/latest`);

        if (!response.data || response.data.length === 0) {
            console.log(`[${new Date().toLocaleString("en-IN", options)}]  No articles found.`);
            return [];
        }

        return response.data.map(article => ({
            articleId: article.id,
            title: article.title,
            link: article.url
        }));
    } catch (error) {
        console.error(`[${new Date().toLocaleString("en-IN", options)}]  Error fetching articles:`, error);
        return [];
    }
}

// 🔹 Fetch Article Details Before Unpublishing
async function getArticleDetails(articleId) {
    try {
        const response = await axios.get(`https://www.xdc.dev/api/articles/${articleId}`, {
            headers: { 'api-key': API_KEY }
        });

        return response.data || null;
    } catch (error) {
        console.error(`[${new Date().toLocaleString("en-IN", options)}]  Error fetching article details:`, error.response?.data || error.message);
        return null;
    }
}

// 🔹 Unpublish Article Function
async function unpublishArticle(articleId, msg) {
    try {
        const userId = msg.from.id.toString();
        if (!adminIds.has(userId.trim())) {
            return bot.answerCallbackQuery(msg.id, { text: ' Unauthorized access!', show_alert: true });
        }

        if (!API_KEY) {
            console.error("⚠️ Missing API Key.");
            return bot.answerCallbackQuery(msg.id, { text: " API key is missing!", show_alert: true });
        }

        // 🔹 Fetch Article Details Before Unpublishing
        const articleDetails = await getArticleDetails(articleId);
        if (!articleDetails) {
            return bot.answerCallbackQuery(msg.id, { text: ' Failed to fetch article details.', show_alert: true });
        }

        // 🔹 API Request to Unpublish Article
        const apiUrl = `https://www.xdc.dev/api/articles/${articleId}`;
        const payload = { article: { published: false } };

        const response = await axios.put(apiUrl, payload, {
            headers: {
                'api-key': API_KEY,
                'accept': 'application/vnd.forem.api-v1+json',
                'Content-Type': 'application/json',
            },
        });

        if (response.status === 200) {
            console.log(`[${new Date().toLocaleString("en-IN", options)}] Article ID: ${articleId} successfully unpublished.`);

            // 🔹 Add article to unpublishedArticles.json
            unpublishedArticles.add({
                articleId,
                username: articleDetails.user.username,
                title: articleDetails.slug
            });
            writeJSON('unpublishedArticles.json', Array.from(unpublishedArticles));

            // 🔹 Remove the message from all chat groups
            if (activeMessages[articleId]) {
                for (const { chatId, messageId } of activeMessages[articleId]) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                    } catch (error) {
                        console.error(`[${new Date().toLocaleString("en-IN", options)}]  Failed to delete message in chat ${chatId}:`, error);
                    }
                }
                delete activeMessages[articleId]; // Remove from memory
                saveActiveMessages();
            }

            return bot.answerCallbackQuery(msg.id, { text: " Article unpublished successfully!", show_alert: true });
        }
    } catch (error) {
        console.error(`[${new Date().toLocaleString("en-IN", options)}] ❌ Error unpublishing article:`, error.response?.data || error.message);
        return bot.answerCallbackQuery(msg.id, { text: " Failed to unpublish the article.", show_alert: true });
    }
}

// 🔹 Listen for "Unpublish" Button Clicks
bot.on('callback_query', async (msg) => {
    const data = msg.data;
    if (data.startsWith('unpublish_')) {
        await unpublishArticle(data.split("_")[1], msg);
    }
});

// 🔹 Function to Fetch and Send Notifications
async function checkAndSendNewArticles() {
    try {

        const latestArticles = await fetchLatestArticles();
        const newArticles = latestArticles.filter(article =>
            !previousArticleIds.has(article.articleId) && !unpublishedArticles.has(article.articleId)
        ).slice(0, 10); //  Limit to 10 new articles

        if (newArticles.length > 0) {
            for (const article of newArticles) {
                chatIds.forEach(chatId => sendArticleNotification(chatId, article));
                previousArticleIds.add(article.articleId);
            }

            appendToPreviousArticles(newArticles.map(article => article.articleId));
            console.log(`[${new Date().toLocaleString("en-IN", options)}]  Sent ${newArticles.length} new articles.`);
        } else {
            console.log(`[${new Date().toLocaleString("en-IN", options)}]  No new articles found.`);
        }
    } catch (error) {
        console.error(`[${new Date().toLocaleString("en-IN", options)}]  Error in checkAndSendNewArticles:`, error);
    }
}

// 🔹 Start Bot: Fetch 10 Articles on Startup, Then Check Every 1 Min
console.log(`[${new Date().toLocaleString("en-IN", options)}]  Bot started for chat IDs:`, chatIds);
checkAndSendNewArticles(); // Run immediately on startup
setInterval(checkAndSendNewArticles, 60 * 1000); // Run every 1 minute

module.exports = checkAndSendNewArticles;
