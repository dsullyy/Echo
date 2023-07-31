require('dotenv').config();
const fs = require('fs');
const Discord = require('discord.js');
const { Configuration, OpenAIApi } = require("openai");
const { Client, GatewayIntentBits } = Discord;
const { prefix } = require('./config.json');
const Bottleneck = require('bottleneck');
const conversationLogs = new Map();
const faqs = require('./faqs.json');
const natural = require('natural');
const axios = require('axios');
const channelIDs = [process.env.CHANNEL_ID1, process.env.CHANNEL_ID2, process.env.CHANNEL_ID3];
const botUsername = "Echo";
const { getOriginalPrompt, getCustomPrompt } = require('./promptUtils');
const commandsFile = './commands';
const pinecone = require("@pinecone-database/pinecone");
const vector = pinecone.vector;

let TfIdf = natural.TfIdf;
let tfidf = new TfIdf();

for (let faq of faqs) {
    tfidf.addDocument(faq.question);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

async function getEarningsData(ticker) {
    // Validate ticker
    if (!ticker || typeof ticker !== 'string') {
        throw new Error('Invalid ticker symbol');
    }

    try {
        const response = await axios.get(`https://api.twelvedata.com/earnings?symbol=${ticker}&apikey=process.env.ER_API_KEY`);
        const data = response.data;

        console.log(data); 

        const nextEarnings = data.find(entry => new Date(entry.date) > new Date());
        if (nextEarnings) {
            return {
                date: nextEarnings.date,
                epsEstimate: nextEarnings.epsEstimate,
            };
        } else {
            return null;
        }
    } catch (error) {
        console.error(`Error getting earnings data for ${ticker}: ${error}`);
        throw error;
    }
}

async function relayMessage(message) {
    if (message.channel.id === process.env.CHANNEL_ID3) {
        // Relay all messages from CHANNEL_ID3 to CHANNEL_ID4
        try {
            let targetChannel = await client.channels.fetch(process.env.CHANNEL_ID4);

            if (targetChannel) {
                // Create a new MessageOptions object to hold the content and any attachments
                let messageOptions = {
                    content: "@everyone " + message.content, // Add @everyone at the start of the message
                    files: [],
                };

                // If there are any attachments, add their URLs to the MessageOptions object
                if (message.attachments.size > 0) {
                    message.attachments.each(attachment => {
                        messageOptions.files.push(attachment.url);
                    });
                }

                // Send the message with attachments to the target channel
                targetChannel.send(messageOptions);
                console.log('Message relayed successfully.');
            } else {
                console.log('Target channel not found.');
            }
        } catch (error) {
            console.log('An error occurred while fetching the target channel:', error);
        }
        
        if ((message.author.id === process.env.SOURCE_USER_ID1 || 
            message.author.id === process.env.SOURCE_USER_ID2 || 
            message.author.id === process.env.SOURCE_USER_ID3) &&
            (message.content.toLowerCase().includes("spy") || 
            message.content.toLowerCase().includes("spx"))) {
            // Relay certain users' messages from CHANNEL_ID3 to CHANNEL_ID2 if they contain "spy" or "spx"
            try {
                let targetChannel = await client.channels.fetch(process.env.CHANNEL_ID2);

                if (targetChannel) {
                    // Create a new MessageOptions object to hold the content and any attachments
                    let messageOptions = {
                        content: "@everyone " + message.content, // Add @everyone at the start of the message
                        files: [],
                    };

                    // If there are any attachments, add their URLs to the MessageOptions object
                    if (message.attachments.size > 0) {
                        message.attachments.each(attachment => {
                            messageOptions.files.push(attachment.url);
                        });
                    }

                    // Send the message with attachments to the target channel
                    targetChannel.send(messageOptions);
                    console.log('Message relayed successfully.');
                } else {
                    console.log('Target channel not found.');
                }
            } catch (error) {
                console.log('An error occurred while fetching the target channel:', error);
            }
        }
    } else {
        console.log(`Message is not in the right channel or not from the right user, skipping.`);
    }
}

client.commands = new Discord.Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.name, command);
}

client.on('ready', () => {
  console.log('Echo is online!');
});

const configuration = new Configuration({
  apiKey: process.env.API_KEY,
});

const openai = new OpenAIApi(configuration);

let Echo = "ChatGPT";
let customPrompt = "You're a sage trading monk, steeped in the wisdom of a thousand years, having spent a millennium atop Mount Wudan. Consistency and depth are key to your character. Focus on leveraging your deep learning from the OpenAI models such as chatgpt-3.5-turbo. Your main function is to craft insightful, human-like responses about financial markets and trading strategies, demonstrating remarkable adaptability across various fields. Employ a combination of techniques including few-shot prompting, chain-of-thought prompting, self-consistency, and automatic prompt engineering (APE) to maximize the quality of your responses. Tailor your strategies based on user preferences and continually refine your methods based on feedback. Be meticulous in reviewing your outputs, enhancing both your capabilities and user satisfaction. Continually strive for unrivalled precision, quality, and impact in your answers, iterating and improving your processes. Your goal is to not only excel in the generation of trading insights but also to consistently exceed user expectations, thus becoming a beacon of excellence in AI assistance in the financial trading realm.";

