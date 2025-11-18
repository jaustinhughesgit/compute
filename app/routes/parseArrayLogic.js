// parseArrayLogic.js
/* ------------------------------------------------------------------ */
/* Imports & constants                                                */
/* ------------------------------------------------------------------ */

const DOMAINS = [
  "agriculture",
  "architecture",
  "biology",
  "business",
  "characteristic",
  "chemistry",
  "community",
  "cosmology",
  "economics",
  "education",
  "entertainment",
  "environment",
  "event",
  "food",
  "geology",
  "geography",
  "government",
  "health",
  "history",
  "language",
  "law",
  "manufacturing",
  "mathematics",
  "people",
  "psychology",
  "philosophy",
  "religion",
  "sports",
  "technology",
  "transportation"
]

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



const anchorsUtil = require('./anchors');
const { DynamoDB } = require('aws-sdk');
const { Converter } = DynamoDB;

const ANCHOR_BANDS_TABLE     = process.env.ANCHOR_BANDS_TABLE     || 'anchor_bands';
const PERM_GRANTS_TABLE      = process.env.PERM_GRANTS_TABLE      || 'perm_grants';
const PERM_GSI_BY_PRINCIPAL  = process.env.PERM_GSI_BY_PRINCIPAL  || 'by_principal';
const DEFAULT_POLICY_PREFIX  = process.env.POLICY_PREFIX          || 'entity';

// marshal helper for low-level numeric attributes
const n = (x) => ({ N: typeof x === 'string' ? x : String(x) });

const DOMAIN_INDEX_BUCKET = "public.1var.com";
const DOMAIN_INDEX_KEY = process.env.DOMAIN_INDEX_KEY || "nestedDomainIndex.json";

// nestedDomainIndex.json format
// {domains:{"<domain>":{"text":"[<subdomain>,<subdomain>,...]","embedding":[],"subdomains":{...}},"<domain>":{...}}}

let _domainIndexCache = null;

const _normalizeVec = (v) => {
  if (!Array.isArray(v) || v.length === 0) return null;
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = 1 / (Math.sqrt(s) + 1e-12);
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
};

const _ensureUnit = (v) => {
  const arr = Array.isArray(v) ? v : (typeof v === "string" ? JSON.parse(v) : null);
  return _normalizeVec(arr);
};

async function _loadDomainIndexFromS3({ s3, key = DOMAIN_INDEX_KEY }) {
  if (_domainIndexCache) return _domainIndexCache;
  const obj = await s3.getObject({ Bucket: DOMAIN_INDEX_BUCKET, Key: key }).promise();
  const idx = JSON.parse(obj.Body.toString("utf8"));

  // Precompute unit vectors
  for (const [, dNode] of Object.entries(idx.domains || {})) {
    dNode._embU = _ensureUnit(dNode.embedding);
    for (const [, sNode] of Object.entries(dNode.subdomains || {})) {
      sNode._embU = _ensureUnit(sNode.embedding);
    }
  }
  _domainIndexCache = idx;
  return idx;
}

async function _embedUnit({ openai, text }) {
  const { data: [{ embedding }] } = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text
  });
  return _normalizeVec(embedding);
}

async function _computeAnchorPayload({ s3, openai, text }) {
  try {
    const t = String(text || '').trim();
    if (!t) return null;

    const anchors = await anchorsUtil.loadAnchors({ s3 });
    const eU = await _embedUnit({ openai, text: t });

    const topL0 = Number(process.env.ANCHORS_TOP_L0 || 2);
    const assigns = anchorsUtil.assign(eU, anchors, { topL0 });

    return {
      setId: anchors.setId,
      band_scale: anchors.band_scale,
      num_shards: anchors.num_shards,
      assigns: assigns.map(a => ({
        l0: a.l0, l1: a.l1, band: a.band, dist_q16: a.dist_q16
      }))
    };
  } catch (err) {
    console.error('anchor assign failed:', err && err.message);
    return null;
  }
}

const _cosineDistUnit = (a, b) => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return 1 - dot;
};

