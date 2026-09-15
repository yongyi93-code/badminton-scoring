/* ------------------------------------------------------------------ *
 * 隐私政策 和 服务条款
 *
 * 写成数据而不是写进组件，为的是改起来只动这一个文件 ——
 * 这两份东西以后一定会改（加了新功能就要改），而每次改都去
 * 一堆 JSX 里翻 t() 是自找麻烦。
 *
 * -------------------------------------------------------------------
 * 两条底线
 *
 *   1. 只写真的在做的事。这份东西的价值全在「说的和做的一致」——
 *      写一句「我们不收集位置信息」然后照样发球馆名去查坐标，
 *      比没有这份文件糟得多。
 *
 *   2. 改了功能就回来改这里。下面每一段都标了它对应代码里的哪一块，
 *      就是为了让「改了那边忘了改这边」这件事不容易发生。
 *
 * -------------------------------------------------------------------
 * 这不是律师写的
 *
 * 是照着「这个 App 实际在做什么」一条条列出来的。PDPA 的具体措辞
 * 要不要找人看一眼，那是另一回事 —— 但先有一份诚实的，
 * 比等一份完美的强。
 * ------------------------------------------------------------------ */

/**
 * 政策的日期。改了内容就改这里。
 *
 * 界面上会显示它 —— 一份不写日期的政策没法判断「我同意的是哪一版」。
 */
export const LEGAL_UPDATED = '2026-09-15'

/**
 * 隐私方面的联系方式。
 *
 * 一份没有联系方式的隐私政策等于没有 —— PDPA 下人有权要求查看、
 * 更正、删除自己的数据，而他得有个地方提。
 *
 * 现在用的是球主的私人邮箱。想换成专用地址（比如 privacy@ 你的域名）
 * 就改这一行，别处不用动。
 */
export const CONTACT_EMAIL = 'yongyi93@gmail.com'

export type Section = {
  zhTitle: string
  enTitle: string
  /** 每一段一条。空字符串会被跳过 */
  zh: string[]
  en: string[]
}

export type Doc = {
  zhTitle: string
  enTitle: string
  sections: Section[]
}

/* ------------------------------------------------------------------ *
 * 隐私政策
 * ------------------------------------------------------------------ */

