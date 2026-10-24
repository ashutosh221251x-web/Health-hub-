import "dotenv/config";
import crypto from "crypto";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { BookingModel, OrderModel, UserModel, connectMongo } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const productCatalog = [
  { name: "Ginger root", tags: ["digestion", "nausea", "stomach", "gut"] },
  { name: "Chamomile", tags: ["sleep", "stress", "calm", "evening"] },
  { name: "Lemon balm", tags: ["stress", "anxiety", "calm", "sleep"] },
  { name: "Blueberry", tags: ["focus", "brain", "energy", "memory"] },
  { name: "Pomegranate", tags: ["immunity", "wellness", "energy", "daily"] },
  { name: "Turmeric root", tags: ["wellness", "immunity", "inflammation", "daily"] },
  { name: "Mint blend", tags: ["digestion", "fresh", "gut", "refresh"] },
  { name: "Mango", tags: ["energy", "focus", "sunny", "vitamin"] },
  { name: "Aloe vera", tags: ["recovery", "soothing", "wellness", "skin"] },
  { name: "Dragon fruit", tags: ["hydration", "immunity", "fresh", "daily"] },
];

const paymentStore = new Map<string, { paymentId: string; status: string; amount: number; items: string[]; qrCode: string; createdAt: number }>();
const userStore = new Map<string, { id: string; name: string; email: string; passwordHash: string; createdAt: string }>();
const orderStore = new Map<string, { id: string; email: string; customer: string; address: string; items: string[]; total: number; status: string; createdAt: string }>();
const appointmentStore = new Map<string, { id: string; email: string; expert: string; mode: string; date: string; reason: string; createdAt: string }>();
const sessionStore = new Map<string, { userId: string; email: string; expiresAt: number }>();
let mongoAvailable = false;
type ProductSubmission = { id: string; name: string; category: string; submitter: string; status: "pending" | "approved" | "rejected" };
const productSubmissionStore = new Map<string, ProductSubmission>(
  productCatalog.slice(0, 5).map((item, index) => [`${index + 1}`, { id: `${index + 1}`, name: item.name, category: item.tags.includes("sleep") ? "Herb" : "Wellness", submitter: index % 2 ? "Greenleaf Collective" : "Community partner", status: index < 3 ? "approved" : "pending" }]),
);