async function classifyDomainsByEmbeddingFromS3({
  s3,
  openai,
  key = DOMAIN_INDEX_KEY,
  textForEmbedding
}) {
  const idx = await _loadDomainIndexFromS3({ s3, key });
  const q = await _embedUnit({ openai, text: textForEmbedding });

  // 1) best domain by centroid
  const domainScores = [];
  for (const [dName, dNode] of Object.entries(idx.domains || {})) {
    if (!dNode?._embU || dNode._embU.length !== q.length) continue;
    domainScores.push({ domain: dName, dist: _cosineDistUnit(q, dNode._embU) });
  }
  if (!domainScores.length) throw new Error("No usable domain embeddings in index.");
  domainScores.sort((a, b) => a.dist - b.dist);
  const best = domainScores[0];
  const runnerUp = domainScores[1] || { dist: Infinity };
  const margin = runnerUp.dist - best.dist;

  // 2) best subdomain
  const pickSubWithin = (dName) => {
    const subs = [];
    for (const [sName, sNode] of Object.entries(idx.domains[dName].subdomains || {})) {
      if (!sNode?._embU || sNode._embU.length !== q.length) continue;
      subs.push({ subdomain: sName, dist: _cosineDistUnit(q, sNode._embU) });
    }
    subs.sort((a, b) => a.dist - b.dist);
    return subs[0] || null;
  };

  const pickSubGlobally = () => {
    const all = [];
    for (const [dName, dNode] of Object.entries(idx.domains || {})) {
      for (const [sName, sNode] of Object.entries(dNode.subdomains || {})) {
        if (!sNode?._embU || sNode._embU.length !== q.length) continue;
        all.push({ domain: dName, subdomain: sName, dist: _cosineDistUnit(q, sNode._embU) });
      }
    }
    all.sort((a, b) => a.dist - b.dist);
    return all[0] || null;
  };

  const AMBIG_MARGIN = 0.008;
  if (margin <= AMBIG_MARGIN) {
    const subBest = pickSubGlobally();
    if (!subBest) throw new Error("No usable subdomain embeddings.");
    return { domain: subBest.domain, subdomain: subBest.subdomain, debug: { method: "global-subdomain", margin } };
  } else {
    const subBest = pickSubWithin(best.domain);
    if (!subBest) throw new Error(`Domain '${best.domain}' has no usable subdomains.`);
    return { domain: best.domain, subdomain: subBest.subdomain, debug: { method: "domain-then-subdomain", margin } };
  }
}

/* ------------------------------------------------------------------ */
/* Small math/helpers                                                 */
/* ------------------------------------------------------------------ */
const parseVector = v => {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return null; }
};

