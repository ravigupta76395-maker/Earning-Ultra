const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const TOKEN = '8863923029:AAGGMNF5CCfjbHcoapJU4Cadsm1zqjJlk1U';
const MONGODB_URI = 'mongodb+srv://rg15756448_db_user:UD56WE02WvpJ5215@cluster0.nss1pnd.mongodb.net/referapp?retryWrites=true&w=majority&appName=Cluster0';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-vercel-app.vercel.app';

mongoose.connect(MONGODB_URI).then(() => console.log('MongoDB connected')).catch(console.error);

// Schemas
const UserSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  balance: { type: Number, default: 0 },
  deviceId: { type: String, unique: true, sparse: true },
  verified: { type: Boolean, default: false },
  referredBy: String,
  referralCode: String,
  referralCount: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  lastWithdrawal: Date,
  createdAt: { type: Date, default: Date.now }
});

const SettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const WithdrawalSchema = new mongoose.Schema({
  telegramId: String,
  username: String,
  amount: Number,
  tax: Number,
  finalAmount: Number,
  number: String,
  status: { type: String, default: 'pending' },
  apiResponse: String,
  createdAt: { type: Date, default: Date.now }
});

const TransactionSchema = new mongoose.Schema({
  telegramId: String,
  type: String,
  amount: Number,
  description: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Settings = mongoose.model('Settings', SettingsSchema);
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

// Default settings
async function initSettings() {
  const defaults = [
    { key: 'referAmount', value: 10 },
    { key: 'inviteBonus', value: 5 },
    { key: 'minWithdrawal', value: 50 },
    { key: 'maxWithdrawal', value: 10000 },
    { key: 'withdrawalApi', value: 'https://ultra-pay.store/APIs/api?token=pBD22DfWxXCsYxxG34rampbRWtEDyrvK&key=mxYoHxxA07021pK&paytoNumber={number}&amount={amount}&comment=Pay' },
    { key: 'withdrawalEnabled', value: true },
    { key: 'botEnabled', value: true },
    { key: 'verificationMode', value: 'device' },
    { key: 'channels', value: [] },
    { key: 'payoutChannel', value: '' },
    { key: 'taxPercent', value: 0 },
    { key: 'cooldownHours', value: 0 }
  ];
  for (const d of defaults) {
    await Settings.findOneAndUpdate({ key: d.key }, { value: d.value }, { upsert: true, new: true }).catch(() => {});
  }
}

async function getSetting(key) {
  const s = await Settings.findOne({ key });
  return s ? s.value : null;
}

async function setSetting(key, value) {
  return Settings.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
}

// Bot
const bot = new TelegramBot(TOKEN, { polling: true });

function generateReferralCode(telegramId) {
  return 'EU' + telegramId + Math.random().toString(36).substr(2, 4).toUpperCase();
}

async function checkChannelMembership(userId) {
  const channels = await getSetting('channels') || [];
  if (channels.length === 0) return { allJoined: true, notJoined: [] };
  const notJoined = [];
  for (const ch of channels) {
    try {
      const member = await bot.getChatMember(ch.id, userId);
      if (!['member', 'administrator', 'creator'].includes(member.status)) {
        notJoined.push(ch);
      }
    } catch { notJoined.push(ch); }
  }
  return { allJoined: notJoined.length === 0, notJoined };
}

async function sendChannelJoinPrompt(chatId, userId) {
  const { allJoined, notJoined } = await checkChannelMembership(userId);
  if (allJoined) return true;
  const buttons = notJoined.map(ch => [{ text: `📢 Join ${ch.name}`, url: ch.invite }]);
  buttons.push([{ text: '✅ I Joined All Channels', callback_data: 'check_channels' }]);
  await bot.sendMessage(chatId, `🔒 *EarnUltra - Channel Verification*\n\nPlease join all channels below to continue:`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
  return false;
}

bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const botEnabled = await getSetting('botEnabled');
  if (!botEnabled) return bot.sendMessage(chatId, '🔴 Bot is currently offline. Please try later.');
  const ref = match[1].trim();
  let user = await User.findOne({ telegramId: userId });
  if (!user) {
    const code = generateReferralCode(userId);
    user = await User.create({
      telegramId: userId,
      username: msg.from.username || '',
      firstName: msg.from.first_name || '',
      lastName: msg.from.last_name || '',
      referralCode: code,
      referredBy: ref && ref !== userId ? ref : null
    });
  }
  const joined = await sendChannelJoinPrompt(chatId, userId);
  if (!joined) return;
  const webAppUrl = `${WEBAPP_URL}?start=${user.referralCode}`;
  await bot.sendMessage(chatId, `🎉 *Welcome to EarnUltra!*\n\n💰 Earn money by inviting friends!\n\n👆 Tap below to open EarnUltra:`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '🚀 Open EarnUltra App', web_app: { url: webAppUrl } }]]
    }
  });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = String(query.from.id);
  if (query.data === 'check_channels') {
    const { allJoined, notJoined } = await checkChannelMembership(userId);
    if (allJoined) {
      await bot.answerCallbackQuery(query.id, { text: '✅ All channels joined!' });
      await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      const user = await User.findOne({ telegramId: userId });
      const webAppUrl = `${WEBAPP_URL}?start=${user?.referralCode || ''}`;
      await bot.sendMessage(chatId, `🎉 *Welcome to EarnUltra!*\n\n👆 Tap below to open EarnUltra:`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🚀 Open EarnUltra App', web_app: { url: webAppUrl } }]]
        }
      });
    } else {
      const buttons = notJoined.map(ch => [{ text: `📢 Join ${ch.name}`, url: ch.invite }]);
      buttons.push([{ text: '✅ I Joined All Channels', callback_data: 'check_channels' }]);
      await bot.answerCallbackQuery(query.id, { text: `❌ Please join ${notJoined.length} more channel(s)` });
      await bot.editMessageReplyMarkup({ inline_keyboard: buttons }, { chat_id: chatId, message_id: query.message.message_id });
    }
  }
});

