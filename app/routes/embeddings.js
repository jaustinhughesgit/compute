const { OpenAIApi } = require("openai");

exports.handler = async (event) => {
    const openai = new OpenAIApi({
        apiKey: process.env.OPENAI_API_KEY,
    });

    try {
        const response = await openai.createEmbedding({
            model: "text-embedding-ada-002",
            input: event.text
        });

        return {
            statusCode: 200,
            body: JSON.stringify(response.data),
        };
    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error processing your request" }),
        };
    }
};