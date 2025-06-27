// parseArrayLogic.js
/* ------------------------------------------------------------------ */
/* Imports & constants                                                */
/* ------------------------------------------------------------------ */

const DOMAIN_SUBS = {
    "agriculture": [
        "agroeconomics",
        "agrochemicals",
        "agronomy",
        "agtech",
        "animal-health",
        "aquaculture",
        "aquaponics",
        "biodiversity",
        "biotechnology",
        "certification",
        "climate",
        "crop-production",
        "dairy",
        "data",
        "education",
        "engineering",
        "farm-equipment",
        "farm-management",
        "finance",
        "food-processing",
        "food-safety",
        "forestry",
        "genetics",
        "horticulture",
        "hydroponics",
        "irrigation",
        "labor",
        "land-use",
        "livestock",
        "marketing",
        "mechanization",
        "nutrition",
        "organic-farming",
        "pest-management",
        "plant-health",
        "policy",
        "postharvest",
        "precision-farming",
        "research",
        "robotics",
        "rural-development",
        "soil-science",
        "supply-chain",
        "sustainability",
        "vertical-farming",
        "waste-management",
        "water-management",
        "weed-management"
    ],
    "architecture": [
        "styles",
        "typologies",
        "approaches",
        "cultures",
        "domains",
        "structures",
        "theory",
        "history",
        "practice",
        "technology",
        "construction",
        "experience",
        "safety",
        "climate",
        "materials",
        "society",
        "education"
    ],
    "biology": [
        "anatomy",
        "astrobiology",
        "biochemistry",
        "bioengineering",
        "bioinformatics",
        "biogeography",
        "biomechanics",
        "biomedical science",
        "biophysics",
        "biotechnology",
        "botany",
        "cell biology",
        "chronobiology",
        "conservation",
        "cytogenetics",
        "developmental biology",
        "ecology",
        "endocrinology",
        "entomology",
        "environmental biology",
        "epidemiology",
        "epigenetics",
        "ethology",
        "evolutionary biology",
        "evo-devo",
        "genetics",
        "genomics",
        "histology",
        "immunology",
        "marine biology",
        "medical biology",
        "microbiology",
        "molecular biology",
        "molecular genetics",
        "mycology",
        "neuroscience",
        "nutritional biology",
        "ornithology",
        "paleobiology",
        "parasitology",
        "pathology",
        "pharmacology",
        "physiology",
        "population biology",
        "proteomics",
        "public health",
        "research",
        "structural biology",
        "systems biology",
        "taxonomy",
        "theoretical biology",
        "toxicology",
        "veterinary science",
        "virology",
        "wildlife biology",
        "xenobiology"
    ],
    "business": [
        "accounting",
        "advertising",
        "analytics",
        "business-development",
        "compliance",
        "consulting",
        "customer-service",
        "data-science",
        "economics",
        "entrepreneurship",
        "finance",
        "human-resources",
        "innovation",
        "international-business",
        "legal",
        "logistics",
        "management",
        "marketing",
        "operations",
        "procurement",
        "product-management",
        "project-management",
        "public-relations",
        "research-and-development",
        "sales",
        "strategy",
        "supply-chain",
        "sustainability",
        "taxation",
        "training"
    ],
    "characteristic": [
        "abstraction",
        "aesthetics",
        "authenticity",
        "balance",
        "calmness",
        "clarity",
        "color",
        "complexity",
        "consistency",
        "contrast",
        "convergence",
        "density",
        "dimension",
        "durability",
        "dynamism",
        "elegance",
        "energy",
        "expression",
        "fluidity",
        "form",
        "functionality",
        "hardness",
        "innovation",
        "integration",
        "intensity",
        "logic",
        "luster",
        "movement",
        "naturalness",
        "novelty",
        "nuance",
        "passion",
        "precision",
        "proportion",
        "rhythm",
        "rigidity",
        "scale",
        "sensitivity",
        "shape",
        "sincerity",
        "solidity",
        "sophistication",
        "structure",
        "temperature",
        "temporality",
        "texture",
        "timelessness",
        "transformation",
        "transparency",
        "viscosity",
        "weight"
    ],
    "chemistry": [
        "agrochemical",
        "analytical",
        "atmospheric",
        "biochemical",
        "ceramic",
        "chemical biology",
        "chemical engineering",
        "cheminformatics",
        "computational",
        "coordination",
        "cosmetic",
        "dye",
        "electrochemical",
        "energy",
        "environmental",
        "explosives",
        "food",
        "forensic",
        "glass",
        "green",
        "industrial",
        "inorganic",
        "materials",
        "medicinal",
        "nanochemical",
        "nuclear",
        "organic",
        "petrochemical",
        "pharmaceutical",
        "photochemistry",
        "physical",
        "polymer",
        "pulp",
        "quantum",
        "radiochemistry",
        "solid-state",
        "stereochemistry",
        "supramolecular",
        "surface",
        "textile",
        "theoretical",
        "water"
    ],
    "community": [
        "activism",
        "activities",
        "athletes",
        "classmates",
        "colleges",
        "commuting",
        "countrymen",
        "employees",
        "events",
        "family",
        "friends",
        "gaming",
        "global",
        "joint ventures",
        "leaders",
        "local",
        "meet-ups",
        "memberships",
        "mentees",
        "mentors",
        "message boards",
        "national",
        "neighbors",
        "organizations",
        "peers",
        "relationships",
        "rivals",
        "social",
        "state",
        "teams",
        "volunteers"
    ],
    "cosmology": [
        "alternative-gravity",
        "astrobiology",
        "astronomy",
        "astrophysics",
        "baryogenesis",
        "baryon-acoustic-oscillations",
        "big-bang",
        "black-holes",
        "celestial-mechanics",
        "cmb-anisotropies",
        "cosmic-microwave-background",
        "cosmic-topology",
        "cosmochemistry",
        "cosmological-parameters",
        "dark-energy",
        "dark-matter",
        "exoplanets",
        "expansion",
        "galaxies",
        "general-relativity",
        "gravitational-lensing",
        "gravitational-waves",
        "inflation",
        "interstellar-medium",
        "large-scale-structure",
        "multiverse",
        "numerical-cosmology",
        "observational-cosmology",
        "particle-cosmology",
        "planetary-science",
        "quantum-cosmology",
        "radio-astronomy",
        "redshift",
        "reionization",
        "solar-physics",
        "space-exploration",
        "space-telescopes",
        "spectroscopy",
        "star-formation",
        "stellar-evolution",
        "structure-formation",
        "supernovae",
        "time-dilation",
        "x-ray-astronomy"
    ],
    "economics": [
        "behavioral",
        "development",
        "financial",
        "environmental",
        "game-theory",
        "macroeconomics",
        "labor",
        "computational",
        "consumer",
        "corporate",
        "digital",
        "econometrics",
        "energy",
        "fiscal policy",
        "agricultural",
        "austrian",
        "business",
        "chicago school",
        "comparative",
        "cultural",
        "defense & military",
        "education",
        "entrepreneurial",
        "ethics in economics",
        "experimental",
        "gender",
        "global",
        "health",
        "history of economic thought",
        "housing",
        "industrial",
        "information",
        "innovation",
        "innovation & network",
        "institutional",
        "international",
        "keynesian",
        "law & economics",
        "maritime",
        "marxian",
        "mathematical",
        "media",
        "microeconomics",
        "migration",
        "monetary",
        "neuro",
        "optimization & decision theory",
        "political economy",
        "post-keynesian"
    ],
    "education": [
        "adult",
        "bilingual",
        "curriculum-development",
        "educational-technology-edtech",
        "experiential-learning",
        "financial-literacy",
        "history-of-education",
        "alternative",
        "assessment-evaluation",
        "career-technical-education-cte",
        "classroom-management",
        "coaching-mentorship",
        "comparative",
        "continuing",
        "early-childhood",
        "education-policy-administration",
        "education-psychology",
        "educational-equity-inclusion",
        "educational-leadership",
        "educational-research",
        "environmental",
        "gifted-talented",
        "higher",
        "home-schooling",
        "informal",
        "instructional-design",
        "language",
        "special-needs",
        "lifelong-learning",
        "mathematics",
        "medical",
        "military-training",
        "montessori-waldorf",
        "multicultural",
        "music",
        "online-blended-learning",
        "open-education-resources-oer",
        "outdoor-adventure",
        "parental-involvement-in-education",
        "performing-arts",
        "philosophy-of-education",
        "physical-education-pe",
        "professional-development-for-educators",
        "religious",
        "science",
        "sex",
        "social-emotional-learning-sel",
        "special",
        "standardized-testing-and-assessment",
        "stem-steam",
        "teacher-training-and-professional-development",
        "technical-and-vocational-education-tvet",
        "workplace-and-corporate-training",
        "writing-and-literacy-education"
    ],
    "entertainment": [
        "acting",
        "adult",
        "animation",
        "awards",
        "broadcasting",
        "casting",
        "celebrity",
        "concerts",
        "comedy",
        "cultural",
        "dance",
        "digital media",
        "distribution",
        "esports",
        "events",
        "fashion",
        "fan culture",
        "festivals",
        "gaming",
        "immersive",
        "licensing",
        "merchandising",
        "music",
        "performing arts",
        "podcasting",
        "publishing",
        "radio",
        "screenwriting",
        "social media",
        "sports",
        "streaming",
        "management",
        "television",
        "theater",
        "theme parks",
        "ticketing",
        "production",
        "visual effects (vfx)",
        "voice",
        "web"
    ],
    "environment": [
        "activism",
        "air-pollution",
        "biodiversity",
        "carbon-management",
        "circular-economy",
        "climate-change",
        "coastal-conservation",
        "deforestation",
        "eco-tourism",
        "education",
        "ecosystems",
        "ethics",
        "forestry",
        "freshwater",
        "green-building",
        "green-energy",
        "health",
        "industrial-ecology",
        "invasive-species",
        "land-degradation",
        "land-use",
        "law",
        "management",
        "noise",
        "nuclear-safety",
        "organic-farming",
        "pollution-control",
        "remote-sensing",
        "restoration",
        "resources",
        "soil-conservation",
        "sustainability",
        "toxicology",
        "urban-ecology",
        "waste-management"
    ],
    "event": [
        "cognitive",
        "commercial",
        "communication",
        "cosmic",
        "creative",
        "detection",
        "emotional",
        "environmental",
        "legal",
        "lifecycle",
        "operational",
        "recreational",
        "regulatory",
        "security",
        "social",
        "state",
        "system",
        "task"
    ],
    "food": [
        "agriculture",
        "beverages",
        "cuisines",
        "dining",
        "events",
        "food-science",
        "gastronomy",
        "health",
        "ingredients",
        "food",
        "cooking",
        "lifestyle",
        "meals",
        "nutrition",
        "organic",
        "production",
        "quality",
        "restaurants",
        "sustainability",
        "techniques",
        "types",
        "urban",
        "variety",
        "world",
        "x-factor",
        "yields",
        "zest"
    ],
    "geology": [
        "cartography",
        "climatology",
        "crystallography",
        "earthquake-seismology",
        "economic",
        "environmental",
        "geochemistry",
        "geochronology",
        "geodynamics",
        "geohazards",
        "geomorphology",
        "geophysics",
        "engineering",
        "hydrogeology",
        "mineralogy",
        "mining",
        "oceanography",
        "paleoclimatology",
        "paleontology",
        "petroleum",
        "petrology",
        "planetary",
        "remote-sensing",
        "research",
        "sedimentology",
        "soil-science",
        "stratigraphy",
        "structural",
        "tectonics",
        "volcanology",
        "water-resources"
    ],
    "geography": [
        "physical",
        "human",
        "urban",
        "regional",
        "economic",
        "political",
        "cultural",
        "geospatial",
        "environmental",
        "historical",
        "transportation",
        "climatology",
        "biogeography",
        "hazards",
        "location"
    ],
    "government": [
        "administration",
        "budget-and-finance",
        "civil-service",
        "defense",
        "diplomacy",
        "economic-development",
        "education-policy",
        "elections-and-voting",
        "emergency-management",
        "environmental-regulation",
        "foreign-affairs",
        "healthcare-policy",
        "homeland-security",
        "housing-and-urban-development",
        "identity-and-records",
        "immigration",
        "infrastructure",
        "intelligence-and-security",
        "international-cooperation",
        "judicial-affairs",
        "law-enforcement",
        "legislative-affairs",
        "local-government",
        "national-security",
        "policy-analysis",
        "public-administration",
        "public-health",
        "public-safety",
        "public-works",
        "regulation",
        "research",
        "social-services",
        "taxation-and-revenue",
        "transportation",
        "urban-planning",
        "veterans-affairs",
        "welfare-programs"
    ],
    "health": [
        "public-health",
        "clinical",
        "mental-health",
        "nutrition",
        "epidemiology",
        "prevention",
        "policy",
        "global-health",
        "environmental-health",
        "occupational-health",
        "dental",
        "pharmaceutical",
        "health-management",
        "fitness"
    ],
    "history": [
        "ancient",
        "archaeology",
        "archival-studies",
        "art",
        "biographical",
        "colonial",
        "cultural",
        "diplomatic",
        "economic",
        "environmental",
        "genealogy",
        "heritage-conservation",
        "historical-geography",
        "historical-linguistics",
        "historiography",
        "history-education",
        "industrial",
        "intellectual",
        "medieval",
        "military",
        "modern",
        "museum-studies",
        "oral-history",
        "paleography",
        "political",
        "public",
        "religious",
        "renaissance-studies",
        "research",
        "social-history",
        "technology",
        "urban",
        "world"
    ],
    "language": [
        "constructed",
        "body",
        "braille",
        "programming",
        "sign",
        "spoken",
        "symbolic",
        "written"
    ],
    "law": [
        "administrative",
        "constitutional",
        "criminal",
        "contract",
        "corporate",
        "environmental",
        "family",
        "health",
        "human-rights",
        "immigration",
        "intellectual-property",
        "international",
        "labor-employment",
        "real-estate"
    ],
    "manufacturing": [
        "additive",
        "casting",
        "electronics",
        "green",
        "high-precision",
        "nanomanufacturing",
        "welding",
        "biomanufacturing",
        "die casting",
        "fabrication",
        "injection",
        "just-in-time",
        "kaizen",
        "lean",
        "mass production",
        "on-demand",
        "plastics",
        "quality",
        "robotics",
        "smart",
        "tooling",
        "upcycling",
        "vertical",
        "xerography",
        "yield",
        "zero waste"
    ],
    "mathematics": [
        "algebra",
        "algorithms",
        "applied",
        "calculus",
        "combinatorics",
        "computational",
        "cryptography",
        "data analysis",
        "differential equations",
        "discrete",
        "econometrics",
        "financial",
        "game theory",
        "geometry",
        "graph theory",
        "logic",
        "mathematical biology",
        "mathematical modeling",
        "mathematical physics",
        "number theory",
        "numerical analysis",
        "operations research",
        "optimization",
        "probability",
        "pure mathematics",
        "quantitative finance",
        "quantum computing",
        "research",
        "set theory",
        "statistics",
        "stochastics",
        "education",
        "theoretical",
        "topology",
        "trigonometry"
    ],
    "people": [
        "activists",
        "artists",
        "athletes",
        "authors",
        "celebrities",
        "children",
        "coaches",
        "communities",
        "consumers",
        "creators",
        "educators",
        "employees",
        "entrepreneurs",
        "executives",
        "families",
        "freelancers",
        "government-officials",
        "influencers",
        "investors",
        "leaders",
        "managers",
        "media-personalities",
        "mentors",
        "musicians",
        "partners",
        "patients",
        "performers",
        "professionals",
        "public-figures",
        "researchers",
        "scientists",
        "seniors",
        "speakers",
        "specialists",
        "students",
        "teachers",
        "teams",
        "volunteers",
        "workers"
    ],
    "psychology": [
        "abnormal",
        "behavioral",
        "clinical",
        "cognitive",
        "comparative",
        "community",
        "counseling",
        "developmental",
        "educational",
        "environmental",
        "evolutionary",
        "experimental",
        "forensic",
        "health",
        "human factors",
        "i/o",
        "jungian",
        "kinesics",
        "learning",
        "multicultural",
        "neuropsychology",
        "occupational",
        "personality",
        "positive",
        "psychometrics",
        "quantitative",
        "rehabilitation",
        "social",
        "sport",
        "transpersonal",
        "unconscious",
        "vocational",
        "wellness",
        "xenopsychology",
        "youth",
        "zen"
    ],
    "philosophy": [
        "advocacy",
        "campaign management",
        "civil rights",
        "communications",
        "community organizing",
        "conflict resolution",
        "diplomacy",
        "economic policy",
        "education policy",
        "elections",
        "environmental policy",
        "foreign policy",
        "governance",
        "grassroots organizing",
        "health policy",
        "human rights",
        "immigration policy",
        "international relations",
        "legislation",
        "lobbying",
        "media and journalism",
        "national security",
        "nonprofit management",
        "political analysis",
        "political consulting",
        "political economy",
        "political science",
        "polling and surveys",
        "public administration",
        "public opinion",
        "public policy",
        "regulatory affairs",
        "research",
        "social justice",
        "think tanks",
        "urban policy",
        "voting rights"
    ],
    "religion": [
        "abrahamic",
        "buddhism",
        "christianity",
        "taoism",
        "esoteric",
        "folk",
        "gnosticism",
        "hinduism",
        "islam",
        "judaism",
        "kabbalah",
        "liturgy",
        "mysticism",
        "new age",
        "orthodox",
        "pagan",
        "quakerism",
        "reformation",
        "shinto",
        "theology",
        "universalism",
        "vedic",
        "wicca",
        "xuanxue",
        "yazidism",
        "zen"
    ],
    "sports": [
        "athletics",
        "basketball",
        "baseball",
        "cricket",
        "diving",
        "e-sports",
        "football",
        "golf",
        "hockey",
        "ice skating",
        "judo",
        "karate",
        "lacrosse",
        "mma",
        "netball",
        "orienteering",
        "polo",
        "quidditch",
        "rugby",
        "skateboarding",
        "tennis",
        "ultimate",
        "volleyball",
        "wrestling",
        "x games",
        "yachting",
        "zumba"
    ],
    "technology": [
        "actuators",
        "aerospace",
        "agtech",
        "ai",
        "analytics",
        "applications",
        "ar/vr",
        "automation",
        "automotive",
        "biotech",
        "blockchain",
        "cables",
        "circuit boards",
        "cloud",
        "communication",
        "consulting",
        "cybersecurity",
        "data science",
        "e-commerce",
        "edtech",
        "embedded systems",
        "energy",
        "engineering",
        "enterprise",
        "entertainment",
        "environment",
        "fintech",
        "forecasting",
        "gaming",
        "hardware",
        "health",
        "infrastructure",
        "iot",
        "logistics",
        "manufacturing",
        "maritime",
        "mobile",
        "nanotech",
        "networking",
        "peripherals",
        "platforms",
        "policy",
        "power management",
        "process",
        "programming",
        "proptech",
        "protocols",
        "quantum",
        "rail",
        "robotics",
        "saas",
        "semiconductors",
        "sensors",
        "smart home",
        "social media",
        "software",
        "storage",
        "telecom",
        "web"
    ],
    "transportation": [
        "aerospace",
        "autonomous vehicles",
        "aviation",
        "cargo and freight",
        "civil engineering",
        "electric vehicles (ev)",
        "fleet management",
        "high-speed rail",
        "infrastructure",
        "intelligent transport systems",
        "logistics",
        "marine transportation",
        "mass transit",
        "mobility-as-a-service (maas)",
        "passenger rail",
        "public transportation",
        "railroads",
        "research",
        "roadway safety",
        "shipping",
        "smart cities",
        "supply chain",
        "traffic engineering",
        "transit planning",
        "transportation economics",
        "transportation policy",
        "transportation safety",
        "trucking",
        "urban mobility",
        "vehicle electrification",
        "vehicle manufacturing",
        "vehicle sharing",
        "warehousing"
    ]
};

