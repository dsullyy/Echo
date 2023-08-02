const axios = require('axios');
const openai = require('openai');

async function createEmbeddingForMessage(message) {
    try {
        const response = await axios.post('https://api.openai.com/v1/embeddings', {
            input: message,
            model: 'text-embedding-ada-002'
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status != 200) {
            console.error(`OpenAI API returned status ${response.status}`);
            return null;
        }

        if (!response.data || !response.data.data || !response.data.data[0]) {
            console.error('Unexpected response structure from OpenAI API:', response.data);
            return null;
        }

        return response.data.data[0].embedding;

    } catch (error) {
        console.error('Error during OpenAI API call:', error);
        return null;
    }
}

module.exports = createEmbeddingForMessage;