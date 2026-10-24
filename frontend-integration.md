# Herbal Health Hub Frontend Integration Notes

## Requirements synthesis

The supplied P075 brief establishes the core journey: a user enters a health concern, explores fruit and herb information, adds products to a cart, places an order, and searches for hospitals by concern. The Online Health Portal Proposal adds a curated catalog, order history, admin-managed content, purchase-pattern recommendations, and a persistent health-content disclaimer. The MERN + AI/ML blueprint adds a decoupled React / Node / FastAPI topology, medical-profile fields, allergy-aware filtering, TF-IDF content matching, and SVD or ALS collaborative recommendations.

## Frontend-only delivery boundary

This project is currently a static React frontend. The present extension represents the future APIs with clear demo states rather than inventing clinical, payment, realtime, or location data. Chat and video-call controls are consultation entry points that should later connect to authenticated doctor availability, a realtime messaging layer, and a compliant telehealth provider. The nearby-care map uses the scaffold's built-in `MapView`, which already loads the Manus Maps proxy; the UI also provides a deterministic fallback list so the experience remains useful when map services are unavailable.

| Domain | Frontend model | Future service boundary |
| --- | --- | --- |
| Health discovery | `healthConcern`, `symptoms[]`, `recommendations[]` | Catalog and recommendation API |
| Safety | `allergies[]`, `contraindications[]`, `safetyNote` | Deterministic server-side safety gate before recommendation results |
| Expert consultation | `Expert`, `availability`, `consultationMode`, `conversationId` | Authenticated doctor directory, realtime chat, WebRTC/telehealth provider |
| Nearby care | `CarePlace`, `kind`, `specialty`, `distance`, `position` | Google Places/Geocoding plus hospital directory API |
| Commerce | `CartItem`, `price`, `quantity`, `orderStatus` | Secure cart, payment gateway, order and inventory services |
| Recommendations | `reason`, `score`, `relatedProducts[]` | TF-IDF/cosine service plus SVD/ALS aggregate behavior service |

## Content and safety language

The interface uses “support,” “traditional relevance,” and “wellness” language instead of claiming that a product cures a disease. Every consultation and discovery surface includes a clear reminder that the product is informational and does not replace a licensed clinician. The next implementation phase can safely add API adapters once the team chooses the authentication, database, payment, telehealth, and hospital-directory providers.
