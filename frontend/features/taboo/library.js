// features/taboo/library.js — Taboo Game 字卡題庫 (120+ 張台灣本土化詞彙)
// 每張字卡為 { zh, en }：依目前語言 (i18n) 決定顯示哪個版本。
export const gameLibrary = [
    // 地獄級 (常用單字,超容易脫口而出)
    { zh: '我', en: 'I' }, { zh: '你', en: 'You' }, { zh: '是', en: 'Yes' },
    { zh: '對', en: 'Right' }, { zh: '有', en: 'Have' }, { zh: '好', en: 'Good' },
    { zh: '不', en: 'No' }, { zh: '的', en: 'Of' }, { zh: '那', en: 'That' },
    { zh: '就', en: 'Just' }, { zh: '會', en: 'Can' }, { zh: '要', en: 'Want' },
    { zh: '嗎', en: 'Huh' }, { zh: '沒', en: 'Not' }, { zh: '來', en: 'Come' },
    { zh: '去', en: 'Go' },

    // 口頭禪 (台灣日常)
    { zh: '真的假的', en: 'For real?' }, { zh: '然後勒', en: 'And then?' },
    { zh: '確實', en: 'True that' }, { zh: '傻眼', en: 'Jaw drop' },
    { zh: '就是說啊', en: 'Exactly!' }, { zh: '基本上', en: 'Basically' },
    { zh: '沒差啦', en: 'Whatever' }, { zh: '原本想說', en: 'I was gonna say' },
    { zh: '蛤', en: 'Huh?' }, { zh: '是喔', en: 'Oh really' },
    { zh: '欸欸', en: 'Hey hey' }, { zh: '不是吧', en: 'No way' },
    { zh: '超扯', en: 'Ridiculous' }, { zh: '哎喲', en: 'Ouch' },
    { zh: '有夠', en: 'So very' }, { zh: '認真的', en: 'Seriously' },
    { zh: '嘖嘖', en: 'Tsk tsk' }, { zh: '是在哈囉', en: 'Hello?!' },
    { zh: '笑死', en: 'LMAO' }, { zh: '無所謂', en: "Don't care" },
    { zh: '矮油', en: 'Aiyo' }, { zh: '我跟你說', en: 'Let me tell you' },
    { zh: '也是啦', en: 'Fair enough' }, { zh: '真假', en: 'Real or fake?' },
    { zh: '厲害', en: 'Awesome' },

    // 情緒類 (口語髒話 / 抱怨)
    { zh: '靠北', en: 'Damn' }, { zh: '屁啦', en: 'BS!' },
    { zh: '白目', en: 'Clueless' }, { zh: '煩欸', en: 'So annoying' },
    { zh: '北七', en: 'Idiot' }, { zh: '神經病', en: 'Crazy' },
    { zh: '機車', en: 'Jerk' }, { zh: '靠杯', en: 'WTH' },
    { zh: '欠打', en: 'Asking for it' }, { zh: '討厭', en: 'Hate it' },
    { zh: '笑死人', en: 'Hilarious' }, { zh: '爽', en: 'Feels great' },
    { zh: '悶', en: 'Bored' }, { zh: '無言', en: 'Speechless' },
    { zh: '心累', en: 'Exhausted' }, { zh: '火大', en: 'Furious' },

    // 動作類 (聚會中可能會做的動作)
    { zh: '點頭', en: 'Nod' }, { zh: '搖頭', en: 'Shake head' },
    { zh: '摸頭髮', en: 'Touch hair' }, { zh: '喝水', en: 'Drink water' },
    { zh: '大笑', en: 'Laugh out loud' }, { zh: '翹二郎腿', en: 'Cross legs' },
    { zh: '看手機', en: 'Check phone' }, { zh: '皺眉', en: 'Frown' },
    { zh: '聳肩', en: 'Shrug' }, { zh: '抓癢', en: 'Scratch' },
    { zh: '打呵欠', en: 'Yawn' }, { zh: '托腮', en: 'Chin on hand' },
    { zh: '拍手', en: 'Clap' }, { zh: '轉筆', en: 'Spin a pen' },
    { zh: '咬指甲', en: 'Bite nails' }, { zh: '伸懶腰', en: 'Stretch' },
    { zh: '嘆氣', en: 'Sigh' },

    // 台灣食物
    { zh: '珍珠奶茶', en: 'Bubble tea' }, { zh: '滷肉飯', en: 'Braised pork rice' },
    { zh: '雞排', en: 'Fried chicken cutlet' }, { zh: '蚵仔煎', en: 'Oyster omelet' },
    { zh: '臭豆腐', en: 'Stinky tofu' }, { zh: '刈包', en: 'Gua bao' },
    { zh: '芒果冰', en: 'Mango shaved ice' }, { zh: '鳳梨酥', en: 'Pineapple cake' },
    { zh: '小籠包', en: 'Xiao long bao' }, { zh: '滷味', en: 'Braised snacks' },
    { zh: '鹹酥雞', en: 'Popcorn chicken' }, { zh: '麻辣鍋', en: 'Spicy hot pot' },
    { zh: '豬血糕', en: "Pig's blood cake" }, { zh: '蛋餅', en: 'Egg pancake' },
    { zh: '魯味', en: 'Braised food' }, { zh: '牛肉麵', en: 'Beef noodles' },

    // 台灣地點 / 文化
    { zh: '夜市', en: 'Night market' }, { zh: '便利商店', en: 'Convenience store' },
    { zh: '捷運', en: 'MRT' }, { zh: '台鐵', en: 'TRA train' },
    { zh: '高鐵', en: 'HSR' }, { zh: '101', en: 'Taipei 101' },
    { zh: '九份', en: 'Jiufen' }, { zh: '墾丁', en: 'Kenting' },
    { zh: '阿里山', en: 'Alishan' }, { zh: '永康街', en: 'Yongkang St.' },
    { zh: '西門町', en: 'Ximending' }, { zh: '信義區', en: 'Xinyi District' },
    { zh: '士林夜市', en: 'Shilin Night Market' },

    // 流行用語 / 社會百態
    { zh: '社畜', en: 'Corporate slave' }, { zh: '肝', en: 'Grinding' },
    { zh: '躺平', en: 'Lying flat' }, { zh: '佛系', en: 'Zen mode' },
    { zh: '邊緣人', en: 'Loner' }, { zh: '塞車', en: 'Traffic jam' },
    { zh: '加班', en: 'Overtime' }, { zh: '健身房', en: 'Gym' },
    { zh: '漲價', en: 'Price hike' }, { zh: '通膨', en: 'Inflation' },
    { zh: '斜槓', en: 'Side hustle' }, { zh: '炎上', en: 'Canceled' },
    { zh: '厭世', en: 'World-weary' }, { zh: '破防', en: 'Triggered' },
    { zh: '雷包', en: 'Dead weight' }, { zh: 'PTT', en: 'PTT' },
    { zh: 'Dcard', en: 'Dcard' }
];
