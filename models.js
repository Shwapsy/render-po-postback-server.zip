import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  trader_id: { type: String, required: true, unique: true, index: true },
  registeredByLink: { type: Boolean, default: false },
  emailConfirmed: { type: Boolean, default: false },
  hasDeposit: { type: Boolean, default: false },
  ftdAt: { type: Date },
  totalDeposits: { type: Number, default: 0 },
  lastDepositAmount: { type: Number, default: 0 },
  lastEvent: { type: String },
  lastPostbackAt: { type: Date },
  lastRaw: { type: Object }
}, { timestamps: true });

export const User = mongoose.models.User || mongoose.model('User', UserSchema);
