const axios = require('axios');
require('dotenv').config();
const fs = require('fs');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');



// Load environment variables
const CHAT_ID = parseInt(process.env.CHAT_ID, 10);




// Convert admin IDs to a Set for quick lookup
const adminIds = new Set(process.env.ADMIN_IDS.split(',').map(id => id.trim()));




// Initialize Telegram Bot
const bot = new TelegramBot('7394590459:AAEwSwk80VHBcgxrYMU2O12w6DqyOYddVGg', { polling: true });



const API_URL = "https://www.xdc.dev/api/articles/latest";
const DATA_FILE = 'articledata.json';


//Fetches the latest 10 articles from XDC.dev API
async function fetchLatestArticles() {
    try {
        const response = await axios.get(API_URL);
        return response.data.slice(0, 10).map(article => ({
            articleId: article.id,
            title: article.title,
            link: `https://www.xdc.dev${article.path}`
        }));
    } catch (error) {
        console.error('Error fetching articles from API:', error);
        return [];
    }
}




//Reads stored article IDs from JSON file
function readStoredArticleIds() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const fileData = fs.readFileSync(DATA_FILE, 'utf-8').trim();
            return fileData ? new Set(JSON.parse(fileData)) : new Set();
        }
    } catch (error) {
        console.error('Error reading JSON file:', error);
    }
    return new Set();
}




// Writes updated article IDs to JSON file
function storeArticleIds(articleIds) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify([...articleIds], null, 2));
        console.log('Article IDs successfully updated.');
    } catch (error) {
        console.error('Error writing to JSON file:', error);
    }
}





/**
 * Sends a message with an "Unpublish" button for the article
 */
async function sendArticleNotification(chatId, article) {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "Unpublish",
                        callback_data: `unpublish_${article.articleId}`
                    }
                ]
            ]
        }
    };
    try {
        const sentMessage = await bot.sendMessage(chatId, `${article.title} - ${article.link} (Article ID: ${article.articleId})`, options);
        return sentMessage.message_id;  // Ensure this function returns the message ID
    } catch (error) {
        console.error("Error sending message:", error);
        return null;
    }
}


async function getArticleDetails(articleId) {
    try {
        const response = await axios.get(`https://www.xdc.dev/api/articles/${articleId}`);
        return {
            username: response.data.user.username, // Extract username
            slug: response.data.slug // Extract slug
        };
    } catch (error) {
        console.error('Error fetching article details:', error);
        return null;
    }
}


async function unpublishArticle(articleId, msg) {
    const userId = msg.from.id.toString();

    if (!adminIds.has(userId)) {
        return bot.answerCallbackQuery(msg.id.toString(), {
            text: 'You are not authorized to unpublish this article!',
            show_alert: true
        });
    }

    try {
        // Fetch username and slug from the article details
        const articleDetails = await getArticleDetails(articleId);
        if (!articleDetails) {
            return bot.answerCallbackQuery(msg.id.toString(), {
                text: 'Failed to fetch article details.',
                show_alert: true
            });
        }

        const { username, slug } = articleDetails;
        const apiUrl = `https://www.xdc.dev/articles/${articleId}/admin_unpublish`;

        // Payload containing username, id, and slug
        const payload = {
            id: articleId,
            username: username,
            slug: slug
        };

        // Send DELETE request with the payload
        const response = await axios.delete(apiUrl, { data: payload });

        if (response.status === 200) {
            await bot.deleteMessage(CHAT_ID, msg.message.message_id);
            await bot.answerCallbackQuery(msg.id.toString(), {
                text: "Article unpublished successfully!",
                show_alert: true
            });
        } else {
            await bot.answerCallbackQuery(msg.id.toString(), {
                text: "Failed to unpublish the article.",
                show_alert: true
            });
        }

    } catch (error) {
        console.error("Error unpublishing article:", error);
        await bot.answerCallbackQuery(msg.id.toString(), {
            text: "Failed to unpublish the article.",
            show_alert: true
        });
    }
}


bot.on('callback_query', async (msg) => {
    const data = msg.data;
    if (data.startsWith('unpublish_')) {
        const articleId = data.split("_")[1];
        await unpublishArticle(articleId, msg);
    }
});


/**
 * Processes new articles and sends notifications
 */
async function processNewArticles() {
    const latestArticles = await fetchLatestArticles();
    if (latestArticles.length === 0) {
        console.log('No new articles found.');
        await bot.sendMessage(CHAT_ID, 'No new articles found!');

        return;
    }

    const storedArticleIds = readStoredArticleIds();
    const newArticles = latestArticles.filter(article => !storedArticleIds.has(article.articleId));

    if (newArticles.length > 0) {
        for (const article of newArticles) {
            await sendArticleNotification(CHAT_ID, article);
            storedArticleIds.add(article.articleId);
        }
        storeArticleIds(storedArticleIds);
    } else {
        console.log('No new articles to send.');
    }
}

// Command to fetch latest articles manually
bot.on('message', async (msg) => {
    try {
        console.log("Received message:", msg);
        const chatId = msg.chat.id;

        const articles = await fetchLatestArticles();
        if (articles.length > 0) {
            await bot.sendMessage(chatId, "Here are the latest articles:");
            for (const article of articles) {
                await sendArticleNotification(chatId, article);
            }
        } else {
            await bot.sendMessage(chatId, "No articles found!");
        }
    } catch (error) {
        console.error('Error occurred:', error);
        await bot.sendMessage(msg.chat.id, 'Something went wrong!');
    }
});

// Scheduled task to check for new articles every minute
cron.schedule('*/1 * * * *', processNewArticles);

console.log("Bot is running...");
