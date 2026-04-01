require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const { dbRef, ref, set, get, child, remove, push, update } = require('./firebase');

// ⚙️ Configuration
const PORT = process.env.PORT || 3000;
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || 0;
const DOMAIN = process.env.RENDER_EXTERNAL_URL;
const BOT_TOKEN = process.env.BOT_TOKEN;
const REFERRAL_BONUS = 50;

if (!BOT_TOKEN) {
    console.error("Error: BOT_TOKEN is missing.");
    process.exit(1);
}

const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
app.use(express.json());
app.use(express.static('public'));

const adminState = {};

// ============================================================
// 🛠 Helper Functions
// ============================================================

async function getUser(uid) {
    try {
        const snap = await get(child(dbRef, `users/${uid}`));
        return snap.exists() ? snap.val() : null;
    } catch (e) { return null; }
}

async function updateUserBalance(uid, amount) {
    try {
        const snap = await get(child(dbRef, `users/${uid}/balance`));
        const currentBalance = snap.exists() ? snap.val() : 0;
        await update(child(dbRef, `users/${uid}`), { balance: currentBalance + amount });
    } catch (e) { console.error("Balance Error:", e); }
}

async function getActiveProducts() {
    try {
        const snap = await get(child(dbRef, 'products'));
        if (!snap.exists()) return [];
        return Object.keys(snap.val()).map(key => ({ id: key, ...snap.val()[key] })).filter(p => p.active).reverse();
    } catch (e) { return []; }
}

// ============================================================
// 🤖 Middleware & User Registration
// ============================================================

bot.use(async (ctx, next) => {
    if (ctx.from) {
        const uid = ctx.from.id;
        const snap = await get(child(dbRef, `users/${uid}`));

        if (!snap.exists()) {
            let referrerId = null;
            
            if (ctx.startPayload && ctx.startPayload != uid && !isNaN(ctx.startPayload)) {
                referrerId = parseInt(ctx.startPayload);
                
                // Referrer কে বোনাস দিন এবং কাউন্ট বাড়ান
                const refSnap = await get(child(dbRef, `users/${referrerId}/referrals`));
                const currentCount = refSnap.exists() ? refSnap.val() : 0;
                
                await update(child(dbRef, `users/${referrerId}`), {
                    balance: (await get(child(dbRef, `users/${referrerId}/balance`))).val() + REFERRAL_BONUS,
                    referrals: currentCount + 1
                });

                try {
                    await bot.telegram.sendMessage(referrerId, 
                        `🎉 <b>নতুন রেফারেল যুক্ত হয়েছে!</b>\n\n💰 আপনার অ্যাকাউন্টে <b>+${REFERRAL_BONUS} কয়েন</b> যোগ হয়েছে।`, 
                        { parse_mode: 'HTML' }
                    );
                } catch (e) {}
            }

            await set(child(dbRef, `users/${uid}`), {
                firstName: ctx.from.first_name,
                username: ctx.from.username || 'none',
                balance: 0,
                joinedAt: Date.now(),
                referredBy: referrerId,
                referrals: 0
            });
        }
    }

    if (ctx.from && ctx.from.id === ADMIN_ID && adminState[ADMIN_ID] && ctx.message) {
        return handleAdminWizard(ctx);
    }

    return next();
});

// ============================================================
// 🎨 Keyboards & Menus
// ============================================================

const getMainMenu = (isAdmin) => {
    let buttons = [
        [Markup.button.callback('🛒  সোর্স কোড স্টোর', 'menu_shop')],
        [Markup.button.callback('🤝  রেফার ও আয়', 'menu_refer'), Markup.button.callback('💰  ওয়ালেট', 'menu_wallet')],
        [Markup.button.callback('📂  আমার লাইব্রেরি', 'menu_library'), Markup.button.callback('💬  সাপোর্ট', 'menu_support')]
    ];
    if (isAdmin) buttons.push([Markup.button.callback('👑  অ্যাডমিন প্যানেল', 'admin_panel')]);
    return Markup.inlineKeyboard(buttons);
};

bot.command('start', async (ctx) => await sendHome(ctx));

async function sendHome(ctx) {
    try { if (ctx.callbackQuery) await ctx.deleteMessage(); } catch (e) {}
    const user = await getUser(ctx.from.id);
    const bal = user ? user.balance : 0;
    
    const msg = `▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️\n\n` +
                `👋  <b>হ্যালো, ${ctx.from.first_name}</b>\n\n` +
                `💎  ব্যালেন্স: <b>${bal} কয়েন</b>\n` +
                `🛒  প্রিমিয়াম সোর্স কোড স্টোরে আপনাকে স্বাগতম।\n\n` +
                `▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️`;
    
    await ctx.replyWithHTML(msg, getMainMenu(ctx.from.id === ADMIN_ID));
}

