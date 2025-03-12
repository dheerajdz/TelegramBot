const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const fs = require("fs");

// Load environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatIds = process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID.split(',') : [];
const adminIds = new Set(process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : []);
const API_KEY = process.env.API_KEY; // Single API key for all admins

const bot = new TelegramBot(token, { polling: true });

// Load previous article IDs from file
function readJSON(filename) {
    try {
        const data = fs.readFileSync(filename, 'utf-8');
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function writeJSON(filename, data) {
    try {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error(`Failed to write ${filename}:`, error);
    }
}

const previousArticleIds = new Set(readJSON('previousArticleIds.json') || []);
const unpublishedArticles = new Set(readJSON('unpublishedArticles.json'));

// In-memory storage for active messages
const activeMessages = {}; // { articleId: [{ chatId, messageId }] }

// Periodic logging of activeMessages
function logActiveMessages() {
    console.log("Active Messages Log:");
    console.log(JSON.stringify(activeMessages, null, 2));
}

// Fetch the latest articles
async function fetchLatestArticles() {
    try {
        const response = await axios.get('https://www.xdc.dev/api/articles/latest');
        return response.data.slice(0, 10).map(article => ({
            articleId: article.id,
            title: article.title,
            link: `https://www.xdc.dev${article.path}`
        }));
    } catch (error) {
        console.error('Error fetching latest articles:', error.message);
        return [];
    }
}

// Send notification with an "Unpublish" button
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

        // Store the message ID in memory
        if (!activeMessages[article.articleId]) {
            activeMessages[article.articleId] = [];
        }
        activeMessages[article.articleId].push({ chatId, messageId: sentMessage.message_id });

    } catch (error) {
        console.error("Error sending message:", error);
    }
}

// Fetch article details
async function getArticleDetails(articleId) {
    try {
        const response = await axios.get(`https://www.xdc.dev/api/articles/${articleId}`);
        return { username: response.data.user.username, slug: response.data.slug };
    } catch (error) {
        console.error('Error fetching article details:', error);
        return null;
    }
}

// Unpublish article function
async function unpublishArticle(articleId, msg) {
    try {
        const userId = msg.from.id.toString();
        if (!adminIds.has(userId)) {
            return bot.answerCallbackQuery(msg.id.toString(), { text: 'Unauthorized access!', show_alert: true });
        }

        const articleDetails = await getArticleDetails(articleId);
        if (!articleDetails) {
            return bot.answerCallbackQuery(msg.id.toString(), { text: 'Failed to fetch article details.', show_alert: true });
        }

        const apiUrl = `https://www.xdc.dev/api/articles/${articleId}`;
        const payload = { article: { published: false } };

        if (!API_KEY) {
            throw new Error("Missing API Key.");
        }

        const response = await axios.put(apiUrl, payload, {
            headers: {
                'api-key': API_KEY,
                'accept': 'application/vnd.forem.api-v1+json',
                'Content-Type': 'application/json',
            },
        });

        if (response.status === 200) {
            console.log(`Article ID: ${articleId} successfully unpublished.`);

            // Add article to unpublishedArticles.json with extra details
            unpublishedArticles.add({
                articleId,
                username: articleDetails.username,
                title: articleDetails.slug
            });
            writeJSON('unpublishedArticles.json', Array.from(unpublishedArticles));

            // Remove the message from all chat groups
            if (activeMessages[articleId]) {
                for (const { chatId, messageId } of activeMessages[articleId]) {
                    try {
                        await bot.deleteMessage(chatId, messageId);
                    } catch (error) {
                        console.error(`Failed to delete message in chat ${chatId}:`, error);
                    }
                }
                delete activeMessages[articleId]; // Remove from memory
            }

            return bot.answerCallbackQuery(msg.id.toString(), { text: "Article unpublished successfully!", show_alert: true });
        }
    } catch (error) {
        console.error("Error unpublishing article:", error.response?.data || error.message);
        return bot.answerCallbackQuery(msg.id.toString(), { text: "Failed to unpublish the article.", show_alert: true });
    }
}

// Listen for "Unpublish" button clicks
bot.on('callback_query', async (msg) => {
    const data = msg.data;
    if (data.startsWith('unpublish_')) {
        await unpublishArticle(data.split("_")[1], msg);
    }
});

// Start bot notifications
function startXDCNotify() {
    console.log('Bot started for chat IDs:', chatIds);

    cron.schedule('*/1 * * * *', async () => {
        console.log('Checking for new articles...');
        const latestArticles = await fetchLatestArticles();

        for (const article of latestArticles) {
            if (!previousArticleIds.has(article.articleId) && !unpublishedArticles.has(article.articleId)) {
                chatIds.forEach(chatId => sendArticleNotification(chatId, article));
                previousArticleIds.add(article.articleId);
            }
        }
        writeJSON('previousArticleIds.json', Array.from(previousArticleIds));
    });

    // Schedule periodic logging of active messages every 5 minutes
    cron.schedule('*/5 * * * *', logActiveMessages);
    console.log('Checking for active messages...');
}

startXDCNotify();
module.exports = startXDCNotify;