//const DOMAIN_SUBS = {...}

const DOMAINS = Object.keys(DOMAIN_SUBS);


const parseVector = v => {
    if (!v) return null;
    if (Array.isArray(v)) return v;
    try {
        return JSON.parse(v);
    } catch {
        return null;
    }
};

const cosineDist = (a, b) => {
    let dot = 0,
        na = 0,
        nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
};

const toVector = v => {
    if (!v) return null;
    const arr = Array.isArray(v) ? v : JSON.parse(v);
    if (!Array.isArray(arr)) return null;
    const len = Math.hypot(...arr);
    return len ? arr.map(x => x / len) : null;
};

const createArrayOfRootKeys = schema => {
    if (!schema || typeof schema !== "object") return [];
    const { properties } = schema;
    return properties && typeof properties === "object"
        ? Object.keys(properties)
        : [];
};

const calcMatchScore = (elementDists, item) => {
    let sum = 0,
        count = 0;
    for (let i = 1; i <= 5; i++) {
        const e = elementDists[`dist${i}`];
        const t = item[`dist${i}`];
        if (typeof e === "number" && typeof t === "number") {
            sum += Math.abs(e - t);
            count++;
        }
    }
    return count ? sum / count : Number.POSITIVE_INFINITY;
};




// ===== reference resolver  (unchanged from previous drop-in) =====
const REF_REGEX = /^__\$ref\((\d+)\)(.*)$/;

