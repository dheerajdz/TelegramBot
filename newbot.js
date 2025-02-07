

const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();
const userChatId = process.env.userChatId;
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');



console.log("Bot Token:", process.env.TELEGRAM_BOT_TOKEN)//checkingg

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Function to fetch HTML of the website
async function gethtml() {
    const { data: html } = await axios.get('https://www.xdc.dev/latest');
    return html;
}

// Function to fetch articles using cheerio
async function getArticles() {
    try {
        const res = await gethtml();
        const $ = cheerio.load(res);

        const articles = [];

        $('.crayons-story').each((i, article) => {
            if (i < 10) {
                const title = $(article).find('.crayons-story__title a').text().trim();
                const link = $(article).find('.crayons-story__title a').attr('href');
                const userId = $(article).attr('data-content-user-id');

                if (title && link && userId) {
                    articles.push({
                        title,
                        link: `https://www.xdc.dev${link}`,
                        userId
                    });
                }
            }
        });

        return articles;
    } catch (error) {
        console.error('Error fetching articles:', error);
        return [];
    }
}

// Function to append new article userIds 
function appendArticles(newArticles) {
    let existingIds = new Set();

    try {
        if (fs.existsSync('articledata.json')) {
            const fileData = fs.readFileSync('articledata.json', 'utf-8').trim();

            if (fileData) {
                existingIds = new Set(JSON.parse(fileData));
            }
        }
    } catch (error) {
        console.error('Error reading JSON file:', error);
    }

    // Extract userIds from new articles and filter out duplicates
    const newIdsToAppend = newArticles
        .map(article => article.userId)
        .filter(userId => !existingIds.has(userId));

    if (newIdsToAppend.length > 0) {
        newIdsToAppend.forEach(userId => existingIds.add(userId));

        try {

            fs.writeFileSync('articledata.json', JSON.stringify([...existingIds], null, 2));
            console.log('User IDs successfully updated.');
        } catch (error) {
            console.error('Error writing to JSON file:', error);
        }
    }

    return newIdsToAppend;
}

// Telegram Bot functionality
bot.on('message', async (msg) => {
    try {
        console.log("Received message:", msg);
        const chatId = msg.chat.id;

        const articles = await getArticles();

        if (articles.length > 0) {
            await bot.sendMessage(chatId, 'Here are the latest articles:');
            for (let article of articles) {
                await bot.sendMessage(chatId, `${article.title} - ${article.link} (User ID: ${article.userId})`);
                await bot.sendMessage(userChatId, `${article.title} - ${article.link} (User ID: ${article.userId})`);
            }


            appendArticles(articles);
        } else {
            await bot.sendMessage(chatId, 'No new articles found!');
        }
    } catch (error) {
        console.error('Error occurred:', error);
        await bot.sendMessage(msg.chat.id, 'Something went wrong!');
    }
});

// Set interval to fetch and send articles every 1 minute (60000ms)
setInterval(async () => {
    try {
        const newArticles = await getArticles();

        if (newArticles.length > 0) {
            const newArticlesToAppend = appendArticles(newArticles);

            if (newArticlesToAppend.length > 0) {
                const chatId = '-1002311000423';
                for (let article of newArticlesToAppend) {
                    await bot.sendMessage(chatId, `${article.title} - ${article.link} (User ID: ${article.userId})`);
                    await bot.sendMessage(userChatId, `${article.title} - ${article.link} (User ID: ${article.userId})`);

                }
            } else {
                console.log('No new articles found.');
            }
        } else {
            console.log('No new articles found.');
            const chatId = '-1002311000423';
            await bot.sendMessage(chatId, 'No new articles found!');
            await bot.sendMessage(userChatId, 'No new articles found!');

        }
    } catch (error) {
        console.error('Error occurred during interval execution:', error);
    }
}, 60000); // 1-minute interval

// Handle bot restart and send missed articles
async function sendMissedArticles() {
    try {
        const existingArticles = fs.existsSync('articledata.json') ? JSON.parse(fs.readFileSync('articledata.json', 'utf-8')) : [];

        if (existingArticles.length > 0) {
            const chatId = '-1002311000423';
            for (let article of existingArticles) {
                await bot.sendMessage(chatId, `${article.title} - ${article.link} (User ID: ${article.userId})`);
                await bot.sendMessage(userChatId, `${article.title} - ${article.link} (User ID: ${article.userId})`);
            }
        }
    } catch (error) {
        console.error('Error occurred while sending missed articles:', error);
    }
}


sendMissedArticles();