// ============================================================
// 🛍 SHOP SYSTEM
// ============================================================

bot.action('menu_shop', async (ctx) => {
    const products = await getActiveProducts();
    
    if (products.length === 0) {
        await ctx.answerCbQuery("স্টোরে এখন কোনো প্রোডাক্ট নেই!", { show_alert: true });
        return ctx.replyWithHTML("<b>🚫 এখন স্টোরে কোনো প্রোডাক্ট নেই।</b>", getMainMenu(ctx.from.id === ADMIN_ID));
    }

    const buttons = products.map(p => [
        Markup.button.callback(`📦  ${p.title}`, `view_prod_${p.id}`)
    ]);
    buttons.push([Markup.button.callback('🔙  ফিরে যান', 'home_cmd')]);

    try { await ctx.deleteMessage(); } catch(e){}
    
    await ctx.replyWithHTML(
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n` +
        `🛒  <b>সোর্স কোড ক্যাটালগ</b>\n` +
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n\n` +
        `প্রোডাক্ট সিলেক্ট করুন:`,
        Markup.inlineKeyboard(buttons)
    );
});

bot.action(/view_prod_(.+)/, async (ctx) => {
    const prodId = ctx.match[1];
    const snap = await get(child(dbRef, `products/${prodId}`));

    if (!snap.exists()) return ctx.answerCbQuery("প্রোডাক্ট পাওয়া যায়নি!");
    const p = snap.val();

    const caption = `➖➖➖➖➖➖➖➖➖➖➖➖➖\n` +
                    `📦  <b>${p.title}</b>\n` +
                    `➖➖➖➖➖➖➖➖➖➖➖➖➖\n\n` +
                    `📝  <b>বিবরণ:</b> ${p.description}\n\n` +
                    `💰  <b>মূল্য:</b> ${p.price} কয়েন\n` +
                    `📦  <b>ভার্সন:</b> ${p.version}\n` +
                    `🛠  <b>টেকনোলজি:</b> ${p.tech}`;

    const buttons = Markup.inlineKeyboard([
        [Markup.button.callback(`🛒  এখনই কিনুন (${p.price} 🪙)`, `buy_${p.id}`)],
        [Markup.button.callback('🔙  তালিকায় ফিরে যান', 'menu_shop')]
    ]);

    try {
        if (ctx.callbackQuery.message.photo) {
            await ctx.editMessageMedia({ type: 'photo', media: p.imageId, caption: caption, parse_mode: 'HTML' }, buttons);
        } else {
            await ctx.deleteMessage();
            await ctx.replyWithPhoto(p.imageId, { caption: caption, parse_mode: 'HTML', ...buttons });
        }
    } catch (e) {
        try { await ctx.deleteMessage(); } catch(err){}
        await ctx.replyWithPhoto(p.imageId, { caption: caption, parse_mode: 'HTML', ...buttons });
    }
});

