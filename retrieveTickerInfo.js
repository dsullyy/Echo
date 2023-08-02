const createEmbeddingForMessage = require('./createEmbedding');
const computeCosineSimilarity = require('compute-cosine-similarity');

async function retrieveTickerInfo(message, ticker) {
    const tickerEmbedding = await createEmbeddingForMessage(ticker);
    
    const { MongoClient } = require('mongodb');
    await mongoClient.connect();
    const db = mongoClient.db('Aevitas DB');
    const collection = db.collection('LuckeeePositions');
    
    const messages = await collection.find({}).toArray();
    
    const similarities = messages.map(message => {
        return {
            message: message,
            similarity: computeCosineSimilarity(tickerEmbedding, message.embedding),
        };
    });
    
    const sortedMessages = similarities.sort((a, b) => b.similarity - a.similarity);
    const mostRelevantMessages = sortedMessages.slice(0, 10).map(item => item.message);

    // Generate a summary from the messages using OpenAI
    const messagesForOpenAI = messages.map(msg => ({ role: "admin", content: msg.message }));
    const prompt = {
        model: "gpt-3.5-turbo",
        messages: messagesForOpenAI,
        max_tokens: 2000
    };
    const result = await openai.createChatCompletion(prompt);
    const summary = result.data.choices[0].message.content.trim();

    // Close the connection to the MongoDB client
    await mongoClient.close();

    return summary;
}

module.exports = retrieveTickerInfo;