function hashPassword(password: string) {
  return new Promise<string>((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(`scrypt:${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password: string, storedHash: string) {
  if (!storedHash.startsWith("scrypt:")) {
    return Promise.resolve(crypto.createHash("sha256").update(password).digest("hex") === storedHash);
  }

  const [, salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return Promise.resolve(false);

  return new Promise<boolean>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      const expected = Buffer.from(expectedHex, "hex");
      resolve(expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey));
    });
  });
}

function setSessionCookie(res: express.Response, user: { id: string; email: string }) {
  const token = crypto.randomBytes(32).toString("hex");
  sessionStore.set(token, { userId: user.id, email: user.email, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  res.setHeader("Set-Cookie", `herbal_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function sanitizeUser(user: { id: string; name: string; email: string }) {
  return { id: user.id, name: user.name, email: user.email };
}

async function findUserByEmail(email: string) {
  if (mongoAvailable) {
    const record = await UserModel.findOne({ email }).lean();
    if (record) {
      return { id: String(record._id), name: record.name, email: record.email, passwordHash: record.passwordHash, createdAt: String(record.createdAt) };
    }
  }

  return Array.from(userStore.values()).find((user) => user.email === email) ?? null;
}

async function createUserRecord(name: string, email: string, passwordHash: string) {
  if (mongoAvailable) {
    const record = await UserModel.create({ name, email, passwordHash });
    return { id: String(record._id), name: record.name, email: record.email, passwordHash: record.passwordHash, createdAt: String(record.createdAt) };
  }

  const id = `user_${Date.now()}`;
  const user = { id, name, email, passwordHash, createdAt: new Date().toISOString() };
  userStore.set(id, user);
  return user;
}

async function createOrderRecord(email: string, items: string[], total: number, customer = "", address = "") {
  if (mongoAvailable) {
    const record = await OrderModel.create({ email, customer, address, items, total, status: "paid" });
    return { id: String(record._id), email: record.email, customer: record.customer, address: record.address, items: record.items, total: Number(record.total), status: record.status, createdAt: String(record.createdAt) };
  }

  const id = `order_${Date.now()}`;
  const order = { id, email, customer, address, items, total, status: "paid", createdAt: new Date().toISOString() };
  orderStore.set(id, order);
  return order;
}

async function createBookingRecord(email: string, expert: string, mode: string, date: string, reason: string) {
  if (mongoAvailable) {
    const record = await BookingModel.create({ email, expert, mode, date, reason });
    return { id: String(record._id), email: record.email, expert: record.expert, mode: record.mode, date: record.date, reason: record.reason, createdAt: String(record.createdAt) };
  }

  const id = `booking_${Date.now()}`;
  const booking = { id, email, expert, mode, date, reason, createdAt: new Date().toISOString() };
  appointmentStore.set(id, booking);
  return booking;
}

function createHealthResult(question: string) {
  const q = (question || "").toLowerCase();
  const recommendedProducts = productCatalog
    .filter((product) => product.tags.some((tag) => q.includes(tag)))
    .slice(0, 3);

  const match = (keywords: string[]) => keywords.some((keyword) => q.includes(keyword));

  if (match(["sleep", "insomnia", "tired", "fatigue", "restless"])) {
    return {
      category: "sleep",
      answer: "A consistent sleep rhythm, lower evening light exposure, and a calming herbal routine can support deeper rest. Focus on a wind-down ritual 30 to 60 minutes before bed, avoid heavy late meals, and keep your room dark and cool.",
      medicinalSuggestions: ["Chamomile tea 30 minutes before bed", "Warm lemon balm infusion", "Reduce screen time and heavy meals in the evening"],
      fitnessAdvice: ["Try a brief 10-minute walk in daylight to reinforce your body clock", "Include gentle stretching after dinner to relax your nervous system"],
      actionPlan: ["Set a fixed wake time", "Limit caffeine after midday", "Use a simple calming ritual for 2 weeks to track consistency"],
      recommendedProducts: recommendedProducts.length ? recommendedProducts.map((item) => ({ name: item.name })) : [{ name: "Chamomile" }, { name: "Lemon balm" }],
      safetyNote: "Sleep disruption that persists for several weeks or with breathlessness should be reviewed by a clinician.",
    };
  }

  if (match(["digest", "bloating", "gut", "stomach", "indigestion", "constipation"])) {
    return {
      category: "digestion",
      answer: "Gentle digestion usually improves with regular meals, hydration, and lower-fat meals in the evening. Ginger, mint, and cinnamon are often used in soothing routines that help support comfort after meals.",
      medicinalSuggestions: ["Ginger tea after meals", "Steady hydration and slower eating", "Choose lighter meals and easy-to-digest foods"],
      fitnessAdvice: ["Do a 10-minute walk after meals to support bowel regularity", "Avoid intense exercise immediately after heavy meals"],
      actionPlan: ["Keep a simple food and symptom log for 7 days", "Avoid large late-night meals", "Add warm liquids and digestive herbs in your daily routine"],
      recommendedProducts: recommendedProducts.length ? recommendedProducts.map((item) => ({ name: item.name })) : [{ name: "Ginger root" }, { name: "Mint blend" }],
      safetyNote: "Persistent abdominal pain, vomiting, blood in stool, or weight loss deserves immediate medical care.",
    };
  }

  if (match(["stress", "anxiety", "overwhelm", "burnout", "nervous"])) {
    return {
      category: "stress",
      answer: "Stress responds well to rhythm and recovery: consistent sleep, time outside, regular meals, and short breath-based resets. Lemon balm, ashwagandha, and calm routines can support a more steady mood and focus.",
      medicinalSuggestions: ["Lemon balm tea", "5-minute breathing break", "Short outdoor walk or sunlight session"],
      fitnessAdvice: ["Add 10 minutes of light movement or walking to reduce mental tension", "Practice a 4-6 breathing cycle to settle your nervous system"],
      actionPlan: ["Schedule one short reset break per day", "Protect a screen-free period before sleep", "Use a simple stress-cue list to spot patterns"],
      recommendedProducts: recommendedProducts.length ? recommendedProducts.map((item) => ({ name: item.name })) : [{ name: "Lemon balm" }, { name: "Ashwagandha" }],
      safetyNote: "Severe panic, hopelessness, or emotional crisis requires professional care without delay.",
    };
  }

  if (match(["focus", "brain", "memory", "concentration", "mental clarity"])) {
    return {
      category: "focus",
      answer: "Clearer thinking often comes from regular meals, hydration, enough sleep, and mindful breaks. Blueberries, pomegranate, and spinach-based nutrition can support cognitive resilience alongside stronger daily routines.",
      medicinalSuggestions: ["Blueberry or pomegranate snack", "Hydration reminder after a long work block", "Short movement breaks to reset attention"],
      fitnessAdvice: ["Use a 5-minute mobility break every 90 minutes", "Take a brisk walk to refresh attention instead of pushing through fatigue"],
      actionPlan: ["Keep hydration consistent throughout the day", "Pair deep work with short breaks and protein-rich snacks", "Track focus patterns when sleep or meals are inconsistent"],
      recommendedProducts: recommendedProducts.length ? recommendedProducts.map((item) => ({ name: item.name })) : [{ name: "Blueberry" }, { name: "Spinach blend" }],
      safetyNote: "Sudden, major changes in memory or concentration should be checked by a clinician.",
    };
  }

  if (match(["fitness", "workout", "exercise", "muscle", "recovery", "strength", "weight loss", "fat loss", "gym"])) {
    return {
      category: "fitness",
      answer: "A practical fitness plan balances mobility, strength, and recovery. Aim for steady movement most days, support recovery with hydration, and keep your nutrition adequate so your training does not pile on stress.",
      medicinalSuggestions: ["Hydration before and after workouts", "Protein-rich meals after strength sessions", "Turmeric or ginger support for recovery and mobility"],
      fitnessAdvice: ["Do 2 to 3 strength sessions per week with 1 recovery day between them", "Add 20 to 30 minutes of brisk walking on most days", "Prioritize sleep and protein to improve performance"],
      actionPlan: ["Start with a 3-day weekly rhythm and build gradually", "Track recovery, energy, and soreness each week", "Use rest days as part of performance, not as failure"],
      recommendedProducts: recommendedProducts.length ? recommendedProducts.map((item) => ({ name: item.name })) : [{ name: "Turmeric root" }, { name: "Mango" }],
      safetyNote: "If you have chest pain, dizziness, or exercise intolerance, seek medical evaluation before pushing harder.",
    };
  }

  if (match(["immune", "cold", "wellness", "immunity", "infection", "defense"])) {
    return {
      category: "immunity",
      answer: "Immune support is usually about consistency: good sleep, balanced nutrition, hydration, stress regulation, and steady movement. Daily routines built around whole foods and herbs can be easier to maintain than short bursts of effort.",
      medicinalSuggestions: ["A turmeric and ginger tonic", "Pomegranate-rich meals for antioxidant support", "Simple daily hydration and rest routines"],
      fitnessAdvice: ["Keep movement light to moderate to reduce stress on recovery", "Add outdoor daylight exposure to improve mood and rhythm"],
      actionPlan: ["Build a repeatable morning routine", "Focus on fiber and fruit intake", "Avoid overtraining when you feel run down"],
      recommendedProducts: recommendedProducts.length ? recommendedProducts.map((item) => ({ name: item.name })) : [{ name: "Pomegranate" }, { name: "Turmeric root" }],
      safetyNote: "Recurring illness, fever, or worsening symptoms should be checked by a doctor.",
    };
  }

  if (match(["hydration", "water", "dehydration", "energy", "low energy"])) {
    return {
      category: "hydration",
      answer: "Low energy and brain fog are often improved by steady hydration, balanced meals, and a realistic pace for the day. Fruit, herbal tea, and consistent intake across the day are easier to sustain than one large burst.",
      medicinalSuggestions: ["Water with lemon or mint", "A fruit-rich snack like blueberry or mango", "Small hydration checks every few hours"],
      fitnessAdvice: ["Light movement can improve circulation and energy before heavy work starts", "A 5 to 10 minute walk can reset concentration better than another quick caffeine hit"],
      actionPlan: ["Carry water in a visible bottle", "Pair meals with fluids and fruit", "Reduce long gaps between eating and drinking"],
      recommendedProducts: recommendedProducts.length ? recommendedProducts.map((item) => ({ name: item.name })) : [{ name: "Dragon fruit" }, { name: "Mint blend" }],
      safetyNote: "Severe dehydration, fainting, or confusion needs urgent medical review.",
    };
  }

  return {
    category: "general",
    answer: "A steady wellness routine usually combines good sleep, regular eating, hydration, movement, and quality stress management. The best progress usually comes from small habits repeated consistently rather than dramatic resets.",
    medicinalSuggestions: ["Hydrate consistently", "Keep the routine simple and anchored to meals", "Monitor symptoms over a few days and look for patterns"],
    fitnessAdvice: ["Take a brisk walk for 10 to 20 minutes most days", "Add light mobility or stretching at least once daily"],
    actionPlan: ["Choose one habit to improve this week", "Track energy, sleep, and meals for 7 days", "Seek qualified care if symptoms worsen or persist"],
    recommendedProducts: recommendedProducts.length ? recommendedProducts.map((item) => ({ name: item.name })) : [{ name: "Pomegranate" }, { name: "Turmeric root" }],
    safetyNote: "This is educational support and not a diagnosis or treatment plan.",
  };
}

function normalizeOpenAIResponse(rawContent: string, fallbackCategory: string) {
  if (!rawContent) {
    return null;
  }

  try {
    const maybeJson = rawContent.trim();
    const parsed = JSON.parse(maybeJson.replace(/^```json\s*|```\s*$/g, ""));

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    if (!answer) {
      return null;
    }

    const parseStringArray = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string").slice(0, 4)
        : [];

    const parseProducts = (value: unknown) => {
      if (!Array.isArray(value)) {
        return [];
      }

      return value
        .map((item) => {
          if (typeof item === "string") return { name: item };
          if (item && typeof item === "object" && typeof (item as { name?: string }).name === "string") {
            return { name: (item as { name: string }).name };
          }
          return null;
        })
        .filter((item): item is { name: string } => Boolean(item))
        .slice(0, 3);
    };

    return {
      category: typeof parsed.category === "string" ? parsed.category : fallbackCategory,
      answer,
      medicinalSuggestions: parseStringArray(parsed.medicinalSuggestions),
      fitnessAdvice: parseStringArray(parsed.fitnessAdvice),
      actionPlan: parseStringArray(parsed.actionPlan),
      recommendedProducts: parseProducts(parsed.recommendedProducts),
      safetyNote: typeof parsed.safetyNote === "string" ? parsed.safetyNote : "This is educational guidance and not a diagnosis.",
    };
  } catch {
    return null;
  }
}

async function callOpenAIHealthCoach(question: string, mode: "assistant" | "fitness") {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              mode === "assistant"
                ? "You are a trusted wellness and herbal health coach. Provide practical, non-diagnostic advice with a warm tone. Return valid JSON only with keys: category, answer, medicinalSuggestions, fitnessAdvice, actionPlan, recommendedProducts, safetyNote. Use short arrays of practical strings."
                : "You are a fitness and recovery coach specialized in wellness routines. Provide practical, non-diagnostic fitness recommendations. Return valid JSON only with keys: category, answer, medicinalSuggestions, fitnessAdvice, actionPlan, recommendedProducts, safetyNote. Use short arrays of practical strings.",
          },
          {
            role: "user",
            content: question || (mode === "assistant" ? "I want general wellness guidance." : "I want support for fitness and recovery."),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API responded with ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return null;
    }

    const normalized = normalizeOpenAIResponse(content, mode === "assistant" ? "general" : "fitness");
    if (normalized) {
      return normalized;
    }
  } catch (error) {
    console.warn("OpenAI health coach unavailable, falling back to local guidance.", error);
  }

  return null;
}

async function callGeminiHealthCoach(question: string, mode: "assistant" | "fitness") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const systemInstruction =
    mode === "assistant"
      ? "You are a trusted wellness and herbal health coach. Provide practical, non-diagnostic advice with a warm tone."
      : "You are a fitness and recovery coach specialized in wellness routines. Provide practical, non-diagnostic fitness recommendations.";

  try {
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{
          role: "user",
          parts: [{
            text: `${question || (mode === "assistant" ? "I want general wellness guidance." : "I want support for fitness and recovery.")}\n\nReturn valid JSON only with keys: category, answer, medicinalSuggestions, fitnessAdvice, actionPlan, recommendedProducts, safetyNote. Use short arrays of practical strings.`,
          }],
        }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API responded with ${response.status}`);
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("");
    if (typeof content !== "string") {
      return null;
    }

    return normalizeOpenAIResponse(content, mode === "assistant" ? "general" : "fitness");
  } catch (error) {
    console.warn("Gemini health coach unavailable, trying the next AI fallback.", error);
    return null;
  }
}

async function getAssistantResult(question: string) {
  const geminiResult = await callGeminiHealthCoach(question, "assistant");
  if (geminiResult) {
    return geminiResult;
  }

  const openAiResult = await callOpenAIHealthCoach(question, "assistant");
  if (openAiResult) {
    return openAiResult;
  }

  const serviceUrl = process.env.AI_SERVICE_URL?.replace(/\/$/, "");

  if (!serviceUrl) {
    return createHealthResult(question);
  }

  try {
    const response = await fetch(`${serviceUrl}/api/health/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      throw new Error(`Python AI service responded with ${response.status}`);
    }

    const data = await response.json();
    if (data && typeof data.answer === "string") {
      return data;
    }
  } catch (error) {
    console.warn("Falling back to local AI assistant logic:", error);
  }

  return createHealthResult(question);
}