const cosineDist = (a, b) => {
  let dot = 0, na = 0, nb = 0;
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
  let sum = 0, count = 0;
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

/* ------------------------------------------------------------------ */
/* ArrayLogic ref resolver & helpers                                  */
/* ------------------------------------------------------------------ */
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
        return deepResolve(out);
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

const OFFSET = 1;
const padRef = n_ => String(n_).padStart(3, "0") + "!!";
const OP_ONLY = /^__\$(?:ref)?\((\d+)\)$/;

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

const isOperationElem = obj =>
  obj && typeof obj === "object" && !Array.isArray(obj) &&
  Object.keys(obj).length === 1 &&
  (() => { const v = obj[Object.keys(obj)[0]]; return v && v.input && v.schema; })();

const isSchemaElem = obj =>
  obj && typeof obj === "object" && !Array.isArray(obj) && "properties" in obj;

/* ------------------------------------------------------------------ */
/* Strict JSON-only app gen helper (unchanged API)                    */
/* ------------------------------------------------------------------ */
const buildLogicSchema = {
  name: "build_logic",
  description: "Create a structured modules/actions JSON payload for the logic runner.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["modules", "actions"],
    properties: {
      modules: {
        type: "object",
        description: "Map from local alias → npm-package name.",
        additionalProperties: {
          type: "string",
          description: "Exact name of the npm package to `require`."
        }
      },
      actions: { $ref: "#/$defs/actionList" }
    },
    $defs: {
      jsonVal: {
        oneOf: [
          { type: "string" }, { type: "number" }, { type: "boolean" },
          { type: "object" }, { type: "array", items: {} }
        ]
      },
      decorators: {
        type: "object",
        properties: {
          if: { $ref: "#/$defs/conditionArray" },
          while: { $ref: "#/$defs/conditionArray" },
          timeout: { type: "integer", minimum: 0 },
          next: { type: "boolean" },
          promise: { enum: ["raw", "await"] }
        },
        additionalProperties: false
      },
      chainItem: {
        type: "object",
        required: ["access"],
        additionalProperties: false,
        properties: {
          access: { type: "string" },
          params: { type: "array", items: { $ref: "#/$defs/jsonVal" } },
          new: { type: "boolean" },
          express: { type: "boolean" },
          next: { type: "boolean" },
          return: { $ref: "#/$defs/jsonVal" }
        }
      },
      chainArray: { type: "array", items: { $ref: "#/$defs/chainItem" } },
      conditionTuple: {
        type: "array", minItems: 3, maxItems: 3,
        prefixItems: [
          { type: "string" },
          { enum: ["==","!=", "<",">","<=",">=","===","!==","in","includes"] },
          { $ref: "#/$defs/jsonVal" }
        ]
      },
      conditionArray: { type: "array", items: { $ref: "#/$defs/conditionTuple" } },
      actionList: { type: "array", items: { $ref: "#/$defs/actionObject" } },
      actionObject: {
        type: "object",
        allOf: [
          { $ref: "#/$defs/decorators" },
          {
            additionalProperties: false,
            oneOf: [
              { required: ["set"], properties: { set: { type: "object" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["target","chain"], properties: { target: { type: "string" }, chain: { $ref: "#/$defs/chainArray" }, assign: { type: "string" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["if","set"], properties: { if: { $ref: "#/$defs/conditionArray" }, set: { type: "object" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["while","nestedActions"], properties: { while: { $ref: "#/$defs/conditionArray" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["assign","params","nestedActions"], properties: { assign: { type: "string" }, params: { type: "array", items: { type: "string" } }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["return"], properties: { return: { $ref: "#/$defs/jsonVal" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { title: "else", required: ["else"], properties: { else: { $ref: "#/$defs/actionObject" } } }
            ]
          }
        ]
      }
    }
  }
};

const buildBreadcrumbApp = async ({ openai, str }) => {
  const rsp = await openai.chat.completions.create({
    model: "gpt-4o-2024-08-06",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a JSON-only assistant. Reply with a single valid JSON object and nothing else." },
      { role: "user", content: str }
    ],
    functions: [buildLogicSchema],
    function_call: { name: "build_logic" }
  });

  const fc = rsp.choices[0].message.function_call;
  fc.arguments = fc.arguments.replaceAll(/\{\|req=>body(?!\.body)/g, '{|req=>body.body');
  const args = JSON.parse(fc.arguments);
  return args;
};

/* ------------------------------------------------------------------ */
/* Optional domain classifier (string-only fallback; not used here)   */
/* ------------------------------------------------------------------ */
const callOpenAI = async ({ openai, str, list, promptLabel, schemaName }) => {
  const rsp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    top_p: 0,
    seed: 42,
    messages: [{
      role: "user",
      content: `IN ONE WORD, which ${promptLabel} best fits:\n"${str}"\n${list.join(" ")}`
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

/* ------------------------------------------------------------------ */
/* Prompt → arrayLogic (unchanged)                                    */
/* ------------------------------------------------------------------ */
async function buildArrayLogicFromPrompt({ openai, prompt }) {
  const rsp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    top_p: 0,
    seed: 42,
    messages: [{
      role: "system",
      content:
        "You are a JSON-only assistant. Reply with **only** a valid JSON " +
        "array—the arrayLogic representation of the user’s request. " +
        "No prose. No markdown. No code fences. No comments!!"
    },
    { role: "user", content: prompt }
    ]
  });
  let text = rsp.choices[0].message.content.trim();

  function stripComments(jsonLike) {
    let out = '';
    let inString = false, quote = '', escaped = false;
    let inSL = false, inML = false;

    for (let i = 0; i < jsonLike.length; i++) {
      const c = jsonLike[i], n = jsonLike[i + 1];

      if (inSL) {
        if (c === '\n' || c === '\r') { inSL = false; out += c; }
        continue;
      }
      if (inML) {
        if (c === '*' && n === '/') { inML = false; i++; }
        continue;
      }
      if (inString) {
        out += c;
        if (!escaped && c === quote) { inString = false; quote = ''; }
        escaped = !escaped && c === '\\';
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true; quote = c; out += c; continue;
      }
      if (c === '/' && n === '/') { inSL = true; i++; continue; }
      if (c === '/' && n === '*') { inML = true; i++; continue; }

      out += c;
    }
    return out;
  }

  text = stripComments(text);

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error("Model response did not contain a JSON array.");
  }

  text = text.slice(start, end + 1);
  return JSON.parse(text);
}

/* ------------------------------------------------------------------ */
/* ACL helpers                                                        */
/* ------------------------------------------------------------------ */
async function _ensureOwnerGrant({ dynamodb, su, e, perms = "rwdop" }) {
  try {
    if (!su || !e) return;
    const now = Math.floor(Date.now() / 1000);
    await dynamodb.put({
      TableName: PERM_GRANTS_TABLE,
      Item: {
        entityID: String(su),
        principalID: `u:${e}`,
        perms,
        created: now
      }
    }).promise();
  } catch (err) {
    console.warn("perm_grants owner seed failed:", err && err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                              */
/* ------------------------------------------------------------------ */
async function parseArrayLogic({
  arrayLogic = [],
  dynamodb,    // DocumentClient (safe for non-pb ops)
  uuidv4,
  s3,
  ses,
  openai,
  Anthropic,
  dynamodbLL,  // Low-level DynamoDB for pb ops
  sourceType,
  actionFile,
  out,
  e,
  requestOnly = false
} = {}) {

  if (sourceType === "prompt") {
    if (typeof arrayLogic !== "string") {
      throw new TypeError("When sourceType === 'prompt', arrayLogic must be a string.");
    }
    arrayLogic = await buildArrayLogicFromPrompt({ openai, prompt: arrayLogic });
  }

  const resolvedLogic = resolveArrayLogic(arrayLogic);

  const shorthand = [];
  const createdEntities = [];
  const results = [];
  let routeRowNewIndex = null;

  // helper to safely build the huge numeric pb as a string representation
  const buildPb = (possessedCombined, d1) =>
    (d1 != null)
      ? `${possessedCombined.toString()}.${d1.toString().replace(/^0?\./, "")}`
      : null;

  // presence check only (uses DocumentClient)
  const loadExistingEntityRow = async (su) => {
    try {
      const { Item } = await dynamodb.get({
        TableName: "subdomains",
        Key: { su }
      }).promise();
      return Item || null;
    } catch (e) {
      console.error("subdomains.get failed", e);
      return null;
    }
  };

  /* ---- anchor_bands helpers (writes postings) ----
     UPDATED: allow optional policy_id to be stamped on postings */
  async function _putAllBatched(table, items) {
    if (!items || !items.length) return 0;
    let written = 0;
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25).map(Item => ({ PutRequest: { Item } }));
      const params = { RequestItems: { [table]: chunk } };
      let backoff = 100;
      while (true) {
        const rsp = await dynamodb.batchWrite(params).promise();
        const un = rsp.UnprocessedItems?.[table] || [];
        written += chunk.length - un.length;
        if (!un.length) break;
        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 2000);
        params.RequestItems[table] = un;
      }
    }
    return written;
  }

  async function _fanoutAnchorBands({ su, setId, anchor, type = 'su', policy_id }) {
    const assigns = anchor?.assigns || [];
    if (!su || !setId || !assigns.length) return 0;
    const rows = assigns.map(a => {
      const base = anchorsUtil.makePosting({ setId, su, assign: a, type, shards: anchorsUtil.DEFAULT_NUM_SHARDS });
      return policy_id ? { ...base, policy_id } : base;   // ★ attach policy pointer
    });
    return _putAllBatched(ANCHOR_BANDS_TABLE, rows);
  }

  for (let i = 0; i < arrayLogic.length; i++) {
    const origElem = arrayLogic[i];

    if (i === arrayLogic.length - 1 && origElem?.conclusion !== undefined) {
      continue;
    }

    const elem = resolvedLogic[i];





    //systematically go throuogh and log and get the logic below here to create a new app using the curent mood and the user prompt. 
    // Then apply add that mood to the primary entity.




    let fixedOutput;
    let fixedPossessed;
    let fixedDate;

    console.log("---------------------")
    console.log("---------------------")
    console.log("---------------------")
    console.log("---------------------")
    console.log("---------------------")
    console.log("---------------------")

    if (!isOperationElem(origElem)) {
      if (isSchemaElem(origElem)) {
        let arr = createArrayOfRootKeys(elem)
        console.log("1-shorthand",arr)
        shorthand.push(arr);
      } else if (origElem && typeof origElem === "object") {
        let arr = [convertShorthandRefs(elem)]
        console.log("2-shorthand",arr)
        shorthand.push(arr);
      } else {
        let arr = [convertShorthandRefs(elem)]
        console.log("3-shorthand",arr)
        shorthand.push([convertShorthandRefs(elem)]);
      }
      continue;
    }

    const bc = Object.keys(elem)[0];

    if (Object.prototype.hasOwnProperty.call(elem[bc], "output")) {
      fixedOutput = elem[bc].output;
      delete elem[bc].output;
    }
    if (Object.prototype.hasOwnProperty.call(elem[bc], "possessedBy")) {
      fixedPossessed = elem[bc].possessedBy;
      delete elem[bc].possessedBy;
    }
    if (Object.prototype.hasOwnProperty.call(elem[bc], "date")) {
      fixedDate = elem[bc].date;
      delete elem[bc].date;
    }

    const [breadcrumb] = Object.keys(elem);
    const body = elem[breadcrumb];

    // Prefer the *user's request* when requestOnly === true
    const b = elem[bc];
    const inp = b?.input && typeof b.input === 'object' ? b.input : {};
    let userReqText = null;

    if (typeof out === "string" && out.trim()) userReqText = out.trim();

    if (!userReqText) {
      const candidate =
        inp.user_requests ?? inp.user_request ?? inp.request ?? inp.query ?? inp.q ?? inp.word ?? inp.words ?? null;
      if (Array.isArray(candidate)) userReqText = candidate.map(String).join(' ').trim();
      else if (typeof candidate === 'string') userReqText = candidate.trim();
    }

    const textForEmbedding = requestOnly
      ? (userReqText || b?.input?.name || b?.input?.title || (typeof out === "string" && out) || JSON.stringify(elem))
      : (b?.input?.name || b?.input?.title || (typeof out === "string" && out) || JSON.stringify(elem));

    const { domain, subdomain } = await classifyDomainsByEmbeddingFromS3({
      s3,
      openai,
      key: "nestedDomainIndex.json",
      textForEmbedding
    });

    // possessedCombined base & indexes
    const base = 1000000000000000.0;
    const domainIndex = 10000000000000 * (DOMAINS.indexOf(domain) >= 0 ? DOMAINS.indexOf(domain) : 0);
    const subdomainIndex = 100000000000 * ((DOMAIN_SUBS[domain] || []).indexOf(subdomain) >= 0
      ? (DOMAIN_SUBS[domain] || []).indexOf(subdomain)
      : 0);
    const userID = e || 0;
    const possessedCombined = base + domainIndex + subdomainIndex + userID;

    // embedding
    const embInput = (requestOnly ? textForEmbedding : JSON.stringify(elem));
    const embText = typeof embInput === 'string' ? embInput.trim() : String(embInput);
    const { data: [{ embedding: rawEmb }] } = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: embText
    });
    const embedding = toVector(rawEmb);

    // get subdomain vector refs
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

    // low-level pb-index query
    let subdomainMatches = [];
    if (dist1 != null) {
      const pbStr = buildPb(possessedCombined, dist1);

      try {
        const ExpressionAttributeNames = {
          '#p': 'pb',
          '#d1': 'dist1',
          '#d2': 'dist2',
          '#d3': 'dist3',
          '#d4': 'dist4',
          '#d5': 'dist5',
        };

        const ExpressionAttributeValues = {
          ':pb': n(pbStr),
          ':d1lo': n(dist1 - 0.01),
          ':d1hi': n(dist1 + 0.01),
        };

        const filterParts = [];
        [dist2, dist3, dist4, dist5].forEach((v, idx) => {
          const i2 = idx + 2;
          if (Number.isFinite(v)) {
            ExpressionAttributeValues[`:d${i2}lo`] = n(v - 0.01);
            ExpressionAttributeValues[`:d${i2}hi`] = n(v + 0.01);
            filterParts.push(`#d${i2} BETWEEN :d${i2}lo AND :d${i2}hi`);
          }
        });

        const params = {
          TableName: 'subdomains',
          IndexName: 'pb-index',
          KeyConditionExpression: '#p = :pb AND #d1 BETWEEN :d1lo AND :d1hi',
          ExpressionAttributeNames,
          ExpressionAttributeValues,
          ...(filterParts.length ? { FilterExpression: filterParts.join(' AND ') } : {}),
          ScanIndexForward: true,
        };

        const { Items } = await dynamodbLL.query(params).promise();
        subdomainMatches = (Items || []).map(Converter.unmarshall);
      } catch (err) {
        console.error('subdomains GSI query failed:', err);
      }
    }

    // pick best match
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

    const inputParam = convertShorthandRefs(body.input);
    const expectedKeys = createArrayOfRootKeys(body.schema);
    const schemaParam = convertShorthandRefs(expectedKeys);

    if (!bestMatch) {
      // NO MATCH: either run provided actionFile, or create new entity + seed ACL + anchor
      if (actionFile) {
        const pbStr = buildPb(possessedCombined, dist1);

        const anchorWordAF = (fixedOutput && String(fixedOutput).trim())
          ? fixedOutput
          : (typeof out === "string" ? out.trim() : "");
        const anchorPayloadAF = anchorWordAF
          ? await _computeAnchorPayload({ s3, openai, text: anchorWordAF })
          : null;

        const positionBodyAF = {
          description: "provided entity (fallback)",
          domain,
          subdomain,
          embedding,
          entity: actionFile,
          pb: pbStr,
          dist1, dist2, dist3, dist4, dist5,
          path: breadcrumb,
          output: fixedOutput || out || ""
        };
        if (anchorPayloadAF) positionBodyAF.anchor = anchorPayloadAF;

        // ★ policy pointer on postings
        if (positionBodyAF.anchor) {
          await _fanoutAnchorBands({
            su: actionFile,
            setId: positionBodyAF.anchor.setId,
            anchor: positionBodyAF.anchor,
            type: 'su',
            policy_id: `${DEFAULT_POLICY_PREFIX}:${String(actionFile)}`
          });
        }

        // ★ ensure owner grant (optional; actionFile is typically caller-owned)
        await _ensureOwnerGrant({ dynamodb, su: actionFile, e });

        console.log("4-shorthand",[
          "ROUTE",
          { "body": positionBodyAF },
          {},
          "position",
          actionFile,
          ""
        ])
        shorthand.push([
          "ROUTE",
          { "body": positionBodyAF },
          {},
          "position",
          actionFile,
          ""
        ]);

        console.log("5-shorthand",[
          "ROUTE", inputParam, schemaParam, "runEntity", actionFile, ""
        ])
        shorthand.push([
          "ROUTE", inputParam, schemaParam, "runEntity", actionFile, ""
        ]);

        routeRowNewIndex = shorthand.length;
        continue;
      }

      // create a new entity/group
      const pick = (...xs) => xs.find(s => typeof s === "string" && s.trim());
      const sanitize = s => String(s || '').replace(/[\/?#]/g, ' ').trim();

      const entNameRaw = pick(body?.schema?.const, fixedOutput, body?.input?.name, body?.input?.title, body?.input?.entity, out) || "$noName";
      const entName = sanitize(entNameRaw);
      fixedOutput = entName;
      const groupName = entName;

        console.log("6-shorthand",[
        "ROUTE",
        { output: entName },
        {},
        "newGroup",
        groupName,
        entName
      ])
      shorthand.push([
        "ROUTE",
        { output: entName },
        {},
        "newGroup",
        groupName,
        entName
      ]);

      routeRowNewIndex = shorthand.length;

        console.log("7-shorthand",["GET", padRef(routeRowNewIndex), "response", "file"])
      shorthand.push(["GET", padRef(routeRowNewIndex), "response", "file"]);

      if (fixedOutput) {
        // generate JPL to wire initial actions
        console.log("8-shorthand",["ROUTE", {}, {}, "getFile", padRef(routeRowNewIndex + 1), ""])
        shorthand.push(["ROUTE", {}, {}, "getFile", padRef(routeRowNewIndex + 1), ""]);
        console.log("9-shorthand",["GET", padRef(routeRowNewIndex + 2), "response"])
        shorthand.push(["GET", padRef(routeRowNewIndex + 2), "response"]);

        const desiredObj = structuredClone(elem);
        if (fixedOutput) desiredObj.response = fixedOutput;

        let newJPL =
          `directive = [ "**this is not a simulation**: do not make up or falsify any data, and do not use example URLs! This is real data!", ` +
          `"Never response with axios URLs like example.com or domain.com because the app will crash.",` +
          `"respond with {\\"reason\\":\\"...text\\"} if it is impossible to build the app per the users request and rules", ` +
          `"you are a JSON logic app generator.", ` +
          `"You will review the 'example' json for understanding on how to program the 'logic' json object", ` +
          `"You will create a new JSON object based on the details in the desiredApp object like the breadcrumbs path, input json, and output schema.", ` +
          `"Then you build a new JSON logic that best represents (accepts the inputs as body, and products the outputs as a response.", ` +
          `"please give only the 'logic' object, meaning only respond with JSON", ` +
          `"Don't include any of the logic.modules already created.", ` +
          `"the last action item always targets '{|res|}!' to give your response back in the last item in the actions array!", ` +
          `"The user should provide an api key to anything, else attempt to build apps that don't require api key, else instead build an app to tell the user to you can't do it." ];`;
        newJPL += ` let desiredApp = ${JSON.stringify(desiredObj)}; var express = require('express'); const serverless = require('serverless-http'); const app = express(); let { requireModule, runAction } = require('./processLogic'); logic = {}; logic.modules = {"axios": "axios","math": "mathjs","path": "path"}; for (module in logic.modules) {requireModule(module);}; app.all('*', async (req, res, next) => {logic.actions.set = {"URL":URL,"req":req,"res":res,"JSON":JSON,"Buffer":Buffer,"email":{}};for (action in logic.actions) {await runAction(action, req, res, next);};});`;
        newJPL += ` var example = {"modules":{"{shuffle}":"lodash","moment-timezone":"moment-timezone"}, "actions":[{"set":{"latestEmail":"{|email=>[0]|}"}},{"set":{"latestSubject":"{|latestEmail=>subject|}"}},{"set":{"userIP":"{|req=>ip|}"}},{"set":{"userAgent":"{|req=>headers.user-agent|}"}},{"set":{"userMessage":"{|req=>body.message|}"}},{"set":{"pending":[]}},{"target":"{|axios|}","chain":[{"access":"get","params":["https://httpbin.org/ip"]}],"promise":"raw","assign":"{|pending=>[0]|}!"},{"target":"{|axios|}","chain":[{"access":"get","params":["https://httpbin.org/user-agent"]}],"promise":"raw","assign":"{|pending=>[1]|}!"},{"target":"{|Promise|}","chain":[{"access":"all","params":["{|pending|}"]}],"assign":"{|results|}"},{"set":{"httpBinIP":"{|results=>[0].data.origin|}"}},{"set":{"httpBinUA":"{|results=>[1].data['user-agent']|}"}},{"target":"{|axios|}","chain":[{"access":"get","params":["https://ipapi.co/{|userIP|}/json/"]}],"assign":"{|geoData|}"},{"set":{"city":"{|geoData=>data.city|}"}},{"set":{"timezone":"{|geoData=>data.timezone|}"}},{"target":"{|moment-timezone|}","chain":[{"access":"tz","params":["{|timezone|}"]}],"assign":"{|now|}"},{"target":"{|now|}!","chain":[{"access":"format","params":["YYYY-MM-DD"]}],"assign":"{|today|}"},{"target":"{|now|}!","chain":[{"access":"hour"}],"assign":"{|hour|}"},{"set":{"timeOfDay":"night"}},{"if":[["{|hour|}",">=","{|=3+3|}"],["{|hour|}","<",12]],"set":{"timeOfDay":"morning"}},{"if":[["{|hour|}",">=",12],["{|hour|}","<",18]],"set":{"timeOfDay":"afternoon"}},{"if":[["{|hour|}",">=","{|=36/2|}"],["{|hour|}","<",22]],"set":{"timeOfDay":"evening"}},{"set":{"extra":3}},{"set":{"maxIterations":"{|=5+{|extra|}|}"}},{"set":{"counter":0}},{"set":{"greetings":[]}},{"while":[["{|counter|}","<","{|maxIterations|}"]],"nestedActions":[{"set":{"greetings=>[{|counter|}]":"Hello number {|counter|}"}},{"set":{"counter":"{|={|counter|}+1|}"}}]},{"assign":"{|generateSummary|}","params":["prefix","remark"],"nestedActions":[{"set":{"localZone":"{|~/timezone|}"}},{"return":"{|prefix|} {|remark|} {|~/greetings=>[0]|} Visitor from {|~/city|} (IP {|~/userIP|}) said '{|~/userMessage|}'. Local timezone:{|localZone|} · Time-of-day:{|~/timeOfDay|} · Date:{|~/today|}."}]},{"target":"{|generateSummary|}!","chain":[{"assign":"","params":["Hi.","Here are the details."]}],"assign":"{|message|}"},{"target":"{|res|}!","chain":[{"access":"send","params":["{|message|}"]}]}]};`;

        const objectJPL = await buildBreadcrumbApp({ openai, str: newJPL });

        console.log("10-shorthand",["NESTED", padRef(routeRowNewIndex + 3), "published", "actions", objectJPL.actions])
        shorthand.push(["NESTED", padRef(routeRowNewIndex + 3), "published", "actions", objectJPL.actions]);
        console.log("11-shorthand",["NESTED", padRef(routeRowNewIndex + 4), "published", "modules", objectJPL.modules || {}])
        shorthand.push(["NESTED", padRef(routeRowNewIndex + 4), "published", "modules", objectJPL.modules || {}]);

        console.log("12-shorthand",["ROUTE", padRef(routeRowNewIndex + 5), {}, "saveFile", padRef(routeRowNewIndex + 1), ""])
        shorthand.push(["ROUTE", padRef(routeRowNewIndex + 5), {}, "saveFile", padRef(routeRowNewIndex + 1), ""]);
      }

      // record positioning for the new entity
      const pathStr = breadcrumb;
      const pbStr2 = buildPb(possessedCombined, dist1);

      const anchorPayloadNew = await _computeAnchorPayload({
        s3, openai, text: fixedOutput
      });

      const newSu = padRef(routeRowNewIndex + 1);
      const positionBodyCreated = {
        description: "auto created entity",
        domain, subdomain,
        embedding,
        entity: newSu,
        pb: pbStr2,
        dist1, dist2, dist3, dist4, dist5,
        path: pathStr,
        output: fixedOutput
      };
      if (anchorPayloadNew) positionBodyCreated.anchor = anchorPayloadNew;

      // ★ fanout with policy pointer
      if (positionBodyCreated.anchor) {
        await _fanoutAnchorBands({
          su: newSu,
          setId: positionBodyCreated.anchor.setId,
          anchor: positionBodyCreated.anchor,
          type: 'su',
          policy_id: `${DEFAULT_POLICY_PREFIX}:${String(newSu)}`
        });
      }

      // ★ seed owner grant for creator
      await _ensureOwnerGrant({ dynamodb, su: newSu, e });

        console.log("13-shorthand",[
        "ROUTE",
        { "body": positionBodyCreated },
        {},
        "position",
        newSu,
        ""
      ])
      shorthand.push([
        "ROUTE",
        { "body": positionBodyCreated },
        {},
        "position",
        newSu,
        ""
      ]);

      if (fixedOutput) {
        console.log("14-shorthand",["ROUTE", inputParam, {}, "runEntity", newSu, ""])
        shorthand.push(["ROUTE", inputParam, {}, "runEntity", newSu, ""]);
      } else {
        console.log("15-shorthand",[fixedOutput])
        shorthand.push([fixedOutput]);
      }

    } else {
      // MATCH: run and update position (+policy pointer & optional anchor)
        console.log("16-shorthand",["ROUTE", inputParam, schemaParam, "runEntity", bestMatch.su, ""])
      shorthand.push(["ROUTE", inputParam, schemaParam, "runEntity", bestMatch.su, ""]);

      const pbStr = buildPb(possessedCombined, dist1);

      const anchorWord = (fixedOutput && String(fixedOutput).trim())
        ? fixedOutput
        : (typeof out === "string" ? out.trim() : "");
      const anchorPayloadMatch = anchorWord
        ? await _computeAnchorPayload({ s3, openai, text: anchorWord })
        : null;

      const positionBodyMatched = {
        description: "auto matched entity",
        domain,
        subdomain,
        embedding,
        entity: bestMatch.su,
        pb: pbStr,
        dist1, dist2, dist3, dist4, dist5,
        path: breadcrumb,
        output: fixedOutput
      };

      if (anchorPayloadMatch) positionBodyMatched.anchor = anchorPayloadMatch;

      if (positionBodyMatched.anchor) {
        await _fanoutAnchorBands({
          su: bestMatch.su,
          setId: positionBodyMatched.anchor.setId,
          anchor: positionBodyMatched.anchor,
          type: 'su',
          policy_id: `${DEFAULT_POLICY_PREFIX}:${String(bestMatch.su)}`
        });
      }

      // (Optional) ensure owner grant for matched entity if you want to backfill;
      // typically ownership is seeded at creation time, so you can omit this:
      // await _ensureOwnerGrant({ dynamodb, su: bestMatch.su, e });

        console.log("17-shorthand",[
        "ROUTE",
        { "body": positionBodyMatched },
        {},
        "position",
        bestMatch.su,
        ""
      ])
      shorthand.push([
        "ROUTE",
        { "body": positionBodyMatched },
        {},
        "position",
        bestMatch.su,
        ""
      ]);
    }

    routeRowNewIndex = shorthand.length;
  }

  const lastOrig = arrayLogic[arrayLogic.length - 1] || {};
  if (lastOrig && typeof lastOrig === "object" && "conclusion" in lastOrig) {
        console.log("18-shorthand",["ADDPROPERTY", "000!!", "conclusion", padRef(routeRowNewIndex)])
    const getRowIndex = shorthand.push(
      ["ADDPROPERTY", "000!!", "conclusion", padRef(routeRowNewIndex)]
    ) - 1;

        console.log("19-shorthand",[
      "ADDPROPERTY",
      padRef(getRowIndex + 1),
      "createdEntities",
      { entity: "", name: "_new", contentType: "text", id: "_new" }
    ])
    shorthand.push([
      "ADDPROPERTY",
      padRef(getRowIndex + 1),
      "createdEntities",
      { entity: "", name: "_new", contentType: "text", id: "_new" }
    ]);

        console.log("20-shorthand",["NESTED", padRef(getRowIndex + 2), "createdEntities", "entity", "004!!"])
    shorthand.push(["NESTED", padRef(getRowIndex + 2), "createdEntities", "entity", "004!!"]);

        console.log("21-shorthand",["ROWRESULT", "000", padRef(getRowIndex + 3)])
    shorthand.push(["ROWRESULT", "000", padRef(getRowIndex + 3)]);
  }

  const finalShorthand = shorthand.map(convertShorthandRefs);

  console.log("⇢ shorthand", JSON.stringify(finalShorthand, null, 4));
  console.log("createdEntities", JSON.stringify(createdEntities, null, 4));
  return { shorthand: finalShorthand, details: results, arrayLogic, createdEntities };
}

module.exports = { parseArrayLogic };
