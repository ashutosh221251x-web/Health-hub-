import mongoose from "mongoose";

const mongoUri = process.env.MONGODB_URI;

export async function connectMongo() {
  if (!mongoUri) {
    return null;
  }

  try {
    await mongoose.connect(mongoUri, {
      dbName: process.env.MONGODB_DB || undefined,
    });
    console.log("MongoDB connected successfully.");
    return mongoose;
  } catch (error) {
    console.warn("MongoDB connection unavailable; using demo store mode.", error);
    return null;
  }
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "users" },
);

const orderSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    customer: { type: String, default: "" },
    address: { type: String, default: "" },
    items: [{ type: String }],
    total: { type: Number, default: 0 },
    status: { type: String, default: "paid" },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "orders" },
);

const bookingSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    expert: { type: String, required: true },
    mode: { type: String, default: "chat" },
    date: { type: String, default: "" },
    reason: { type: String, default: "General wellness support" },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "appointments" },
);

export const UserModel = mongoose.models.User || mongoose.model("User", userSchema);
export const OrderModel = mongoose.models.Order || mongoose.model("Order", orderSchema);
export const BookingModel = mongoose.models.Booking || mongoose.model("Booking", bookingSchema);