async function getFitnessResult(question: string) {
  const geminiResult = await callGeminiHealthCoach(question || "fitness and recovery coaching", "fitness");
  if (geminiResult) {
    return geminiResult;
  }

  const openAiResult = await callOpenAIHealthCoach(question || "fitness and recovery coaching", "fitness");
  if (openAiResult) {
    return openAiResult;
  }

  const serviceUrl = process.env.AI_SERVICE_URL?.replace(/\/$/, "");

  if (!serviceUrl) {
    return createHealthResult(question || "fitness and recovery coaching");
  }

  try {
    const response = await fetch(`${serviceUrl}/api/health/fitness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question || "fitness and recovery coaching" }),
    });

    if (!response.ok) {
      throw new Error(`Python fitness service responded with ${response.status}`);
    }

    const data = await response.json();
    if (data && typeof data.answer === "string") {
      return data;
    }
  } catch (error) {
    console.warn("Falling back to local fitness guidance:", error);
  }

  return createHealthResult(question || "fitness and recovery coaching");
}

function createQrPayment(amount: number, items: string[]) {
  const safeAmount = Number.isFinite(amount) ? Math.max(amount, 0) : 0;
  const paymentId = `pay_${Date.now()}`;
  const qrPayload = `herbal-health-hub://checkout/${paymentId}?amount=${safeAmount.toFixed(2)}&items=${encodeURIComponent(items.join(","))}`;
  const qrCode = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrPayload)}`;
  const record = {
    paymentId,
    status: "pending",
    amount: safeAmount,
    items,
    qrCode,
    createdAt: Date.now(),
  };
  paymentStore.set(paymentId, record);
  return record;
}

async function createStripePaymentIntent(amount: number, items: string[]) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return null;
  }

  try {
    const response = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: String(Math.max(Math.round(amount * 100), 0)),
        currency: process.env.STRIPE_CURRENCY || "inr",
        description: items.join(", ") || "Herbal Health purchase",
      }),
    });

    if (!response.ok) {
      throw new Error(`Stripe API responded with ${response.status}`);
    }

    const data = await response.json();
    return {
      paymentId: data.id,
      status: String(data.status || "requires_payment_method"),
      amount: Number.isFinite(amount) ? Math.max(amount, 0) : 0,
      items,
      qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`stripe:${data.id}`)}`,
    };
  } catch (error) {
    console.warn("Stripe payment service unavailable; falling back to QR demo flow.", error);
    return null;
  }
}