bot.action(/buy_(.+)/, async (ctx) => {
    const prodId = ctx.match[1];
    const uid = ctx.from.id;
    const user = await getUser(uid);
    
    const pSnap = await get(child(dbRef, `products/${prodId}`));
    if (!pSnap.exists()) return ctx.answerCbQuery("ত্রুটি!");
    const p = pSnap.val();

    const purchaseSnap = await get(child(dbRef, `purchases/${uid}/${prodId}`));
    if (purchaseSnap.exists()) {
        return ctx.answerCbQuery("✅ আপনি ইতিমধ্যে এটি কিনেছেন!", { show_alert: true });
    }

    if (!user || user.balance < p.price) {
        const short = p.price - (user ? user.balance : 0);
        const adUrl = `${DOMAIN}/ads.html?uid=${uid}`;
        
        try { await ctx.deleteMessage(); } catch(e){}
        
        return ctx.replyWithHTML(
            `⚠️  <b>ব্যালেন্স অপর্যাপ্ত!</b>\n\n` +
            `আপনার আরও <b>${short} কয়েন</b> প্রয়োজন।\n` +
            `ফ্রি কয়েন আয় করতে নিচের বাটনে ক্লিক করুন 👇`,
            Markup.inlineKeyboard([
                [Markup.button.webApp('📺  বিজ্ঞাপন দেখুন (+10)', adUrl)],
                [Markup.button.callback('🔙  ফিরে যান', 'menu_shop')]
            ])
        );
    }

    // Buy Success: Balance Cut, Purchase Save & Admin Log
    await updateUserBalance(uid, -p.price);
    await set(child(dbRef, `purchases/${uid}/${prodId}`), { purchasedAt: Date.now(), price: p.price });
    
    // Admin কে নোটিফিকেশন ও লগ সেভ
    const logData = {
        buyerId: uid,
        buyerName: user.firstName,
        buyerUsername: user.username,
        productName: p.title,
        productId: prodId,
        price: p.price,
        time: Date.now()
    };
    await push(child(dbRef, 'purchaseLogs'), logData);

    try {
        await bot.telegram.sendMessage(ADMIN_ID, 
            `🛒  <b>নতুন সেল!</b>\n\n` +
            `👤  ক্রেতা: <b>${user.firstName}</b> (@${user.username})\n` +
            `📦  প্রোডাক্ট: <b>${p.title}</b>\n` +
            `💰  মূল্য: <b>${p.price} কয়েন</b>`,
            { parse_mode: 'HTML' }
        );
    } catch(e) {}

    await ctx.editMessageCaption(
        `✅  <b>ক্রয় সফল হয়েছে!</b>\n\n` +
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n` +
        `📦  প্রোডাক্ট: <b>${p.title}</b>\n` +
        `🔗  ডাউনলোড: ${p.link}\n` +
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n\n` +
        `<i>ভবিষ্যতে ডাউনলোড করতে 'আমার লাইব্রেরি' চেক করুন।</i>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙  হোম', callback_data: 'home_cmd' }]] } }
    );
});

// ============================================================
// 🤝 Referral, Wallet, Library, Support
// ============================================================

bot.action('menu_refer', async (ctx) => {
    const uid = ctx.from.id;
    const user = await getUser(uid);
    const botInfo = await bot.telegram.getMe();
    const link = `https://t.me/${botInfo.username}?start=${uid}`;
    const count = user && user.referrals ? user.referrals : 0;

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n` +
        `🤝  <b>রেফার এন্ড আর্ন</b>\n` +
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n\n` +
        `প্রতিটি ফ্রেন্ডের জন্য পান <b>${REFERRAL_BONUS} কয়েন</b>!\n\n` +
        `👥  মোট রেফারেল: <b>${count} জন</b>\n` +
        `💰  মোট আয়: <b>${count * REFERRAL_BONUS} কয়েন</b>\n\n` +
        `🔗  আপনার লিংক:\n<code>${link}</code>`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙  ফিরে যান', 'home_cmd')]])
    );
});

bot.action('menu_wallet', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const bal = user ? user.balance : 0;
    const adUrl = `${DOMAIN}/ads.html?uid=${ctx.from.id}`;

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n` +
        `💰  <b>আপনার ওয়ালেট</b>\n` +
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n\n` +
        `বর্তমান ব্যালেন্স: <b>${bal} কয়েন</b>`,
        Markup.inlineKeyboard([
            [Markup.button.webApp('📺  বিজ্ঞাপন দেখুন (+10)', adUrl)],
            [Markup.button.callback('🔙  ফিরে যান', 'home_cmd')]
        ])
    );
});

bot.action('menu_library', async (ctx) => {
    const uid = ctx.from.id;
    const snap = await get(child(dbRef, `purchases/${uid}`));
    
    if (!snap.exists()) return ctx.answerCbQuery("আপনার লাইব্রেরি খালি!", { show_alert: true });

    let buttons = [];
    for (const pid of Object.keys(snap.val())) {
        const pSnap = await get(child(dbRef, `products/${pid}`));
        if (pSnap.exists()) {
            buttons.push([Markup.button.callback(`📥  ${pSnap.val().title}`, `dl_${pid}`)]);
        }
    }
    buttons.push([Markup.button.callback('🔙  ফিরে যান', 'home_cmd')]);

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n` +
        `📂  <b>আমার লাইব্রেরি</b>\n` +
        `➖➖➖➖➖➖➖➖➖➖➖➖➖`,
        Markup.inlineKeyboard(buttons)
    );
});

bot.action(/dl_(.+)/, async (ctx) => {
    const snap = await get(child(dbRef, `products/${ctx.match[1]}`));
    if (snap.exists()) {
        const p = snap.val();
        ctx.replyWithHTML(
            `🔗  <b>${p.title}</b>\n\n` +
            `➖➖➖➖➖➖➖➖➖➖➖➖➖\n` +
            `ডাউনলোড লিংক: ${p.link}\n` +
            `➖➖➖➖➖➖➖➖➖➖➖➖➖`
        );
    }
});

bot.action('menu_support', async (ctx) => {
    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n` +
        `💬  <b>সাহায্য প্রয়োজন?</b>\n` +
        `➖➖➖➖➖➖➖➖➖➖➖➖➖\n\n` +
        `যেকোনো সমস্যার জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।`,
        Markup.inlineKeyboard([
            [Markup.button.url('📩  অ্যাডমিনকে মেসেজ করুন', 'https://t.me/lagatech')],
            [Markup.button.callback('🔙  ফিরে যান', 'home_cmd')]
        ])
    );
});

