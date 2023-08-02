const computeCosineSimilarity = require('compute-cosine-similarity');

async function getSimilarMessages(embedding, ticker, mongoClient) {
    console.log("Getting similar messages...");
    await mongoClient.connect();
    const db = mongoClient.db('AevitasDB');
    const collection = db.collection('LuckeeePositions');

    // Retrieve all messages related to the ticker
    console.log("Retrieving messages related to the ticker:", ticker);
    const cursor = collection.find({ ticker: ticker });

    // Compute the cosine similarity between the request embedding and each message's embedding
    const similarities = [];
    console.log("Computing cosine similarity for each message...");
    await cursor.forEach(doc => {
        console.log("Processing message:", doc);
        // Log the content of the doc variable
        console.log("Message retrieved from database:", doc.message);
        const similarity = computeCosineSimilarity(embedding, doc.embedding);
        // Log the computed similarity
        console.log("Computed similarity:", similarity);
        similarities.push({ similarity, message: doc.message });
    });

    console.log("Similarities computed:", similarities);

    // Sort by similarity in descending order and return the top 5 messages
    const topSimilarities = similarities.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
    console.log("Top 5 similar messages:", topSimilarities);

    return topSimilarities;
}

module.exports = getSimilarMessages;