async function createTelehealthRoom(expert: string, mode: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return null;
  }

  try {
    const response = await fetch(`https://video.twilio.com/2010-04-01/Accounts/${accountSid}/Rooms.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        UniqueName: `herbal-${Date.now()}`,
        Type: "group",
        StatusCallback: "",
        VideoCodecs: "VP8",
      }),
    });

    if (!response.ok) {
      throw new Error(`Twilio room request failed with ${response.status}`);
    }

    const data = await response.json();
    return {
      roomId: data.unique_name || `room-${Date.now()}`,
      status: data.status || "ready",
      joinUrl: `https://meet.google.com/new?authuser=0&hl=en`,
      scheduledFor: new Date(Date.now() + 1800000).toISOString(),
    };
  } catch (error) {
    console.warn("Twilio room unavailable; using demo room fallback.", error);
    return null;
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  let mongoConnection: Awaited<ReturnType<typeof connectMongo>> = null;

app.use(express.json({ limit: "1mb" }));

app.get("/api/config", (_req, res) => {
  res.json({
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
    providers: {
    ai: Boolean(process.env.AI_SERVICE_URL || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    maps: Boolean(process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY),
    twilio: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    mongo: mongoAvailable,
  },
});
});

app.get("/api/nearby-places", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: "Valid latitude and longitude are required." });
    return;
  }

  const query = `
    [out:json][timeout:30];
    (
      nwr(around:12000,${lat},${lng})["amenity"="hospital"]["name"];
      nwr(around:12000,${lat},${lng})["healthcare"~"hospital|clinic|doctor"]["name"];
      nwr(around:12000,${lat},${lng})["amenity"="pharmacy"]["name"];
      nwr(around:12000,${lat},${lng})["shop"~"chemist|greengrocer|farm|marketplace|supermarket|convenience|general"]["name"];
      nwr(around:12000,${lat},${lng})["shop"]["name"];
    );
    out center tags;
  `;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Accept: "application/json" },
        body: query,
        signal: AbortSignal.timeout(25000),
      });
      if (response.ok) {
        const data = await response.json();
        res.status(200).json({ ...data, source: "OpenStreetMap Overpass" });
        return;
      }
    } catch {
      // Try the next public Overpass mirror.
    }
  }

  try {
    const viewbox = `${lng - 0.12},${lat + 0.12},${lng + 0.12},${lat - 0.12}`;
    const searchUrl = new URL("https://nominatim.openstreetmap.org/search");
    searchUrl.search = new URLSearchParams({
      format: "jsonv2",
      limit: "50",
      dedupe: "1",
      bounded: "1",
      viewbox,
      q: "shop Moradabad Uttar Pradesh India",
    }).toString();
    const response = await fetch(searchUrl, {
      headers: { Accept: "application/json", "User-Agent": "HerbalHealthHub/1.0 locality search" },
      signal: AbortSignal.timeout(12000),
    });
    if (response.ok) {
      const results = (await response.json()) as Array<{
        place_id: number;
        lat: string;
        lon: string;
        name?: string;
        display_name?: string;
        type?: string;
      }>;
      res.status(200).json({
        elements: results.flatMap((place) => {
          const placeLat = Number(place.lat);
          const placeLng = Number(place.lon);
          if (!Number.isFinite(placeLat) || !Number.isFinite(placeLng)) return [];
          return [{
            id: place.place_id,
            lat: placeLat,
            lon: placeLng,
            tags: {
              name: place.name || place.display_name?.split(",")[0] || "Local shop",
              shop: place.type || "shop",
            },
          }];
        }),
        source: "OpenStreetMap Nominatim",
      });
      return;
    }
  } catch {
    // Return the deterministic project pins when public map services are unavailable.
  }

  res.status(200).json({ elements: [], degraded: true });
});

