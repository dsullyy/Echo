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

    let conversationLog = [];

    try {
        await message.channel.sendTyping();
        let fetchedMessages = await message.channel.messages.fetch({ limit: 15 });
        console.log(fetchedMessages);
        let prevMessages = Array.from(fetchedMessages.values());
        prevMessages = prevMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        let conversationLog = conversationLogs.get(message.author.id);
        if (!conversationLog) {
            conversationLog = [{ role: 'system', content: 'You are an AI assistant named Echo \uD83D\uDD3A. Your primary role is to assist users with their trading related questions. Your secondary role is to track option trade positions, trading decisions, and price targets mentioned by @luckeee. When users ask about these topics, provide the latest information that @luckeee has mentioned.\uD83D\uDD0D I am still in the beta development stage, so please be patient with me \uD83D\uDE05' }];
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
            max_tokens: 1000,
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
                      max_tokens: 1000,
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
                max_tokens: 1000,
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