bot.action('home_cmd', (ctx) => sendHome(ctx));

// ============================================================
// 👑 Admin Panel
// ============================================================

bot.action('admin_panel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    // Total Users Count
    const usersSnap = await get(child(dbRef, 'users'));
    const totalUsers = usersSnap.exists() ? Object.keys(usersSnap.val()).length : 0;

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(
        `▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️\n\n` +
        `👑  <b>অ্যাডমিন প্যানেল</b>\n\n` +
        `👥  মোট ইউজার: <b>${totalUsers} জন</b>\n\n` +
        `▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️▪️`,
        Markup.inlineKeyboard([
            [Markup.button.callback('➕  প্রোডাক্ট যোগ করুন', 'admin_add_start')],
            [Markup.button.callback('🗑  প্রোডাক্ট ডিলিট করুন', 'admin_delete_list')],
            [Markup.button.callback('📋  পারচেজ লগ দেখুন', 'admin_view_logs')],
            [Markup.button.callback('📢  ব্রডকাস্ট মেসেজ', 'admin_cast_start')],
            [Markup.button.callback('🔙  হোমে যান', 'home_cmd')]
        ])
    );
});

// Purchase Logs View
bot.action('admin_view_logs', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const snap = await get(child(dbRef, 'purchaseLogs'));
    
    if (!snap.exists()) {
        return ctx.answerCbQuery("কোনো পারচেজ লগ নেই!", { show_alert: true });
    }

    const logs = snap.val();
    // নতুন থেকে পুরনো ক্রমে সাজানো
    const sortedLogs = Object.values(logs).sort((a, b) => b.time - a.time).slice(0, 10); // শেষ ১০টি দেখাবে

    let logText = `📋  <b>সাম্প্রতিক পারচেজ লগ:</b>\n\n➖➖➖➖➖➖➖➖➖➖➖➖➖\n`;
    
    sortedLogs.forEach(log => {
        const date = new Date(log.time).toLocaleString('bn-BD');
        logText += `👤  <b>${log.buyerName}</b> (@${log.buyerUsername})\n` +
                   `📦  প্রোডাক্ট: ${log.productName}\n` +
                   `💰  মূল্য: ${log.price} কয়েন\n` +
                   `🕒  তারিখ: ${date}\n` +
                   `➖➖➖➖➖➖➖➖➖➖➖➖➖\n`;
    });

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(logText, Markup.inlineKeyboard([
        [Markup.button.callback('🔙  অ্যাডমিন প্যানেল', 'admin_panel')]
    ]));
});

// Delete List Logic
bot.action('admin_delete_list', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const products = await getActiveProducts();
    const buttons = products.map(p => [Markup.button.callback(`🗑  ${p.title}`, `del_${p.id}`)]);
    buttons.push([Markup.button.callback('🔙  ফিরে যান', 'admin_panel')]);

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML("🗑  <b>ডিলিট করতে প্রোডাক্ট সিলেক্ট করুন:</b>", Markup.inlineKeyboard(buttons));
});

bot.action(/del_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await remove(child(dbRef, `products/${ctx.match[1]}`));
    ctx.answerCbQuery("✅ ডিলিট হয়েছে!");
    // তালিকা রিফ্রেশ করতে আবার একই ফাংশন কল করা হচ্ছে
    return ctx.answerCbQuery("✅ সফলভাবে ডিলিট হয়েছে!").then(() => {
        bot.action('admin_delete_list').call(null, ctx);
    });
});

// Wizards Start
bot.action('admin_add_start', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState[ADMIN_ID] = { type: 'PRODUCT', step: 'PHOTO', data: {} };
    ctx.reply("📸  ধাপ ১/৫: প্রোডাক্টের কভার ফটো পাঠান।");
});