// Admin commands
bot.onText(/\/admin/, async (msg) => {
  const userId = String(msg.from.id);
  const admins = (await getSetting('admins')) || [];
  if (!admins.includes(userId) && userId !== '6737872960') {
    return bot.sendMessage(msg.chat.id, '❌ Access Denied');
  }
  bot.sendMessage(msg.chat.id, `🛠 *EarnUltra Admin Panel*\n\nOpen admin panel:`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '⚙️ Open Admin Panel', web_app: { url: `${WEBAPP_URL}/admin.html` } }]]
    }
  });
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const userId = String(msg.from.id);
  const admins = (await getSetting('admins')) || [];
  if (!admins.includes(userId) && userId !== '6737872960') return;
  const message = match[1];
  const users = await User.find({});
  let sent = 0, failed = 0;
  for (const u of users) {
    try {
      await bot.sendMessage(u.telegramId, `📢 *Broadcast Message*\n\n${message}`, { parse_mode: 'Markdown' });
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 50));
  }
  bot.sendMessage(msg.chat.id, `✅ Broadcast sent!\n📤 Sent: ${sent}\n❌ Failed: ${failed}`);
});

// Express API
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Get or create user
app.post('/api/user', async (req, res) => {
  try {
    const { telegramId, username, firstName, lastName, referralCode } = req.body;
    let user = await User.findOne({ telegramId });
    if (!user) {
      const code = generateReferralCode(telegramId);
      user = await User.create({ telegramId, username, firstName, lastName, referralCode: code });
      // Handle referral
      if (referralCode) {
        const referrer = await User.findOne({ referralCode });
        if (referrer && referrer.telegramId !== telegramId) {
          const referAmount = await getSetting('referAmount') || 10;
          await User.updateOne({ telegramId: referrer.telegramId }, {
            $inc: { balance: referAmount, referralCount: 1, totalEarned: referAmount }
          });
          await Transaction.create({ telegramId: referrer.telegramId, type: 'referral', amount: referAmount, description: `Referral bonus for inviting ${firstName}` });
          user.referredBy = referrer.telegramId;
          await user.save();
          // Notify referrer
          try {
            await bot.sendMessage(referrer.telegramId, `🎉 *New Referral!*\n\n👤 ${firstName} joined using your link!\n💰 +₹${referAmount} added to your balance!`, { parse_mode: 'Markdown' });
          } catch {}
        }
      }
    }
    res.json({ success: true, user });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Verify device
app.post('/api/verify', async (req, res) => {
  try {
    const { telegramId, deviceId } = req.body;
    const mode = await getSetting('verificationMode') || 'device';
    if (mode === 'none') {
      await User.updateOne({ telegramId }, { verified: true });
      return res.json({ success: true, verified: true });
    }
    const existing = await User.findOne({ deviceId, telegramId: { $ne: telegramId } });
    if (existing) return res.json({ success: false, error: 'Device already registered with another account' });
    await User.updateOne({ telegramId }, { deviceId, verified: true });
    res.json({ success: true, verified: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Check channels
app.post('/api/check-channels', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const { allJoined, notJoined } = await checkChannelMembership(telegramId);
    const channels = await getSetting('channels') || [];
    res.json({ success: true, allJoined, notJoined, channels });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Get settings (public)
app.get('/api/settings', async (req, res) => {
  try {
    const keys = ['referAmount', 'inviteBonus', 'minWithdrawal', 'maxWithdrawal', 'withdrawalEnabled', 'botEnabled', 'verificationMode', 'channels', 'taxPercent', 'cooldownHours'];
    const result = {};
    for (const k of keys) result[k] = await getSetting(k);
    res.json({ success: true, settings: result });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Get user data
app.get('/api/user/:telegramId', async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.params.telegramId });
    if (!user) return res.json({ success: false, error: 'User not found' });
    res.json({ success: true, user });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const top = await User.find({ referralCount: { $gt: 0 } }).sort({ referralCount: -1 }).limit(50).select('telegramId username firstName referralCount totalEarned');
    res.json({ success: true, leaderboard: top });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// My referrals
app.get('/api/referrals/:telegramId', async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.params.telegramId });
    const referred = await User.find({ referredBy: req.params.telegramId }).select('firstName username createdAt').sort({ createdAt: -1 });
    res.json({ success: true, referrals: referred, count: user?.referralCount || 0 });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Withdrawal
app.post('/api/withdrawal', async (req, res) => {
  try {
    const { telegramId, amount, number } = req.body;
    const withdrawalEnabled = await getSetting('withdrawalEnabled');
    if (!withdrawalEnabled) return res.json({ success: false, error: 'Withdrawals are currently disabled' });
    const user = await User.findOne({ telegramId });
    if (!user) return res.json({ success: false, error: 'User not found' });
    if (!user.verified) return res.json({ success: false, error: 'Please verify your device first' });
    const minW = await getSetting('minWithdrawal') || 50;
    const maxW = await getSetting('maxWithdrawal') || 10000;
    const cooldown = await getSetting('cooldownHours') || 0;
    if (amount < minW) return res.json({ success: false, error: `Minimum withdrawal is ₹${minW}` });
    if (amount > maxW) return res.json({ success: false, error: `Maximum withdrawal is ₹${maxW}` });
    if (user.balance < amount) return res.json({ success: false, error: 'Insufficient balance' });
    if (cooldown > 0 && user.lastWithdrawal) {
      const diff = (Date.now() - new Date(user.lastWithdrawal).getTime()) / 3600000;
      if (diff < cooldown) {
        const remaining = Math.ceil(cooldown - diff);
        return res.json({ success: false, error: `Please wait ${remaining} more hour(s) before next withdrawal` });
      }
    }
    const taxPercent = await getSetting('taxPercent') || 0;
    const taxAmount = Math.floor(amount * taxPercent / 100);
    const finalAmount = amount - taxAmount;
    const apiUrl = await getSetting('withdrawalApi') || '';
    const reqUrl = apiUrl.replace('{number}', number).replace('{amount}', finalAmount);
    let apiResp = '', status = 'pending';
    try {
      const fetch = require('node-fetch');
      const r = await fetch(reqUrl);
      apiResp = await r.text();
      status = 'success';
    } catch (err) { apiResp = err.message; status = 'failed'; }
    const oldBalance = user.balance;
    await User.updateOne({ telegramId }, { $inc: { balance: -amount }, lastWithdrawal: new Date() });
    const newBalance = oldBalance - amount;
    const wd = await Withdrawal.create({ telegramId, username: user.username || user.firstName, amount, tax: taxAmount, finalAmount, number, status, apiResponse: apiResp });
    await Transaction.create({ telegramId, type: 'withdrawal', amount: -amount, description: `Withdrawal of ₹${amount} to ${number}` });
    // Gateway base
    const gatewayBase = apiUrl.split('/APIs')[0] || apiUrl.split('?')[0];
    // Payout channel notification
    const payoutChannel = await getSetting('payoutChannel');
    if (payoutChannel) {
      const emoji = status === 'success' ? '✅' : '❌';
      const msg = `${emoji} *Withdrawal ${status.toUpperCase()}*\n\n👤 User: @${user.username || user.firstName} (${telegramId})\n💸 Amount: ₹${amount}\n🧾 Tax: ₹${taxAmount} (${taxPercent}%)\n✅ Received: ₹${finalAmount}\n📱 Number: ${number}\n💰 Old Balance: ₹${oldBalance}\n💰 New Balance: ₹${newBalance}\n🌐 Gateway: ${gatewayBase}\n📅 Time: ${new Date().toLocaleString('en-IN')}`;
      try { await bot.sendMessage(payoutChannel, msg, { parse_mode: 'Markdown' }); } catch {}
    }
    res.json({ success: true, status, finalAmount, taxAmount, apiResponse: apiResp });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Save number
app.post('/api/save-number', async (req, res) => {
  try {
    const { telegramId, number } = req.body;
    await User.updateOne({ telegramId }, { savedNumber: number });
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Stats
app.get('/api/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalWithdrawals = await Withdrawal.aggregate([{ $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]);
    const totalBalance = await User.aggregate([{ $group: { _id: null, total: { $sum: '$balance' } } }]);
    res.json({
      success: true,
      stats: {
        totalUsers,
        totalWithdrawals: totalWithdrawals[0]?.total || 0,
        withdrawalCount: totalWithdrawals[0]?.count || 0,
        totalBalance: totalBalance[0]?.total || 0
      }
    });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ===== ADMIN APIs =====
function isAdmin(req) {
  const token = req.headers['x-admin-token'];
  return token === process.env.ADMIN_TOKEN || token === 'earnultra_admin_2024';
}

app.get('/api/admin/users', async (req, res) => {
  if (!isAdmin(req)) return res.json({ success: false, error: 'Unauthorized' });
  const users = await User.find().sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, users });
});

app.post('/api/admin/balance', async (req, res) => {
  if (!isAdmin(req)) return res.json({ success: false, error: 'Unauthorized' });
  const { telegramId, amount, action } = req.body;
  const inc = action === 'add' ? Math.abs(amount) : -Math.abs(amount);
  const user = await User.findOneAndUpdate({ telegramId }, { $inc: { balance: inc } }, { new: true });
  await Transaction.create({ telegramId, type: action === 'add' ? 'admin_add' : 'admin_remove', amount: inc, description: `Admin ${action} balance` });
  try {
    await bot.sendMessage(telegramId, `💰 *Balance Update*\n\n${action === 'add' ? '+' : ''}₹${Math.abs(amount)} has been ${action === 'add' ? 'added to' : 'removed from'} your balance!\n\n💳 New Balance: ₹${user.balance}`, { parse_mode: 'Markdown' });
  } catch {}
  res.json({ success: true, newBalance: user.balance });
});

app.post('/api/admin/settings', async (req, res) => {
  if (!isAdmin(req)) return res.json({ success: false, error: 'Unauthorized' });
  const { key, value } = req.body;
  await setSetting(key, value);
  res.json({ success: true });
});

app.get('/api/admin/settings', async (req, res) => {
  if (!isAdmin(req)) return res.json({ success: false, error: 'Unauthorized' });
  const all = await Settings.find();
  const obj = {};
  all.forEach(s => obj[s.key] = s.value);
  res.json({ success: true, settings: obj });
});

app.post('/api/admin/broadcast', async (req, res) => {
  if (!isAdmin(req)) return res.json({ success: false, error: 'Unauthorized' });
  const { message, type } = req.body;
  if (type === 'channel') {
    const channels = await getSetting('channels') || [];
    let sent = 0;
    for (const ch of channels) {
      try { await bot.sendMessage(ch.id, message, { parse_mode: 'Markdown' }); sent++; } catch {}
    }
    return res.json({ success: true, sent });
  }
  const users = await User.find();
  let sent = 0, failed = 0;
  for (const u of users) {
    try { await bot.sendMessage(u.telegramId, `📢 *Announcement*\n\n${message}`, { parse_mode: 'Markdown' }); sent++; } catch { failed++; }
    await new Promise(r => setTimeout(r, 50));
  }
  res.json({ success: true, sent, failed });
});

app.post('/api/admin/withdrawal-manage', async (req, res) => {
  if (!isAdmin(req)) return res.json({ success: false, error: 'Unauthorized' });
  const { withdrawalId, action } = req.body;
  await Withdrawal.updateOne({ _id: withdrawalId }, { status: action });
  res.json({ success: true });
});

app.get('/api/admin/withdrawals', async (req, res) => {
  if (!isAdmin(req)) return res.json({ success: false, error: 'Unauthorized' });
  const withdrawals = await Withdrawal.find().sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, withdrawals });
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initSettings();
  console.log(`EarnUltra running on port ${PORT}`);
});

module.exports = app;