function resolveArrayLogic(arrayLogic) {
    const cache = new Array(arrayLogic.length);
    const resolving = new Set();

    const deepResolve = val => {
        if (typeof val === "string") {
            const m = val.match(REF_REGEX);
            if (m) {
                const [, idxStr, restPath] = m;
                const target = resolveElement(Number(idxStr));
                if (!restPath) return target;
                const segs = restPath.replace(/^\./, "").split(".");
                let out = target;
                for (const s of segs) { if (out == null) break; out = out[s]; }
                return deepResolve(out);                          // nested refs
            }
        }
        if (Array.isArray(val)) return val.map(deepResolve);
        if (val && typeof val === "object")
            return Object.fromEntries(Object.entries(val).map(
                ([k, v]) => [k, deepResolve(v)]
            ));
        return val;
    };

    const resolveElement = i => {
        if (cache[i] !== undefined) return cache[i];
        if (resolving.has(i)) throw new Error(`Circular __$ref at index ${i}`);
        resolving.add(i);
        cache[i] = deepResolve(arrayLogic[i]);
        resolving.delete(i);
        return cache[i];
    };

    return arrayLogic.map((_, i) => resolveElement(i));
}

// ===== utilities for shorthand conversion ========================
const OFFSET = 1;                                  // because of the [{}] row
const padRef = n => String(n).padStart(3, "0") + "!!"; // 003 → "003!!"
const OP_ONLY = /^__\$(?:ref)?\((\d+)\)$/;          // "__$(n)"  or "__$ref(n)"