bot.action('admin_cast_start', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState[ADMIN_ID] = { type: 'BROADCAST', step: 'PHOTO', data: {} };
    ctx.reply("📢  ধাপ ১/৩: ফটো পাঠান (অথবা টাইপ করুন 'skip')।");
});

// ============================================================
// 🧞 Wizard Handler
// ============================================================
async function handleAdminWizard(ctx) {
    const state = adminState[ADMIN_ID];
    const text = ctx.message.text || '';

    if (state.type === 'BROADCAST') {
        if (state.step === 'PHOTO') {
            if (ctx.message.photo) state.data.photo = ctx.message.photo.pop().file_id;
            state.step = 'TEXT';
            ctx.reply("📝  ধাপ ২/৩: ক্যাপশন টেক্সট পাঠান:");
        } else if (state.step === 'TEXT') {
            state.data.text = text;
            state.step = 'BTN';
            ctx.reply("🔘  ধাপ ৩/৩: বাটন ফরম্যাট (Name|URL) অথবা 'skip' লিখুন:");
        } else if (state.step === 'BTN') {
            const usersSnap = await get(child(dbRef, 'users'));
            const users = usersSnap.exists() ? usersSnap.val() : {};
            let count = 0;
            let extra = { parse_mode: 'HTML' };
            
            if (text.includes('|')) {
                const parts = text.split('|');
                extra.reply_markup = { inline_keyboard: [[{ text: parts[0], url: parts[1] }]] };
            }
            
            ctx.reply("⏳ ব্রডকাস্ট পাঠানো হচ্ছে...");
            for (const uid of Object.keys(users)) {
                try {
                    if (state.data.photo) {
                        await bot.telegram.sendPhoto(uid, state.data.photo, { caption: state.data.text, ...extra });
                    } else {
                        await bot.telegram.sendMessage(uid, state.data.text, extra);
                    }
                    count++;
                    if (count % 20 === 0) await new Promise(r => setTimeout(r, 1000));
                } catch (e) {}
            }
            delete adminState[ADMIN_ID];
            ctx.reply(`✅ মোট ${count} জন ইউজারকে মেসেজ পাঠানো হয়েছে।`);
        }
        return;
    }

    if (state.type === 'PRODUCT') {
        if (state.step === 'PHOTO') {
            if (!ctx.message.photo) return ctx.reply("❌ ফটো প্রয়োজন!");
            state.data.imageId = ctx.message.photo.pop().file_id;
            state.step = 'TITLE';
            ctx.reply("📝  ধাপ ২/৫: প্রোডাক্টের নাম দিন:");
        } else if (state.step === 'TITLE') {
            state.data.title = text;
            state.step = 'DESC';
            ctx.reply("📄  ধাপ ৩/৫: বিবরণ লিখুন:");
        } else if (state.step === 'DESC') {
            state.data.description = text;
            state.step = 'INFO';
            ctx.reply("💰  ধাপ ৪/৫: ফরম্যাট অনুযায়ী লিখুন (মূল্য|ভার্সন|টেকনোলজি) \n\nউদাহরণ: 100|v1.0|React JS");
        } else if (state.step === 'INFO') {
            const p = text.split('|');
            if (p.length < 3) return ctx.reply("❌ ভুল ফরম্যাট! আবার চেষ্টা করুন।");
            state.data.price = parseInt(p[0]);
            state.data.version = p[1];
            state.data.tech = p[2];
            state.step = 'LINK';
            ctx.reply("🔗  ধাপ ৫/৫: ডাউনলোড লিংক দিন:");
        } else if (state.step === 'LINK') {
            state.data.link = text;
            state.data.active = true;
            
            const newProductRef = push(child(dbRef, 'products'));
            await set(newProductRef, state.data);
            
            delete adminState[ADMIN_ID];
            ctx.reply("✅ প্রোডাক্ট সফলভাবে যোগ হয়েছে!");
        }
    }
}

// ============================================================
// 🌐 API & Server
// ============================================================

app.post('/api/reward', async (req, res) => {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: 'No UID' });

    await updateUserBalance(uid, 10);
    const user = await getUser(uid);

    res.json({ success: true, newBalance: user ? user.balance : 0 });
});

// Webhook Setup
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    if (DOMAIN) {
        try {
            await bot.telegram.setWebhook(`${DOMAIN}/bot${BOT_TOKEN}`);
            console.log(`Webhook set to ${DOMAIN}/bot${BOT_TOKEN}`);
        } catch (e) {
            console.error("Webhook set failed:", e);
        }
    } else {
        console.log("Running in polling mode...");
        bot.launch();
    }
});
