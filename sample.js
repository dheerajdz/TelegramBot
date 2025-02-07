const TelegramBot = require('node-telegram-bot-api');


const token = 'your token';

const bot = new TelegramBot(token, { polling: true });

console.log('Bot is running...');


bot.on('message', (msg) => {
    console.log('Received message:', msg);
    console.log(`Chat ID: ${msg.chat.id}`);


    bot.sendMessage(msg.chat.id, `Your Chat ID is: ${msg.chat.id}`);
});