const convertShorthandRefs = v => {
    if (typeof v === "string") {
        const m = v.match(OP_ONLY);
        if (m) return padRef(Number(m[1]) + OFFSET);
        return v;
    }
    if (Array.isArray(v)) return v.map(convertShorthandRefs);
    if (v && typeof v === "object")
        return Object.fromEntries(Object.entries(v).map(
            ([k, val]) => [k, convertShorthandRefs(val)]
        ));
    return v;
};

// recognise element kinds -----------------------------------------
const isOperationElem = obj =>
    obj && typeof obj === "object" && !Array.isArray(obj) &&
    Object.keys(obj).length === 1 &&
    (() => { const v = obj[Object.keys(obj)[0]]; return v && v.input && v.schema; })();

const isSchemaElem = obj =>
    obj && typeof obj === "object" && !Array.isArray(obj) && "properties" in obj;

// ===== OpenAI domain helpers (unchanged) =========================
const callOpenAI = async ({ openai, str, list, promptLabel, schemaName }) => {
    const rsp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        top_p: 0,
        seed: 42,
        messages: [{
            role: "user", content:
                `IN ONE WORD, which ${promptLabel} best fits:\n"${str}"\n${list.join(" ")}`
        }]
    });
    const guess = rsp.choices[0].message.content.trim().split(/\s+/)[0].toLowerCase();
    if (list.includes(guess)) return guess;

    const strict = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        top_p: 0,
        seed: 42,
        response_format: {
            type: "json_schema",
            json_schema: {
                name: schemaName, strict: true,
                schema: {
                    type: "object",
                    properties: { [promptLabel]: { type: "string", enum: list } },
                    required: [promptLabel], additionalProperties: false
                }
            }
        },
        messages: [
            { role: "system", content: `You are a classifier that picks the best ${promptLabel}.` },
            { role: "user", content: `Which ${promptLabel} best fits: "${str}"?` }
        ]
    });
    return JSON.parse(strict.choices[0].message.content)[promptLabel];
};