export const PRIVACY: Doc = {
  zhTitle: '隐私政策',
  enTitle: 'Privacy Policy',
  sections: [
    {
      zhTitle: '一句话',
      enTitle: 'In one line',
      zh: [
        'RALLY 是一个记羽球比分、排名次、约球的工具。它收集的东西只有两类：你打球留下的记录，以及让你能和球友联系所必需的那些。',
        '没有广告，不卖数据，也没有第三方追踪代码。',
      ],
      en: [
        'RALLY is a tool for scoring badminton, ranking players and organising sessions. It collects two kinds of things: the record of your play, and what is needed for you to reach your club mates.',
        'No ads, no selling of data, no third-party tracking scripts.',
      ],
    },
    {
      zhTitle: '收了什么',
      enTitle: 'What is collected',
      zh: [
        '**账号**：邮箱和密码。密码由 Supabase 的认证服务处理，我们这边看不到明文。',
        '**球员资料**：你填的名字、性别（用来排混双）、你挑的角色形象和买的装备。',
        '**打球记录**：每一场的比分、时间、参与的人、球馆名字、AA 分摊的费用。由此算出来的 MMR、段位、金币。',
        '**球馆位置**：你在 App 里给球馆定过位的话，存的是经纬度。没定位就没有。',
        '**好友和私聊**：谁和谁是好友、谁拉黑了谁、私信的文字和语音文件。',
        '**举报**：举报的理由、你写的备注，以及**举报那一刻你们最近 30 条对话的快照**（详见下面单独一节）。',
        '**反馈**：你在「说点什么」里写的内容，加上 App 版本号和手机型号（比如「iOS 17 · Safari · 主屏幕」）。',
        '**推送**：打开通知开关的话，存的是浏览器给的推送地址和密钥，以及那台设备用的是中文还是英文。',
      ],
      en: [
        '**Account**: email and password. Passwords are handled by Supabase Auth — we never see them in plain text.',
        '**Player profile**: the name you enter, gender (used to arrange mixed doubles), your chosen character and the gear you buy.',
        '**Play record**: every match score, time, who played, the venue name, and the shared court fee. Plus the MMR, tier and coins derived from them.',
        '**Venue location**: latitude and longitude, only if you pin a venue on the map. Nothing is stored if you do not.',
        '**Friends and chat**: who is friends with whom, who blocked whom, the text of private messages and voice files.',
        '**Reports**: the reason, your note, and **a snapshot of your last 30 messages taken at the moment you report** (see the separate section below).',
        '**Feedback**: what you write in “Tell us”, plus the app version and phone type (e.g. “iOS 17 · Safari · Home Screen”).',
        '**Push**: if you turn notifications on, the push endpoint and keys your browser issues, and whether that device is set to Chinese or English.',
      ],
    },
    {
      zhTitle: '没收的',
      enTitle: 'What is not collected',
      zh: [
        '不收手机号、不读通讯录、不读相册、不用麦克风（除非你按住那个录音键发语音）。',
        '不追踪你在 App 之外的行为。没有 Google Analytics、没有 Facebook 像素、没有任何广告 SDK。',
        '**不持续定位。**唯一和位置有关的是：你主动给某个球馆定位时，那个球馆的坐标会被存下来 —— 存的是球馆在哪，不是你在哪。',
      ],
      en: [
        'No phone number, no contacts, no photo library, no microphone access unless you hold the record button to send a voice message.',
        'No tracking of what you do outside the app. No Google Analytics, no Facebook pixel, no advertising SDK.',
        '**No continuous location tracking.** The only location data is the coordinates of a venue you deliberately pin — that records where the court is, not where you are.',
      ],
    },
    {
      zhTitle: '举报证据这一段要单独说',
      enTitle: 'About report evidence',
      zh: [
        '你举报一个人的时候，系统会把你们最近 30 条私聊（文字和语音）拍一份快照，连同举报一起存下来。',
        '**为什么要拍**：不拍的话，对方把说过的话删掉，举报就成了一张空白纸 —— 而那正是会骚扰人的人最可能做的一步。',
        '**谁看得到**：只有管理员。被举报的人看不到举报本身，也不知道是谁举报的。',
        '**语音**：管理员只在这条举报还没结案的时候听得到。结了案那扇门就关上了。',
        '**你会被提前告知**：举报那一屏上写着「会把你们最近的对话一起交上去」，你点「确定举报」之前就看得到。',
      ],
      en: [
        'When you report someone, a snapshot of your last 30 private messages (text and voice) is stored together with the report.',
        '**Why**: without it, the other person can simply delete what they said and the report becomes a blank page — which is exactly what a harasser is most likely to do.',
        '**Who can see it**: admins only. The reported person never sees the report, nor who filed it.',
        '**Voice**: an admin can only play it while the report is still open. Once closed, that door shuts.',
        '**You are told first**: the report screen says your recent conversation is submitted, before you tap Submit.',
      ],
    },
    {
      zhTitle: '全国榜：唯一一处跨球群公开的东西',
      enTitle: 'The national board: the one thing visible outside your club',
      zh: [
        '**默认不在榜上。** 要不要上，你自己在「排名 → 全国」那一屏点一下决定。不点就永远不在上面。',
        '**上了之后别人看得到什么**：你的名字（就是你在球群里那个名字）、MMR、胜负场数、有多少场被对手确认过、以及你常去那个球馆在哪个州。',
        '**看不到什么**：你的比赛记录、球局、对手是谁、私聊、邮箱、账号 id。这些一行都不出你的球群 —— 全国榜是另一张表，上面只有上面那几个数。',
        '**随时可以下榜**，同一屏上那个「下榜」按钮，按下去你那一行就被删掉了，不是隐藏。',
        '**别人改不了你那一行**，你也改不了别人的 —— 数据库那边只让每个账号写自己那一行。',
      ],
      en: [
        '**You are not on it by default.** You decide, on Rankings → Malaysia. If you never tap it, you are never listed.',
        '**What others see if you join**: your name (the one in your club), MMR, wins and losses, how many matches an opponent confirmed, and the state of the venue you play at most.',
        '**What they do not see**: your matches, sessions, who you played, private messages, email or account id. None of that leaves your club — the board is a separate table holding only the fields above.',
        '**You can leave any time.** The Leave button on that screen deletes your row; it does not merely hide it.',
        '**Nobody can edit your row and you cannot edit theirs** — the database only lets each account write its own.',
      ],
    },
    {
      zhTitle: '谁看得到你的东西',
      enTitle: 'Who can see what',
      zh: [
        '**同一个球群的人**：你的名字、比分、排名、角色形象。这是这个 App 的用途本身 —— 排行榜要有人看才叫排行榜。',
        '**你的好友**：你和他之间的私聊。私聊只在好友之间开得了。',
        '**管理员**：举报里的内容（含上面说的证据快照）、反馈里的内容。管理员看不到没有被举报的私聊。',
        '**别的球群**：看不到你的任何东西。',
        '这些不是靠界面藏起来的，是数据库的行级安全策略在挡 —— 也就是说，绕开界面也读不到。',
      ],
      en: [
        '**People in your club**: your name, scores, ranking and character. That is the point of the app — a leaderboard nobody can see is not a leaderboard.',
        '**Your friends**: the private messages between you. Chat only opens between friends.',
        '**Admins**: the contents of reports (including the evidence snapshot above) and of feedback. Admins cannot read private chats that were never reported.',
        '**Other clubs**: nothing of yours at all.',
        'This is enforced by database row-level security, not by hiding things in the interface — so going around the interface does not help.',
      ],
    },
    {
      zhTitle: '存在哪、交给了谁',
      enTitle: 'Where it lives, who else touches it',
      zh: [
        '**Supabase**（数据库、账号、语音文件、推送）。数据存在 Supabase 的服务器上，受他们的隐私条款约束。',
        '**GitHub Pages**：App 本身（网页、图片）从这里下载。它看得到的只有普通网站访问日志。',
        '**推送服务**：你开了通知的话，通知要经过你手机厂商的推送服务（苹果、Google、或者浏览器厂商）。通知内容里不带私聊原文。',
        '**photon.komoot.io**：你在 App 里搜球馆地址时，**输入的那段文字**会发给这个地图服务去查坐标。发过去的只有地址文字，不带你是谁。不搜就不发。',
        '除此之外没有别人。不卖数据，也不和广告商共享。',
      ],
      en: [
        '**Supabase** (database, accounts, voice files, push). Data is stored on Supabase servers under their privacy terms.',
        '**GitHub Pages**: the app itself (pages, images) is served from here. It sees only ordinary web access logs.',
        '**Push services**: if you enable notifications, they travel through your phone vendor’s push service (Apple, Google, or your browser vendor). Notification text never contains private message content.',
        '**photon.komoot.io**: when you search for a venue address, **the text you typed** is sent to this map service to look up coordinates. Only that text is sent, with nothing identifying you. If you do not search, nothing is sent.',
        'Nobody else. Data is never sold or shared with advertisers.',
      ],
    },
    {
      zhTitle: '存多久',
      enTitle: 'How long it is kept',
      zh: [
        '账号还在，东西就还在 —— 这是一个记录成长的工具，去年的战绩正是它的意义。',
        '删号之后：你的账号、私聊、语音、好友关系、反馈都会删掉。',
        '**比分不会删**，但会和你脱钩（显示成「已注销的球员」）。原因是一场球有四个人，删掉你那一半，别人的战绩和排名也跟着错了。',
        '举报记录会保留，因为它同时是另一个人的记录。',
      ],
      en: [
        'While your account exists, so does your data — this is a tool for tracking growth, and last year’s record is the point of it.',
        'After you delete your account: your account, private messages, voice files, friendships and feedback are deleted.',
        '**Match scores are not deleted**, but are detached from you (shown as “a removed player”). A match has four people in it; deleting your half would corrupt everyone else’s record and ranking.',
        'Reports are retained, because a report is also a record about someone else.',
      ],
    },
    {
      zhTitle: '你可以做什么',
      enTitle: 'Your choices',
      zh: [
        '**看**：你的数据基本都在 App 里看得到。想要一份完整导出，写信给下面那个邮箱。',
        '**改**：名字、性别、角色随时能改。比分记错了找球局里的人改。',
        '**删**：想删号写信给下面那个邮箱。（App 里的一键删号还没做，这是实话。）',
        '**撤回同意**：关掉通知开关就不再推送；不加好友就不会有私聊；不定位球馆就不存坐标。',
      ],
      en: [
        '**See**: most of your data is visible in the app. For a full export, email the address below.',
        '**Correct**: name, gender and character can be changed any time. A wrong score is fixed by whoever ran that session.',
        '**Delete**: email the address below to delete your account. (There is no one-tap delete in the app yet — that is the honest state of it.)',
        '**Withdraw consent**: turning off notifications stops push; not adding friends means no chat; not pinning a venue means no coordinates.',
      ],
    },
    {
      zhTitle: '小孩',
      enTitle: 'Children',
      zh: [
        'RALLY 不是给 13 岁以下的人用的。发现有这样的账号会删掉。',
        '13 到 18 岁的，请家长看过这份东西再用 —— 尤其是私聊和语音那部分。',
      ],
      en: [
        'RALLY is not intended for anyone under 13. Such accounts will be removed if found.',
        'If you are between 13 and 18, please have a parent read this first — especially the chat and voice sections.',
      ],
    },
    {
      zhTitle: '安全，以及说实话的部分',
      enTitle: 'Security, honestly',
      zh: [
        '密码不由我们保管；数据库每一张表都有行级安全策略；私聊和语音只有当事人读得到；语音文件存在私有桶里，每次播放要现签一条一小时有效的链接。',
        '但要说清楚：这是一个人做的小工具，不是银行。目前**没有购买数据库的每日备份**。真出事的话，数据有可能丢。这一条写在这里，是因为你有权知道。',
      ],
      en: [
        'Passwords are not ours to hold; every table has row-level security; private messages and voice are readable only by the two people involved; voice files live in a private bucket and each playback needs a freshly signed one-hour link.',
        'But to be plain: this is a small tool built by one person, not a bank. There is currently **no paid daily database backup**. In a serious failure, data could be lost. This is written here because you have a right to know.',
      ],
    },
    {
      zhTitle: '改了怎么办',
      enTitle: 'Changes',
      zh: [
        '这份东西改了，页面顶上的日期会变。改动大的话会在 App 里提醒一次。',
      ],
      en: [
        'If this changes, the date at the top changes with it. A significant change will be announced once inside the app.',
      ],
    },
  ],
}