app.get("/api/catalog", (_req, res) => {
    res.json({
      products: productCatalog.map((item, index) => ({
        id: index + 1,
        name: item.name,
        category: item.tags.includes("sleep") || item.tags.includes("stress") || item.tags.includes("calm") ? "Herb" : item.tags.includes("focus") || item.tags.includes("energy") ? "Fruit" : "Wellness",
        benefit: item.tags[0],
        note: `Supportive wellness product focused on ${item.tags.slice(0, 2).join(" and ")}.`,
      })),
    });
});

app.get("/api/admin/products", (_req, res) => {
    res.json({ products: Array.from(productSubmissionStore.values()) });
});

app.patch("/api/admin/products/:id/status", (req, res) => {
      const status = req.body?.status;
      if (!["pending", "approved", "rejected"].includes(status)) {
        res.status(400).json({ message: "A valid product status is required." });
        return;
      }
      const product = productSubmissionStore.get(req.params.id);
      if (!product) {
        res.status(404).json({ message: "Product submission not found." });
        return;
      }
      product.status = status as ProductSubmission["status"];
      res.json({ product });
  });

  app.post("/api/admin/products", (req, res) => {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const category = typeof req.body?.category === "string" ? req.body.category.trim() : "Wellness";
      const submitter = typeof req.body?.submitter === "string" ? req.body.submitter.trim() : "Community partner";
      if (!name) {
        res.status(400).json({ message: "Product name is required." });
        return;
      }
      const id = `submission_${Date.now()}`;
      const product: ProductSubmission = { id, name, category, submitter, status: "pending" };
      productSubmissionStore.set(id, product);
      res.status(201).json({ product });
  });

  app.post("/api/auth/signup", async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!name || !email || !password) {
      res.status(400).json({ message: "Name, email, and password are required." });
      return;
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      res.status(409).json({ message: "An account with this email already exists." });
      return;
    }

    const user = await createUserRecord(name, email, await hashPassword(password));
    setSessionCookie(res, user);
    res.status(201).json({ user: sanitizeUser(user), message: "Account created successfully." });
  });

  app.post("/api/auth/login", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password) {
      res.status(400).json({ message: "Email and password are required." });
      return;
    }

    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ message: "Invalid email or password." });
      return;
    }

    setSessionCookie(res, user);
    res.json({ user: sanitizeUser(user), message: "Login successful." });
  });

  app.post("/api/auth/logout", (req, res) => {
    const cookie = req.headers.cookie?.split(";").find((value) => value.trim().startsWith("herbal_session="));
    const token = cookie?.trim().slice("herbal_session=".length);
    if (token) sessionStore.delete(token);
    res.setHeader("Set-Cookie", "herbal_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.json({ message: "Logged out successfully." });
  });

  app.get("/api/auth/me", async (req, res) => {
    const cookie = req.headers.cookie?.split(";").find((value) => value.trim().startsWith("herbal_session="));
    const token = cookie?.trim().slice("herbal_session=".length);
    const session = token ? sessionStore.get(token) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
      if (token) sessionStore.delete(token);
      res.status(401).json({ message: "Not authenticated." });
      return;
    }
    const user = await findUserByEmail(session.email);
    if (!user) {
      if (token) sessionStore.delete(token);
      res.status(401).json({ message: "Not authenticated." });
      return;
    }
    res.json({ user: sanitizeUser(user) });
  });

  app.get("/api/health/assistant", async (req, res) => {
    const question = typeof req.query.question === "string" ? req.query.question : "";
    const result = await getAssistantResult(question);
    res.json({ ...result, recommendedProducts: (result.recommendedProducts ?? []).slice(0, 3) });
  });

  app.post("/api/health/assistant", async (req, res) => {
    const question = typeof req.body?.question === "string" ? req.body.question : "";
    const result = await getAssistantResult(question);
    res.json({ ...result, recommendedProducts: (result.recommendedProducts ?? []).slice(0, 3) });
  });

  app.post("/api/health/fitness", async (req, res) => {
    const question = typeof req.body?.question === "string" ? req.body.question : "fitness and recovery coaching";
    const result = await getFitnessResult(question);
    res.json({ ...result, recommendedProducts: (result.recommendedProducts ?? []).slice(0, 3) });
  });

  app.post("/api/orders", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const items = Array.isArray(req.body?.items)
      ? req.body.items.filter((item: unknown) => typeof item === "string")
      : [];
    const total = Number(req.body?.total ?? 0);
    const customer = typeof req.body?.customer === "string" ? req.body.customer.trim() : "";
    const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";

    if (!email || items.length === 0) {
      res.status(400).json({ message: "Email and items are required to create an order." });
      return;
    }

    const order = await createOrderRecord(email, items, Number.isFinite(total) ? total : 0, customer, address);
    res.status(201).json({ order, message: "Order created successfully." });
  });

  app.get("/api/orders", async (req, res) => {
    const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
    if (mongoAvailable) {
      const orders = (await OrderModel.find(email ? { email } : {}).sort({ createdAt: -1 }).lean()).map((order) => ({
        id: String(order._id),
        email: order.email,
        customer: order.customer || "",
        address: order.address || "",
        items: order.items,
        total: Number(order.total),
        status: order.status,
        createdAt: String(order.createdAt),
      }));
      res.json({ orders });
      return;
    }
    const orders = email
      ? Array.from(orderStore.values()).filter((order) => order.email === email)
      : Array.from(orderStore.values());
    res.json({ orders });
  });

  app.get("/api/admin/orders", async (_req, res) => {
    if (mongoAvailable) {
      const orders = (await OrderModel.find().sort({ createdAt: -1 }).lean()).map((order) => ({
        id: String(order._id), email: order.email, customer: order.customer || "", address: order.address || "",
        items: order.items, total: Number(order.total), status: order.status, createdAt: String(order.createdAt),
      }));
      res.json({ orders });
      return;
    }
    res.json({ orders: Array.from(orderStore.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  });

  app.patch("/api/admin/orders/:id/status", async (req, res) => {
    const allowedStatuses = ["paid", "confirmed", "packed", "shipped", "delivered", "cancelled"];
    const status = typeof req.body?.status === "string" ? req.body.status : "";
    if (!allowedStatuses.includes(status)) {
      res.status(400).json({ message: "Unsupported order status." });
      return;
    }
    if (mongoAvailable) {
      const order = await OrderModel.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean();
      if (!order) {
        res.status(404).json({ message: "Order not found." });
        return;
      }
      res.json({ order: { ...order, id: String(order._id) } });
      return;
    }
    const order = orderStore.get(req.params.id);
    if (!order) {
      res.status(404).json({ message: "Order not found." });
      return;
    }
    order.status = status;
    orderStore.set(order.id, order);
    res.json({ order });
  });

  app.post("/api/appointments", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const expert = typeof req.body?.expert === "string" ? req.body.expert.trim() : "";
    const mode = typeof req.body?.mode === "string" ? req.body.mode : "chat";
    const date = typeof req.body?.date === "string" ? req.body.date : new Date().toISOString();
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "General wellness support";

    if (!email || !expert) {
      res.status(400).json({ message: "Email and expert name are required." });
      return;
    }

    const booking = await createBookingRecord(email, expert, mode, date, reason);
    res.status(201).json({ booking, message: "Appointment booked successfully." });
  });

  app.get("/api/appointments", async (req, res) => {
    const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
    if (mongoAvailable) {
      const bookings = (await BookingModel.find(email ? { email } : {}).sort({ createdAt: -1 }).lean()).map((booking) => ({
        id: String(booking._id),
        email: booking.email,
        expert: booking.expert,
        mode: booking.mode,
        date: booking.date,
        reason: booking.reason,
        createdAt: String(booking.createdAt),
      }));
      res.json({ bookings });
      return;
    }
    const bookings = email
      ? Array.from(appointmentStore.values()).filter((booking) => booking.email === email)
      : Array.from(appointmentStore.values());
    res.json({ bookings });
  });

  app.post("/api/payment/qr", async (req, res) => {
    const amount = Number(req.body?.amount ?? 0);
    const items = Array.isArray(req.body?.items)
      ? req.body.items.filter((value: unknown) => typeof value === "string")
      : [];

    if (!Number.isFinite(amount) || amount <= 0 || items.length === 0) {
      res.status(400).json({ message: "A positive amount and at least one item are required." });
      return;
    }

    const stripePayment = await createStripePaymentIntent(amount, items);
    if (stripePayment) {
      paymentStore.set(stripePayment.paymentId, {
        ...stripePayment,
        createdAt: Date.now(),
      });
      res.json({
        paymentId: stripePayment.paymentId,
        status: stripePayment.status,
        amount: stripePayment.amount,
        items: stripePayment.items,
        qrCode: stripePayment.qrCode,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
      return;
    }

    const payment = createQrPayment(amount, items);
    res.json({
      paymentId: payment.paymentId,
      status: payment.status,
      amount: payment.amount,
      items: payment.items,
      qrCode: payment.qrCode,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });
  });

  app.post("/api/payment/confirm", (req, res) => {
    const paymentId = typeof req.body?.paymentId === "string" ? req.body.paymentId : "";
    const payment = paymentId ? paymentStore.get(paymentId) : undefined;

    if (!payment) {
      res.status(404).json({ status: "not_found", message: "Payment record not found." });
      return;
    }

    payment.status = "paid";
    paymentStore.set(paymentId, payment);
    res.json({ status: "paid", paymentId, amount: payment.amount, message: "Payment confirmed successfully." });
  });

  app.post("/api/video-session", async (req, res) => {
    const expert = typeof req.body?.expert === "string" ? req.body.expert : "wellness specialist";
    const mode = typeof req.body?.mode === "string" ? req.body.mode : "video";

    const telehealthRoom = await createTelehealthRoom(expert, mode);
    if (telehealthRoom) {
      res.json(telehealthRoom);
      return;
    }

    const roomId = `consult-${Date.now()}`;
    const meetUrl = "https://meet.google.com/new";
    res.json({
      roomId,
      status: "ready",
      joinUrl: meetUrl,
      scheduledFor: new Date(Date.now() + 1800000).toISOString(),
    });
  });

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = Number(process.env.PORT || 3001);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  mongoConnection = await connectMongo();
  mongoAvailable = Boolean(mongoConnection);
}

startServer().catch(console.error);
