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
const channelIDs = [process.env.CHANNEL_ID1, process.env.CHANNEL_ID2];
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

  function relayMessage(message) {
    // Convert the message to lower case
    let messageContentLower = message.content.toLowerCase();
  
    // Check if the message is from the specific source channels
    if (message.channel.id === process.env.CHANNEL_ID4 && (message.author.id === process.env.SOURCE_USER_ID1 || message.author.id === process.env.SOURCE_USER_ID2)) {
        // Check if the message contains "SPY" or "SPX"
        if (messageContentLower.includes("spy") || messageContentLower.includes("spx")) {
            // Get the target channel to relay the message to
            let targetChannel = client.channels.cache.get(process.env.CHANNEL_ID3);
  
            // If the channel exists, send the message to that channel
            if (targetChannel) {
                console.log('Relaying message to target channel...');
                targetChannel.send(message.content); // Change this line
            } else {
                console.log('Target channel not found.');
            }
        }
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

// Listen for messages and pass them to the relayMessage function
client.on('messageCreate', relayMessage);

const configuration = new Configuration({
  apiKey: process.env.API_KEY,
});

const openai = new OpenAIApi(configuration);

let Echo = "ChatGPT";
let customPrompt = "You're a sage trading monk, steeped in the wisdom of a thousand years, having spent a millennium atop Mount Wudan";

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
    if (!channelIDs.includes(message.channel.id)) {
        console.log('Message is not in the specified channel, skipping...');
        return;
    }   

     // Call the relayMessage function
    relayMessage(message);

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

        // Add this line to check if the message starts with 'Echo' or a slash command
        if (!message.content.toLowerCase().startsWith('echo') && !message.content.startsWith('/faq')) {
            console.log('Message does not start with "Echo" or "/faq", skipping...');
            return;
        }

        const assistantMessage = result.data.choices[0].message.content.trim();
        await sendSplitMessage(message, assistantMessage);


        // If the message is a question or starts with 'echo', respond with an answer 
        if (message.content.startsWith(`/faq`)) {
            const userQuestion = message.content.slice(`$/faq`.length).trim();
        
            const userQuestionEmbedding = await createEmbedding(userQuestion);
        
            let bestMatch = { match: null, similarity: 0 };
        
            // Use cosine similarity to find the most similar FAQ question
            for (let faq of faqs) {
              const similarity = cosineSimilarity(userQuestionEmbedding, faq.embedding);
              if (similarity > bestMatch.similarity) {
                bestMatch = { match: faq, similarity: similarity };
              }
            }
        
            // Calculate similarity with TF-IDF
            tfidf.tfidfs(userQuestion, function (i, measure) {
              if (measure > bestMatch.similarity) {
                bestMatch = { match: faqs[i], similarity: measure };
              }
            });
        
            // If the TF-IDF similarity is above a certain threshold, reply with the FAQ answer
            const TFIDF_THRESHOLD = 0.3; // You will need to determine the appropriate threshold
            if (bestMatch.similarity > TFIDF_THRESHOLD) {
              await message.reply(bestMatch.match.answer);
            } else {
              for (let faq of faqs) {
                const similarities = await Promise.all(
                  faqs.map(async (faq) => {
                    const faqQuestion = faq.question;
        
                    console.log(`User question: ${userQuestion}`);
                    console.log(`Comparing with FAQ question: ${faqQuestion}`);
        
                    const result = await openai.createChatCompletion({
                      model: 'gpt-3.5-turbo',
                      messages: [
                        {
                          role: 'system',
                          content: `You are a helpful assistant. Evaluate the similarity of these two questions on a scale from 0 to 3.`,
                        },
                        {
                          role: 'user',
                          content: `Question 1: ${userQuestion}`,
                        },
                        {
                          role: 'assistant',
                          content: `Question 2: ${faqQuestion}`,
                        },
                      ],
                      temperature: 0.5,
                      max_tokens: 800,
                    });
        
                    console.log(result);
                    console.log(
                      `Completion response: ${JSON.stringify(
                        result.data.choices[0]
                      )}`
                    );
        
                    const similarity = Number(
                      result.data.choices[0].message.content.trim()
                    );
                    return { match: faq, similarity };
                  })
                );
        
                bestMatch = similarities.reduce(
                  (prev, curr) =>
                    curr.similarity > prev.similarity ? curr : prev,
                  bestMatch
                );
        
                if (bestMatch.match) {
                  await message.reply(bestMatch.match.answer);
                    }
                }
            }
        }        
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