/* ------------------------------------------------------------------ *
 * 服务条款
 * ------------------------------------------------------------------ */

export const TERMS: Doc = {
  zhTitle: '服务条款',
  enTitle: 'Terms of Service',
  sections: [
    {
      zhTitle: '这是什么',
      enTitle: 'What this is',
      zh: [
        'RALLY 是一个免费的羽球记分和约球工具，由个人开发和维护，不是公司产品。',
        '用它就表示你接受下面这些。',
      ],
      en: [
        'RALLY is a free badminton scoring and session tool, built and maintained by one person. It is not a company product.',
        'Using it means you accept what follows.',
      ],
    },
    {
      zhTitle: '账号',
      enTitle: 'Your account',
      zh: [
        '一个人一个账号，用真实姓名或者球友认得出的名字 —— 排行榜上一堆假名字，这个 App 就没用了。',
        '密码是你自己的事。账号下发生的事算你的。',
        '不能冒充别人。',
      ],
      en: [
        'One account per person, under your real name or one your club mates recognise — a leaderboard full of fake names is useless.',
        'Your password is your responsibility. What happens under your account is yours.',
        'Do not impersonate anyone.',
      ],
    },
    {
      zhTitle: '不许做的事',
      enTitle: 'What you may not do',
      zh: [
        '**骚扰、辱骂、威胁别人。**包括私聊和语音。',
        '**乱填比分刷分刷金币。**排名的全部价值在于它是真的。',
        '**冒充别人、发广告、发和打球无关的链接。**',
        '**滥用举报。**拿举报去整人，被处理的是你。',
        '违反的后果：轻则管理员私下找你，重则删号。',
      ],
      en: [
        '**Harass, abuse or threaten people.** Including in chat and voice messages.',
        '**Fake scores to farm points or coins.** The whole value of a ranking is that it is real.',
        '**Impersonate others, advertise, or post links unrelated to badminton.**',
        '**Abuse the report button.** Using reports to attack someone counts against you.',
        'Consequences range from a private word from an admin to account removal.',
      ],
    },
    {
      zhTitle: '举报会怎么处理',
      enTitle: 'How reports are handled',
      zh: [
        '举报会连同你们最近的对话快照一起送到管理员那里（见隐私政策里那一节）。',
        '管理员会看，然后给一个结论：处理了，或者看过觉得没事。',
        '被举报的人不会知道是谁举报的。',
        '**现在还没有封号功能。**真遇到要封的情况，会先想清楚怎么申诉再做 —— 一个没有申诉的封号按钮是另一种伤害。这一条写在这里，是因为承诺做不到的事比不承诺更糟。',
      ],
      en: [
        'A report reaches an admin together with a snapshot of your recent conversation (see the privacy policy section).',
        'An admin reads it and reaches one of two conclusions: acted on, or looked at and found to be nothing.',
        'The reported person is never told who reported them.',
        '**There is no ban feature yet.** If banning becomes necessary, an appeals process will be designed first — a ban button without an appeal is its own kind of harm. This is stated here because promising what does not exist is worse than not promising.',
      ],
    },
    {
      zhTitle: '比分和排名',
      enTitle: 'Scores and rankings',
      zh: [
        '比分是球场上的人自己记的，RALLY 不核实。MMR、段位、金币都是照着这些比分算出来的。',
        '也就是说：**排名好玩，但不权威。**别拿它当选拔依据，也别为它吵架。',
        '记错了找当场的人改。',
      ],
      en: [
        'Scores are entered by whoever is on court; RALLY does not verify them. MMR, tiers and coins are all derived from those scores.',
        'So: **rankings are fun, not authoritative.** Do not use them for selection, and do not fight over them.',
        'A wrong score is fixed by whoever was there.',
      ],
    },
    {
      zhTitle: '金币和装备',
      enTitle: 'Coins and gear',
      zh: [
        '金币是打球赚的游戏币，**不是钱，不能兑现，也不能转给别人**。',
        '买的装备只在 App 里有意义。',
        '规则以后可能调整（比如价格重排过一次），已经买到的东西不会被没收。',
      ],
      en: [
        'Coins are earned by playing and are **not money — they cannot be cashed out or transferred**.',
        'Gear you buy exists only inside the app.',
        'The rules may be adjusted (prices have been re-laid once already); what you already own is never taken away.',
      ],
    },
    {
      zhTitle: '球场上的事',
      enTitle: 'What happens on court',
      zh: [
        'RALLY 只是个记分的工具。约球、收费、场地、受伤 —— 这些是你们之间的事，和这个工具无关。',
        'AA 分摊那个数字是算给你们看的，钱怎么收是你们自己的事。',
      ],
      en: [
        'RALLY is a scoring tool. Arranging games, collecting money, the court itself, injuries — those are between you and the people you play with, not the tool.',
        'The split-the-fee number is a calculation for you to look at; how money actually changes hands is up to you.',
      ],
    },
    {
      zhTitle: '不保证什么',
      enTitle: 'No warranty',
      zh: [
        'RALLY 按现状提供，免费，没有任何保证。它可能出错、可能停服、可能丢数据（见隐私政策里安全那一节）。',
        '重要的东西请自己也留一份。',
      ],
      en: [
        'RALLY is provided as is, free, with no warranty. It can have bugs, it can stop, it can lose data (see the security section of the privacy policy).',
        'Keep your own copy of anything that matters.',
      ],
    },
    {
      zhTitle: '适用法律',
      enTitle: 'Governing law',
      zh: ['马来西亚法律。'],
      en: ['The laws of Malaysia.'],
    },
  ],
}