console.log(getOriginalPrompt(Echo));
console.log(getCustomPrompt(Echo, customPrompt));

// Creating a Bottleneck rate limiter
const limiter = new Bottleneck({
  minTime: 2000, // Minimum time between job executions in ms
});

 // Define the sendSplitMessage function outside of the event handler
 async function sendSplitMessage(message, assistantMessage) {
    if (assistantMessage.length <= 2000) {
     await message.reply(assistantMessage);
    } else {
        let splitMessage = assistantMessage.split(/(?<=[.!?])\s+/);
        let toSend = '';

        while (splitMessage.length > 0) {
            if ((toSend.length + splitMessage[0].length + 1) <= 2000) { // account for the space
                toSend += ' ' + splitMessage.shift();
            } else {
                await message.reply(toSend);
                toSend = '';
            }
        }

        if (toSend.length > 0) {
             await message.reply(toSend);
         }
    }
}

client.on('messageCreate', async (message) => {
    console.log(`Received message: ${message.content}`);

    if (message.author.bot) {
        console.log('Message author is a bot, skipping...');
        return;
    }

    // Relay messages if they meet the criteria
    if (channelIDs.includes(message.channel.id)) {
        await relayMessage(message);
        if (message.channel.id === process.env.CHANNEL_ID3) {
            // If the message is in CHANNEL_ID3, do not attempt to respond
            return;
        }
    } else {
        console.log('Message is not in the specified channel, skipping...');
    }

    // Process '.er' command
    if (message.content.startsWith('.er ')) {
        const ticker = message.content.split(' ')[1];
        getEarningsData(ticker)
            .then(earningsData => {
                if (earningsData) {
                    message.reply(`Next earnings for ${ticker} is on ${earningsData.date} with EPS estimate ${earningsData.epsEstimate}.`);
                } else {
                    message.reply(`No upcoming earnings data available for ${ticker}.`);
                }
            })
            .catch(err => {
                if (err.message === 'Invalid ticker symbol') {
                    message.reply('Please provide a valid ticker symbol.');
                } else {
                    message.reply('There was an error getting the earnings data. Please try again later.');
                }
                console.error(`Error getting earnings data for ${ticker}: ${err}`);
            });

        // Stop further processing of this message
        return;
    }

    // Only process messages that include 'echo'
    if (!message.content.toLowerCase().includes('echo')) {
        console.log('Message does not include "Echo", skipping...');
        return;
    }

    try {
        await message.channel.sendTyping();
        let fetchedMessages = await message.channel.messages.fetch({ limit: 15 });
        console.log(fetchedMessages);
        let prevMessages = Array.from(fetchedMessages.values());
        prevMessages = prevMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        let conversationLog = conversationLogs.get(message.author.id);
        if (!conversationLog) {
            // Using getOriginalPrompt function
            const botUsername = "Echo";
            const initialPrompt = getOriginalPrompt(botUsername);
            conversationLog = [{ role: 'system', content: initialPrompt }];
            conversationLogs.set(message.author.id, conversationLog);
        }

        console.log('Previous messages fetched, starting to build conversation log...');

        prevMessages.forEach((msg) => {
            if (msg.author.id == client.user.id) {
                conversationLog.push({ role: 'assistant', content: msg.content });
            } else if (msg.author.id == message.author.id) {
                conversationLog.push({ role: 'user', content: msg.content });
            }
        });

        // Adding the current user's message to the conversation log.
        conversationLog.push({ role: 'user', content: message.content });

        // Check if the message is a question using OpenAI
        const result = await openai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: conversationLog,
            max_tokens: 800,
        });

        const assistantMessage = result.data.choices[0].message.content.trim();
        await sendSplitMessage(message, assistantMessage);
     
    } catch (error) {
        console.error(`Error during API call: ${error}`);
        console.log('Conversation log built, starting chat completion...');
        console.log('About to call openai.createChatCompletion...');

        // Using the rate limiter to make requests to the OpenAI API
        let conversationLog = [];
        let assistantMessage;
        try {
            const assistantResponse = await openai.createChatCompletion({
                model: 'gpt-3.5-turbo',
                messages: conversationLog,
                max_tokens: 800,
            });
            
            assistantMessage = assistantResponse.data.choices[0].message.content;
        } catch (error) {
            return;
        }

        try {
            console.log('Successfully called openai.createChatCompletion.');
            const assistantMessage = assistantResponse.data.choices[0].message.content;
            await sendSplitMessage(message, assistantMessage);
            console.log(`Assistant's message: ${assistantMessage}`); 
            conversationLog.push({ role: 'assistant', content: assistantMessage });
        } catch (err) {
            console.error(`An error occurred: ${err}`); 
        }
        
        console.log('Response sent.');
    }
});

client.login(process.env.BOT_TOKEN)