var express = require('express');
var router = express.Router();

const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: "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", //process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

router.get('/', async function(req, res, next) {
	let oai = await runPrompt(q);
    console.log(oai);
	res.render('index', { embeddings: oai });
  });

  async function runPrompt(question){
	const prompt = question;

	const response = await openai.createCompletion({
		model: "text-davinci-003",
		prompt: prompt,
		max_tokens: 2048,
		temperature: 1,
	});

	const parsableJSONresponse = response.data.choices[0].text;
	console.log(parsableJSONresponse)
	const parsedResponse = JSON.parse(parsableJSONresponse);
	let resp = parsedResponse.A.split(",")
	console.log("Question: ", parsedResponse.Q);
	console.log("Answer: ", parsedResponse.A);
  return "Which product fits you best? " + "[" + resp[0] + "] or [" + resp[1] + "]"
};

var q = `
give me a list of 20 industries where SaaS products are very popular. Provide the response in .csv format. Return response in the following parsable JSON format:
{
	"Q": "question",
	"A": "answer"
}
`