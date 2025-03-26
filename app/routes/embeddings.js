var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default;

function normalizeVector(vector) {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / norm);
}

//not updating 1

router.get('/', async function(req, res, next) {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const response = await openai.embeddings.create({
            input: `{
    "input": [
        "/event/wedding/people/groom/todo/wedding-day/gather-items",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/rings",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/vows",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/watch-or-phone",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/wallet-and-id",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/tuxedo",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/shoes",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/socks",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/belt-or-suspenders",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/shirt",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/bowtie-or-tie",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/cufflinks",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/pocket-square",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/jacket",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit/deodorant",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit/hair-product",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit/razor",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit/comb-or-brush",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit/cologne",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/overnight-bag",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/overnight-bag/change-of-clothes",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/overnight-bag/toiletries",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/overnight-bag/charger",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit/pain-reliever",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit/stain-remover",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit/mints",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit/sewing-kit",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit/band-aids",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/gift-or-note-for-bride",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/photo-checklist"
    ],
    "expecting": [
        "/event/wedding/people/groom/success/wedding-day",
        "/event/wedding/people/groom/success/wedding-day/woke-up-on-time",
        "/event/wedding/people/groom/success/wedding-day/ate-and-hydrated",
        "/event/wedding/people/groom/success/wedding-day/groomed-and-dressed",
        "/event/wedding/people/groom/success/wedding-day/arrived-at-venue-on-time",
        "/event/wedding/people/groom/success/wedding-day/brought-all-necessary-items",
        "/event/wedding/people/groom/success/wedding-day/had-rings",
        "/event/wedding/people/groom/success/wedding-day/had-vows",
        "/event/wedding/people/groom/success/wedding-day/stayed-calm-and-present",
        "/event/wedding/people/groom/success/wedding-day/looked-good-in-photos",
        "/event/wedding/people/groom/success/wedding-day/enjoyed-getting-ready-moments",
        "/event/wedding/people/groom/success/wedding-day/checked-in-with-officiant",
        "/event/wedding/people/groom/success/wedding-day/shared-meaningful-moments-with-family",
        "/event/wedding/people/groom/success/wedding-day/supported-the-bride",
        "/event/wedding/people/groom/success/wedding-day/made-it-down-the-aisle",
        "/event/wedding/people/groom/success/wedding-day/delivered-vows",
        "/event/wedding/people/groom/success/wedding-day/married-the-love-of-his-life",
        "/event/wedding/people/groom/success/wedding-day/celebrated-with-friends-and-family",
        "/event/wedding/people/groom/success/wedding-day/nailed-the-first-dance",
        "/event/wedding/people/groom/success/wedding-day/gave-or-listened-to-meaningful-speeches",
        "/event/wedding/people/groom/success/wedding-day/had-fun-at-reception",
        "/event/wedding/people/groom/success/wedding-day/thank-you-said-to-guests",
        "/event/wedding/people/groom/success/wedding-day/goodbye-said-to-family",
        "/event/wedding/people/groom/success/wedding-day/smooth-exit-or-send-off",
        "/event/wedding/people/groom/success/wedding-day/ready-for-honeymoon-or-night-away",
        "/event/wedding/people/groom/success/wedding-day/day-felt-special",
        "/event/wedding/people/groom/success/wedding-day/memories-made",
        "/event/wedding/people/groom/success/wedding-day/no-regrets"
    ],
    "performing": [
        "/event/wedding/people/groom/todo/wedding-day",
        "/event/wedding/people/groom/todo/wedding-day/wake-up-on-time",
        "/event/wedding/people/groom/todo/wedding-day/hydrate-and-eat-breakfast",
        "/event/wedding/people/groom/todo/wedding-day/shower-and-grooming",
        "/event/wedding/people/groom/todo/wedding-day/attire/check-tux",
        "/event/wedding/people/groom/todo/wedding-day/attire/get-dressed",
        "/event/wedding/people/groom/todo/wedding-day/gather-items",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/rings",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/vows",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit",
        "/event/wedding/people/groom/todo/wedding-day/photo-session",
        "/event/wedding/people/groom/todo/wedding-day/photo-session/getting-ready",
        "/event/wedding/people/groom/todo/wedding-day/photo-session/first-look",
        "/event/wedding/people/groom/todo/wedding-day/photo-session/wedding-party",
        "/event/wedding/people/groom/todo/wedding-day/check-in-with-officiant",
        "/event/wedding/people/groom/todo/wedding-day/check-in-with-planner",
        "/event/wedding/people/groom/todo/wedding-day/relax-and-breathe",
        "/event/wedding/people/groom/todo/wedding-day/ceremony/start-on-time",
        "/event/wedding/people/groom/todo/wedding-day/ceremony/smile",
        "/event/wedding/people/groom/todo/wedding-day/ceremony/say-vows",
        "/event/wedding/people/groom/todo/wedding-day/ceremony/kiss",
        "/event/wedding/people/groom/todo/wedding-day/reception/make-entrance",
        "/event/wedding/people/groom/todo/wedding-day/reception/first-dance",
        "/event/wedding/people/groom/todo/wedding-day/reception/speeches-toast",
        "/event/wedding/people/groom/todo/wedding-day/reception/dinner",
        "/event/wedding/people/groom/todo/wedding-day/reception/cake-cutting",
        "/event/wedding/people/groom/todo/wedding-day/reception/dance-with-mom",
        "/event/wedding/people/groom/todo/wedding-day/reception/have-fun",
        "/event/wedding/people/groom/todo/wedding-day/thank-guests",
        "/event/wedding/people/groom/todo/wedding-day/send-off",
        "/event/wedding/people/groom/todo/wedding-day/pack-overnight-bag"
    ]
}`,
            model: "text-embedding-3-large",
        });

        const embedding = response.data[0].embedding;
        const normalizedEmbedding = normalizeVector(embedding);

        res.render('embeddings', {
            category: `{
    "input": [
        "/event/wedding/people/groom/todo/wedding-day/gather-items",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/rings",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/vows",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/watch-or-phone",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/wallet-and-id",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/tuxedo",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/shoes",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/socks",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/belt-or-suspenders",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/shirt",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/bowtie-or-tie",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/cufflinks",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/pocket-square",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/jacket",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit/deodorant",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit/hair-product",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit/razor",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit/comb-or-brush",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/grooming-kit/cologne",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/overnight-bag",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/overnight-bag/change-of-clothes",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/overnight-bag/toiletries",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/overnight-bag/charger",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit/pain-reliever",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit/stain-remover",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit/mints",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit/sewing-kit",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit/band-aids",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/gift-or-note-for-bride",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/photo-checklist"
    ],
    "expecting": [
        "/event/wedding/people/groom/success/wedding-day",
        "/event/wedding/people/groom/success/wedding-day/woke-up-on-time",
        "/event/wedding/people/groom/success/wedding-day/ate-and-hydrated",
        "/event/wedding/people/groom/success/wedding-day/groomed-and-dressed",
        "/event/wedding/people/groom/success/wedding-day/arrived-at-venue-on-time",
        "/event/wedding/people/groom/success/wedding-day/brought-all-necessary-items",
        "/event/wedding/people/groom/success/wedding-day/had-rings",
        "/event/wedding/people/groom/success/wedding-day/had-vows",
        "/event/wedding/people/groom/success/wedding-day/stayed-calm-and-present",
        "/event/wedding/people/groom/success/wedding-day/looked-good-in-photos",
        "/event/wedding/people/groom/success/wedding-day/enjoyed-getting-ready-moments",
        "/event/wedding/people/groom/success/wedding-day/checked-in-with-officiant",
        "/event/wedding/people/groom/success/wedding-day/shared-meaningful-moments-with-family",
        "/event/wedding/people/groom/success/wedding-day/supported-the-bride",
        "/event/wedding/people/groom/success/wedding-day/made-it-down-the-aisle",
        "/event/wedding/people/groom/success/wedding-day/delivered-vows",
        "/event/wedding/people/groom/success/wedding-day/married-the-love-of-his-life",
        "/event/wedding/people/groom/success/wedding-day/celebrated-with-friends-and-family",
        "/event/wedding/people/groom/success/wedding-day/nailed-the-first-dance",
        "/event/wedding/people/groom/success/wedding-day/gave-or-listened-to-meaningful-speeches",
        "/event/wedding/people/groom/success/wedding-day/had-fun-at-reception",
        "/event/wedding/people/groom/success/wedding-day/thank-you-said-to-guests",
        "/event/wedding/people/groom/success/wedding-day/goodbye-said-to-family",
        "/event/wedding/people/groom/success/wedding-day/smooth-exit-or-send-off",
        "/event/wedding/people/groom/success/wedding-day/ready-for-honeymoon-or-night-away",
        "/event/wedding/people/groom/success/wedding-day/day-felt-special",
        "/event/wedding/people/groom/success/wedding-day/memories-made",
        "/event/wedding/people/groom/success/wedding-day/no-regrets"
    ],
    "performing": [
        "/event/wedding/people/groom/todo/wedding-day",
        "/event/wedding/people/groom/todo/wedding-day/wake-up-on-time",
        "/event/wedding/people/groom/todo/wedding-day/hydrate-and-eat-breakfast",
        "/event/wedding/people/groom/todo/wedding-day/shower-and-grooming",
        "/event/wedding/people/groom/todo/wedding-day/attire/check-tux",
        "/event/wedding/people/groom/todo/wedding-day/attire/get-dressed",
        "/event/wedding/people/groom/todo/wedding-day/gather-items",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/rings",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/vows",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/emergency-kit",
        "/event/wedding/people/groom/todo/wedding-day/photo-session",
        "/event/wedding/people/groom/todo/wedding-day/photo-session/getting-ready",
        "/event/wedding/people/groom/todo/wedding-day/photo-session/first-look",
        "/event/wedding/people/groom/todo/wedding-day/photo-session/wedding-party",
        "/event/wedding/people/groom/todo/wedding-day/check-in-with-officiant",
        "/event/wedding/people/groom/todo/wedding-day/check-in-with-planner",
        "/event/wedding/people/groom/todo/wedding-day/relax-and-breathe",
        "/event/wedding/people/groom/todo/wedding-day/ceremony/start-on-time",
        "/event/wedding/people/groom/todo/wedding-day/ceremony/smile",
        "/event/wedding/people/groom/todo/wedding-day/ceremony/say-vows",
        "/event/wedding/people/groom/todo/wedding-day/ceremony/kiss",
        "/event/wedding/people/groom/todo/wedding-day/reception/make-entrance",
        "/event/wedding/people/groom/todo/wedding-day/reception/first-dance",
        "/event/wedding/people/groom/todo/wedding-day/reception/speeches-toast",
        "/event/wedding/people/groom/todo/wedding-day/reception/dinner",
        "/event/wedding/people/groom/todo/wedding-day/reception/cake-cutting",
        "/event/wedding/people/groom/todo/wedding-day/reception/dance-with-mom",
        "/event/wedding/people/groom/todo/wedding-day/reception/have-fun",
        "/event/wedding/people/groom/todo/wedding-day/thank-guests",
        "/event/wedding/people/groom/todo/wedding-day/send-off",
        "/event/wedding/people/groom/todo/wedding-day/pack-overnight-bag"
    ]
}`,
            embedding: JSON.stringify(embedding),
            normalized: JSON.stringify(normalizedEmbedding),
        });
    } catch (error) {
        console.error("Error generating embeddings:", error);
        res.status(500).send("Failed to generate embeddings.");
    }
});

module.exports = router;