const buildBreadcrumbApp = async ({ openai, str }) => {
    console.log("openai 4", openai)
  const rsp = await openai.chat.completions.create({
    model: "gpt-4o-2024-08-06",
    // hard-constraint the output to valid JSON
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a JSON-only assistant. Reply with a single valid JSON object and nothing else."
      },
      { role: "user", content: str }
    ]
  });

  return rsp.choices[0].message.content; // already JSON-parsable
};

const classifyDomains = async ({ openai, text }) => {
    const domain = await callOpenAI({
        openai, str: JSON.stringify(text),
        list: DOMAINS, promptLabel: "domain", schemaName: "domain_classification"
    });
    const subList = DOMAIN_SUBS[domain] ?? [];
    let subdomain = "";
    if (subList.length)
        subdomain = await callOpenAI({
            openai, str: JSON.stringify(text), list: subList,
            promptLabel: "subdomain", schemaName: "subdomain_classification"
        });
    return { domain, subdomain };
};

// =======   UPDATED parseArrayLogic   =============================
async function parseArrayLogic({ arrayLogic = [], dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL } = {}) {

    console.log("openai1", openai)
    // --- 0. resolve __$ref() within incoming arrayLogic -------------
    const resolvedLogic = resolveArrayLogic(arrayLogic);

    // --- 1. shorthand starts with the empty placeholder row ---------
    const shorthand = [];          // row 000
    const results = [];                // diagnostics (unchanged)

    let routeRowNewIndex = null;         // remember for conclusion wiring

    // --- 2. walk each original element ------------------------------
    for (let i = 0; i < arrayLogic.length; i++) {
        const origElem = arrayLogic[i];

        if (i === arrayLogic.length - 1 && origElem?.conclusion !== undefined) {
            continue;          // <- ignore original conclusion row
        }

        const elem = resolvedLogic[i];

        // ---------- SCHEMA / JSON-object rows -------------------------
        if (!isOperationElem(origElem)) {

            // (a) JSON-Schema  → list of root keys
            if (isSchemaElem(origElem)) {
                shorthand.push(createArrayOfRootKeys(elem));
            }
            // (b) plain object (incl. timeOfDay etc.)  → wrap in array
            else if (origElem && typeof origElem === "object") {
                shorthand.push([convertShorthandRefs(elem)]);
            }
            else {                               // primitives / arrays
                shorthand.push([convertShorthandRefs(elem)]);
            }
            continue;
        }

        // ---------- OPERATION (ROUTE) row -----------------------------
        const [breadcrumb] = Object.keys(elem);        // same
        const body = elem[breadcrumb];
        const origBody = origElem[breadcrumb];     // UNRESOLVED version

        console.log("openai 2", openai)
        // --- domain / embedding / best-match  (original logic) -------
        const { domain, subdomain } = await classifyDomains({ openai, text: elem });

        const {
            data: [{ embedding: rawEmb }]
        } = await openai.embeddings.create({
            model: "text-embedding-3-large",
            input: JSON.stringify(elem)
        });
        const embedding = toVector(rawEmb);

        let dynamoRecord = null;
        let [dist1, dist2, dist3, dist4, dist5] = Array(5).fill(null);
        try {
            const { Items } = await dynamodb
                .query({
                    TableName: `i_${domain}`,
                    KeyConditionExpression: "#r = :pk",
                    ExpressionAttributeNames: { "#r": "root" },
                    ExpressionAttributeValues: { ":pk": subdomain },
                    Limit: 1
                })
                .promise();
            dynamoRecord = Items?.[0] ?? null;
        } catch (err) {
            console.error("DynamoDB query failed:", err);
        }
        if (dynamoRecord) {
            const embKeys = ["emb1", "emb2", "emb3", "emb4", "emb5"];
            [dist1, dist2, dist3, dist4, dist5] = embKeys.map(k => {
                const ref = parseVector(dynamoRecord[k]);
                return Array.isArray(ref) && ref.length === embedding.length
                    ? cosineDist(embedding, ref)
                    : null;
            });
        }
        let subdomainMatches = [];
        if (dist1 != null) {
            try {
                const params = {
                    TableName: "subdomains",
                    IndexName: "path-index",
                    KeyConditionExpression: "#p = :path AND #d1 BETWEEN :d1lo AND :d1hi",
                    ExpressionAttributeNames: {
                        "#p": "path", "#d1": "dist1", "#d2": "dist2",
                        "#d3": "dist3", "#d4": "dist4", "#d5": "dist5"
                    },
                    ExpressionAttributeValues: {
                        ":path": `/${domain}/${subdomain}`,
                        ":d1lo": dist1 - 0.03, ":d1hi": dist1 + 0.03,
                        ":d2lo": dist2 - 0.03, ":d2hi": dist2 + 0.03,
                        ":d3lo": dist3 - 0.03, ":d3hi": dist3 + 0.03,
                        ":d4lo": dist4 - 0.03, ":d4hi": dist4 + 0.03,
                        ":d5lo": dist5 - 0.03, ":d5hi": dist5 + 0.03
                    },
                    FilterExpression:
                        "#d2 BETWEEN :d2lo AND :d2hi AND " +
                        "#d3 BETWEEN :d3lo AND :d3hi AND " +
                        "#d4 BETWEEN :d4lo AND :d4hi AND " +
                        "#d5 BETWEEN :d5lo AND :d5hi",
                    ScanIndexForward: true
                };
                const { Items } = await dynamodb.query(params).promise();
                subdomainMatches = Items ?? [];
            } catch (err) {
                console.error("subdomains GSI query failed:", err);
            }
        }
        let bestMatch = null;
        if (subdomainMatches.length) {
            bestMatch = subdomainMatches.reduce(
                (best, item) => {
                    const score = calcMatchScore(
                        { dist1, dist2, dist3, dist4, dist5 },
                        item
                    );
                    return score < best.score ? { item, score } : best;
                },
                { item: null, score: Number.POSITIVE_INFINITY }
            ).item;
        }

        // ---- build ROUTE shorthand row ------------------------------
        const inputParam = convertShorthandRefs(
            origBody?.input ?? body.input        // preserve "__$(n)" / "__$ref(n)"
        );
        const expectedKeys = createArrayOfRootKeys(body.schema);
        const schemaParam = convertShorthandRefs(expectedKeys);


        if (!bestMatch?.su) {
            // create a entity
            // get the entityID
            // reference the entityid from the rowresult as the bestMatch

            console.log("bestMatch.su is null")
            shorthand.push(
                [
                    "ROUTE",
                    {},
                    {},
                    "newGroup",
                    "a5",
                    "a5"
                ]
            )

            routeRowNewIndex = shorthand.length;   // remember (e.g. 003)
            console.log("shorthand", shorthand)
            console.log("???", ["GET", padRef(routeRowNewIndex), "response", "file"])
            shorthand.push(
                    ["GET", padRef(routeRowNewIndex), "response", "file"]
            )

            shorthand.push(
                [
                    "ROUTE",
                    {},
                    {},
                    "getFile",
                    padRef(routeRowNewIndex + 1),
                    ""
                ]
            )

            shorthand.push(
                    ["GET", padRef(routeRowNewIndex + 2), "response"]
            )
            console.log("elem", elem)
            const breadcrumbObject = JSON.stringify(elem);

            let newJPL = `directive = [ "**this is not a simulation**: do not make up or falsify any data, and do not give placeholder/example URLs! This is real data!", "you are a JSON logic app generator.", "You will review the 'example' json for understanding on how to program the 'logic' json object", "You will create a new JSON object based on the details in the desiredApp object like the breadcrumbs path, input json, and output schema.", "Then you build a new JSON logic that best represents (accepts the inputs as body, and products the outputs as a response.", "please give only the 'logic' object, meaning only respond with JSON", "Don't include any of the logic.modules already created." ];`; 
            newJPL = newJPL + ` let desiredApp = ${breadcrumbObject}; var express = require('express'); const serverless = require('serverless-http'); const app = express(); let { requireModule, runAction } = require('./processLogic'); logic = {}; logic.modules = {"axios": "axios","math": "mathjs","path": "path"}; for (module in logic.modules) {requireModule(module);}; app.all('*', async (req, res, next) => {logic.actions.set = {"URL":URL,"req":req,"res":res,"JSON":JSON,"Buffer":Buffer,"email":{}};for (action in logic.actions) {await runAction(action, req, res, next);};});`; 
            newJPL = newJPL + ` var example = {"modules":{ "{shuffle}":"lodash",/*shuffle = require('lodash').shuffle*/ "moment-timezone":"moment-timezone"/*moment-timezone = require('moment-timezone')*/ }, "actions":[ {"set":{"latestEmail":"{|email=>[0]|}"}},/*latestEmail = email[0]*/ {"set":{"latestSubject":"{|latestEmail=>subject|}"}},/*lastSubject = latestEmail.subject*/ {"set":{"userIP":"{|req=>ip|}"}},/*userIP = req.ip*/ {"set":{"userAgent":"{|req=>headers.user-agent|}"}},/*userAgent = req.headers['user-agent']*/ {"set":{"userMessage":"{|req=>body.message|}"}},/*userMessage = req.body.message*/ {"set":{"pending":[] }},/*pendingRequests = []*/ {"target":"{|axios|}","chain":[{"access":"get","params":["https://httpbin.org/ip"] }],"promise":"raw","assign":"{|pending=>[0]|}!"},/*pendingRequests[0] = axios.get("https://httpbin.org/ip")*/ {"target":"{|axios|}","chain":[{"access":"get","params":["https://httpbin.org/user-agent"] }],"promise":"raw","assign":"{|pending=>[1]|}!"},/*pendingRequests[1] = axios.get("https://httpbin.org/user-agent")*/ `; 
            newJPL = newJPL + `{"target":"{|Promise|}","chain":[{"access":"all","params":["{|pending|}"] }],"assign":"{|results|}"},/*results = Promise.all(pendingRequests)*/ {"set":{"httpBinIP":"{|results=>[0].data.origin|}"}},/*httpBinIP = results[0].data.origin*/ {"set":{"httpBinUA":"{|results=>[1].data['user-agent']|}"}},/*httpBinUA = results[1].data['user-agent']*/ {"target":"{|axios|}","chain":[{"access":"get","params":["https://ipapi.co/{|userIP|}/json/"] }],"assign":"{|geoData|}"},/*geoData = await axios.get("https://ipapi.co/"+userIP+"/json/")*/ {"set":{"city":"{|geoData=>data.city|}"}},/*city = geoData.data.city*/ {"set":{"timezone":"{|geoData=>data.timezone|}"}},//timezone = geoData.data.timezone {"target":"{|moment-timezone|}","chain":[{"access":"tz","params":["{|timezone|}"] }],"assign":"{|now|}"},/*now = new momentTimezone.tz(timezone)*/ {"target":"{|now|}!","chain":[{"access":"format","params":["YYYY-MM-DD"] }],"assign":"{|today|}"},/*today = now.format('YYYY-MM-DD')*/ {"target":"{|now|}!","chain":[{"access":"hour"}],"assign":"{|hour|}"},`; 
            newJPL = newJPL + `/*hour = now.hour()*/ {"set":{"timeOfDay":"night"}},/*timeOfDay = "night"*/ {"if":[["{|hour|}",">=","{|=3+3|}"], ["{|hour|}","<", 12]],"set":{"timeOfDay":"morning"}},/*if (hour >= math(3+3) && hour < 12) {timeOfDay = "morning"}*/ {"if":[["{|hour|}",">=",12], ["{|hour|}","<", 18]],"set":{"timeOfDay":"afternoon"}},/*if(hour >= 12 && hour < 18) {timeOfDay = "afternoon"}*/ {"if":[["{|hour|}",">=","{|=36/2|}"], ["{|hour|}","<", 22]],"set":{"timeOfDay":"evening"}},/*if (hour >= math(36/2) && hour < 22) {timeOfDay = "evening"}*/ {"set":{"extra":3}},/*extra = 3*/ {"set":{"maxIterations":"{|=5+{|extra|}|}"}},/*maxIterations = math(5 + extra)*/ {"set":{"counter":0}},/*counter = 0*/ {"set":{"greetings":[]}},/*greetings = []*/ {"while":[["{|counter|}","<","{|maxIterations|}"]],"nestedActions":[{"set":{"greetings=>[{|counter|}]":"Hello number {|counter|}"}},{"set":{"counter":"{|={|counter|}+1|}"}}]},/*while (counter < maxIterations) {greetings[counter] = "Hello number " + counter;  counter = math(counter+1)}*/ {"assign":"{|generateSummary|}",`; 
            newJPL = newJPL + `"params":["prefix","remark"],"nestedActions":[{"set":{"localZone":"{|~/timezone|}"}},{"return":"{|prefix|} {|remark|} {|~/greetings=>[0]|} Visitor from {|~/city|} (IP {|~/userIP|}) said '{|~/userMessage|}'. Local timezone:{|localZone|} · Time-of-day:{|~/timeOfDay|} · Date:{|~/today|}."}]},/*generateSummary = (prefix, remark) => {generateSummary.prefix = prefix; generateSummary.remark = remark; generateSummary.localZone = timezone; return \`\${prefix} \${remark|} \${greetings[0]} Visitor from \${city} (IP \${userIP}) said '\${userMessage}'. Local timezone:\${localZone} · Time-of-day:\${timeOfDay} · Date:\${today}.\`}*/ {"target":"{|generateSummary|}!","chain":[{"assign":"","params":["Hi.","Here are the details."] }],"assign":"{|message|}"},/*message = generateSummary("Hi.", "Here are the details.")*/ {"target":"{|res|}!","chain":[{"access":"send","params":["{|message|}"]}]}/*res.send(message)*/ ]}`;

            console.log(newJPL);

            console.log("openai 3", openai)
            let obj = await buildBreadcrumbApp({openai, str:newJPL})
            console.log("obj", obj)
            let objectJPL = JSON.parse(obj);
            console.log("objectJPL", objectJPL)

            console.log("objectJPL.actions", objectJPL.actions)
            shorthand.push(
                    ["NESTED", padRef(routeRowNewIndex + 3), "published", "actions", objectJPL.actions]
            )

            if (objectJPL.modules){
                shorthand.push(
                        ["NESTED", padRef(routeRowNewIndex + 4), "published", "modules", objectJPL.modules]
                )
            } else {
                shorthand.push(
                        ["NESTED", padRef(routeRowNewIndex + 4), "published", "modules", {} ]
                )
            }
            

            shorthand.push(
                [
                    "ROUTE",
                    padRef(routeRowNewIndex + 5),
                    {},
                    "saveFile",
                    padRef(routeRowNewIndex + 1),
                    ""
                ]
            ) 



            shorthand.push(
                [
                    "SLEEP", 3000
                ]
            ) 

            shorthand.push([
                "ROUTE",
                {},
                {},
                "runEntity",
                padRef(routeRowNewIndex + 1),
                ""
            ]);
        } else {




            shorthand.push([
                "ROUTE",
                inputParam,
                schemaParam,
                "runEntity",
                bestMatch?.su ?? null,
                ""
            ]);


        }

        routeRowNewIndex = shorthand.length;   // remember (e.g. 003)
    }

    // --- 3. add conclusion logic  -----------------------------------
    // original conclusion element is always the last in arrayLogic
    const lastOrig = arrayLogic[arrayLogic.length - 1] || {};
    if (lastOrig && typeof lastOrig === "object" && "conclusion" in lastOrig) {
        // (a) GET  row to extract  <routeRow!!.output>
        const getRowIndex = shorthand.push(
            ["ADDPROPERTY", "000!!", "conclusion", padRef(routeRowNewIndex)]//, "output"]
        ) - 1;

        // (b) ROWRESULT row – places the conclusion object into 000!!
        shorthand.push([
            "ROWRESULT",
            "000",
            padRef(getRowIndex + 1)
        ]);
    }

    // --- 4. shift & convert any remaining "__$(n)" tokens ----------
    const finalShorthand = shorthand.map(convertShorthandRefs);

    console.log("⇢ shorthand", JSON.stringify(finalShorthand, null, 2));

    // ------ return the finished shorthand (plus diagnostics) -------
    return { shorthand: finalShorthand, details: results };
}

module.exports = { parseArrayLogic };
