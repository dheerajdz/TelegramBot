require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');

// Load environment variables
const token = '7394590459:AAEwSwk80VHBcgxrYMU2O12w6DqyOYddVGg';
const chatIds = process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID.split(',') : [];
const adminIds = new Set(process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : []);
const apiKey = 'avxi4QDSBLHie9DutCsD9dYH';
const bot = new TelegramBot(token, { polling: true });

// Fetch the latest articles from the API
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

// Read previously notified article IDs from a file
function readPreviousArticleIds() {
    try {
        const data = fs.readFileSync('previousArticleIds.json', 'utf-8');
        return new Set(JSON.parse(data));
    } catch (error) {
        console.error('Error reading previous article IDs:', error.message);
        return new Set();
    }
}

// Function to write currently notified article IDs to a file
function writePreviousArticleIds(previousArticleIds) {
    const data = JSON.stringify(Array.from(previousArticleIds));
    fs.writeFileSync('previousArticleIds.json', data, 'utf-8');
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
        return sentMessage.message_id;
    } catch (error) {
        console.error("Error sending message:", error);
        return null;
    }
}

// Get article details (username & slug)
async function getArticleDetails(articleId) {
    try {
        const response = await axios.get(`https://www.xdc.dev/api/articles/${articleId}`);
        return { username: response.data.user.username, slug: response.data.slug };
    } catch (error) {
        console.error('Error fetching article details:', error);
        return null;
    }
}




async function unpublishArticle(articleId, msg) {
    try {
        const userId = msg.from.id.toString();
        const chatId = msg.message.chat.id.toString();

        if (userId !== adminIds) {
            console.log(`Unauthorized user: ${userId} attempted to unpublish article ID: ${articleId}`);
            await bot.answerCallbackQuery(msg.id.toString(), {
                text: 'You are not authorized to unpublish this article!',
                show_alert: true
            });
            return;
        }

        console.log(`Admin ${userId} is attempting to unpublish article with ID: ${articleId}`);

        // Fetch article details
        const articleDetails = await getArticleDetails(articleId);
        if (!articleDetails) {
            console.log(`Failed to fetch details for article ID: ${articleId}`);
            await bot.answerCallbackQuery(msg.id.toString(), {
                text: 'Failed to fetch article details.',
                show_alert: true
            });
            return;
        }

        const { username, slug } = articleDetails;
        const apiUrl = `https://www.xdc.dev/api/articles/${articleId}`;
        const payload = {
            article: {
                published: false
            }
        };

        console.log(`Sending API request to: ${apiUrl}`);
        console.log(`Payload:`, JSON.stringify(payload, null, 2));

        if (!apiKey) {
            throw new Error("Missing API Key. Please check your configuration.");
        }

        // API request with PUT method
        const response = await axios.put(apiUrl, payload, {
            headers: {
                'api-key': apiKey,
                'accept': 'application/vnd.forem.api-v1+json',
                'Content-Type': 'application/json',
            },
        });

        console.log("API Response Data:", response.data);
        console.log("API Response Status:", response.status);
        console.log("API Response Headers:", response.headers);

        if (response.status === 200) {
            console.log(`Article ID: ${articleId} successfully unpublished.`);
            await bot.deleteMessage(chatId, msg.message.message_id);
            await bot.answerCallbackQuery(msg.id.toString(), {
                text: "Article unpublished successfully!",
                show_alert: true
            });
        } else {
            console.log(`Unexpected response status: ${response.status}`);
            await bot.answerCallbackQuery(msg.id.toString(), {
                text: "Failed to unpublish the article.",
                show_alert: true
            });
        }

    } catch (error) {
        console.error("Error unpublishing article:", error.response?.data || error.message);
        await bot.answerCallbackQuery(msg.id.toString(), {
            text: "Failed to unpublish the article. Please try again later.",
            show_alert: true
        });
    }
}

// Listen for "Unpublish" button clicks
bot.on('callback_query', async (msg) => {
    const data = msg.data;
    if (data.startsWith('unpublish_')) {
        const articleId = data.split("_")[1];
        await unpublishArticle(articleId, msg);
    }
});

// Start the notification bot
function startXDCNotify() {
    console.log('Bot started with the following chat IDs:', chatIds);
    let previousArticleIds = readPreviousArticleIds();

    // Scheduled task to check for new articles every minute
    cron.schedule('*/1 * * * *', async () => {
        console.log('Checking for new articles...');
        const latestArticles = await fetchLatestArticles();

        for (const article of latestArticles) {
            if (!previousArticleIds.has(article.articleId)) {
                chatIds.forEach(chatId => sendArticleNotification(chatId, article));
                previousArticleIds.add(article.articleId);
            }
        }

        writePreviousArticleIds(previousArticleIds);
    });

    console.log('Notification bot started...');
}

startXDCNotify();
module.exports = startXDCNotify;
