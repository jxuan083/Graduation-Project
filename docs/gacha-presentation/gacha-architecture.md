# 扭蛋機系統架構說明
> 社交定錨（Phubbing Anchor）寵物扭蛋系統設計文件
> 給 Claude Chat 簡報用 — 2026-11-17

---

## 一、系統定位與動機

扭蛋機是寵物養成系統的**獎勵迴圈延伸**。聚會結束後，依排名獲得金幣，拿金幣到扭蛋機抽道具，
道具穿戴在群組寵物身上，增強下次聚會的效果 Buff。

```
聚會結束 → 排名 → 金幣 → 扭蛋 → 道具 → 寵物外觀 + Buff → 下次聚會
```

---

## 二、金幣規則

| 名次 | 金幣獎勵 |
|------|---------|
| 第 1 名 | +50 |
| 第 2 名 | +30 |
| 其他參與者 | +20 |
| 未計分（老師身份） | +0 |

單抽 50 幣；三連抽 120 幣（省 30 幣）。  
重複抽到「珍藏」稀有度道具退還 10 幣。

---

## 三、稀有度系統

| 稀有度 | 機率 | 顏色 |
|--------|------|------|
| 普通 (common) | 70% | 灰底 |
| 稀有 (rare) | 25% | 藍底 |
| 珍藏 (treasure) | 5% | 金底 |

實作：加權隨機（`secrets.choices`），總權重 10000。

---

## 四、道具目錄（20 件）

### 服裝 Costume（穿戴在寵物圖層上）

| 槽位 | 道具 | 稀有度 | Buff 效果 |
|------|------|--------|-----------|
| head | 派對帽 | 普通 | 餵食效果 ×1.35，12h |
| head | 蝴蝶結帽 | 普通 | 玩耍效果 ×1.3，12h |
| head | 小王冠 | 稀有 | 餵食效果 ×1.5，24h |
| head | 巫師帽 | 稀有 | 玩耍效果 ×1.5，24h |
| head | 星辰王冠 | 珍藏 | 全效果 ×1.5，48h |
| head | 彩虹皇冠 | 珍藏 | 全效果 ×1.6，48h |
| head | 貓耳頭飾 | 普通 | 衰減抵抗 ×0.65，12h |
| head | 星形眼鏡 | 稀有 | 玩耍效果 ×1.6，24h |
| neck | 格紋圍巾 | 普通 | 衰減抵抗 ×0.7，24h |
| neck | 聚會勳章 | 稀有 | 全效果 ×1.4，24h |
| neck | 水晶吊墜 | 珍藏 | 全效果 ×1.7，48h |
| body | 小背心 | 普通 | 清潔效果 ×1.4，12h |
| body | 英雄披風 | 稀有 | 玩耍效果 ×1.6，24h |
| body | 燕尾服 | 珍藏 | 全效果 ×2.0，48h |

### 裝飾 Decoration（特效圖層）

| 道具 | 稀有度 | Buff 效果 |
|------|--------|-----------|
| 閃閃星光 | 普通 | 玩耍效果 ×1.3，12h |
| 音符飄飄 | 普通 | 玩耍效果 ×1.3，12h |
| 愛心雨 | 稀有 | 餵食效果 ×1.5，24h |
| 彩虹光環 | 稀有 | 衰減抵抗 ×0.55，24h |
| 聚會煙火 | 珍藏 | 全效果 ×1.6，48h |
| 銀河光環 | 珍藏 | 全效果 ×2.0，48h |

---

## 五、前端架構

```
pet-tamagotchi.html
  └── <dialog id="pet-gacha-dialog">    ← 扭蛋機 Dialog
        ├── .gacha-body-art              ← 純 CSS 繪製扭蛋機外觀
        │     ├── .gacha-dome           ← 半圓玻璃球頂（膠囊在裡面浮動）
        │     ├── .gacha-tube           ← 連接管
        │     ├── .gacha-machine-body   ← 主機身（紅色，含投幣孔、出口、旋轉把手）
        │     └── .gacha-base           ← 底座
        ├── .gacha-wallet               ← 金幣顯示
        ├── .gacha-tabs                 ← 「抽扭蛋」/「衣櫃」兩個 Tab
        ├── #gacha-panel-draw           ← 抽取面板
        │     ├── .gacha-kinds          ← 全部/配件/裝飾 篩選
        │     ├── .gacha-odds           ← 稀有度機率標籤
        │     ├── .gacha-collection-grid ← 收集格（已收=彩色，未收=灰）
        │     ├── .gacha-reveal         ← 開膠囊動畫區
        │     └── .gacha-draw-btns      ← 抽一次 / 抽三次按鈕
        └── #gacha-panel-wardrobe       ← 衣櫃面板
              ├── .gacha-wardrobe-equipped ← 目前穿戴槽
              └── .gacha-wardrobe-grid     ← 全部已收道具
```

### 關鍵 JS 函式

| 函式 | 功能 |
|------|------|
| `openGachaDialog()` | 開啟 dialog，呼叫 `/api/users/gacha/catalog` 載入金幣和衣櫃 |
| `renderGachaCapsules()` | 在圓頂內生成隨機位置的彩色膠囊 SVG |
| `renderGachaCollection()` | 渲染收集格，已擁有的顯示 ✓ |
| `drawGacha(count)` | 呼叫 `/api/users/gacha/draw`，含離線 fallback |
| `renderGachaReveal(items)` | 膠囊開封動畫 + confetti 粒子特效 |
| `renderGachaWardrobe()` | 渲染衣櫃和穿戴槽 |
| `updateCostumeOverlays()` | 把穿戴道具的 SVG 疊在寵物圖片上方 |
| `gachaPickItem()` | 本地加權隨機（離線 fallback 用） |

### 狀態變數

```js
let _gachaDrawBusy = false;    // 防止重複抽取
let _gachaWardrobe = [];        // 已擁有的道具
let _gachaEquipped = {};        // 目前穿戴 { head, neck, body, effect }
let _gachaUserPoints = 0;       // 當前金幣數
const GACHA_LOCAL_CATALOG = []; // 離線 fallback 道具目錄
```

---

## 六、後端架構

### 新增 API 端點

| Method | Path | 功能 |
|--------|------|------|
| GET | `/api/users/gacha/catalog` | 取得道具目錄 + 使用者金幣 + 衣櫃 |
| POST | `/api/users/gacha/draw` | 執行抽取（Firestore transaction 防重扣） |
| POST | `/api/users/gacha/add_points` | 加金幣（測試 / 聚會 finalize 用） |
| POST | `/api/groups/{group_id}/pet/equip` | 穿戴/卸下道具 |
| GET | `/api/groups/{group_id}/pet/wardrobe` | 取得群組寵物衣櫃 |
| POST | `/api/groups/{group_id}/pet/use_gacha_item` | 使用道具並套用 Buff |

### `backend/pet_gacha.py`（純函式，無 I/O）

```python
GACHA_ITEMS       # 20 件道具資料 (list)
GACHA_BY_ID       # dict 快速查找
gacha_catalog()   # 回傳完整目錄（前端展示）
draw_gacha_item() # 加權隨機，回傳 1 件道具
apply_gacha_draw(user_wardrobe, drawn_items)  # 計算新衣櫃 + 重複退款
public_item(item)   # 附加 rarity_label、rarity_level
```

### Firestore 儲存結構

```
users/{uid}/
  ranking_gacha_points: int      ← 個人金幣
  gacha_wardrobe: list[item_id]  ← 擁有的道具 ID 清單

groups/{group_id}/pet/
  gacha_equipped: {              ← 群組寵物目前穿戴
    head: item_id | null
    neck: item_id | null
    body: item_id | null
    effect: item_id | null
  }
  active_buffs: list[{           ← 啟動中的 Buff
    buff_type, buff_value,
    buff_duration_hours,
    activated_at
  }]
```

---

## 七、前端寵物圖層疊加設計

```
pet-avatar-wrap (position: relative)
  ├── <img id="pet-avatar-img" />        ← 基礎寵物圖（狗狗插畫）
  ├── <span class="pet-costume-head" />  ← 頭部道具 SVG overlay
  ├── <span class="pet-costume-body" />  ← 身體道具 SVG overlay
  ├── <span class="pet-costume-neck" />  ← 頸部道具 SVG overlay
  └── <span class="pet-decoration-effect" /> ← 裝飾特效 overlay
```

有插畫寵物（has-illustrated-pet class）時，使用 `overlay_img`（針對插畫位置調整過的版本）；
一般寵物使用 `img`。

---

## 八、CSS 機器外觀元件

扭蛋機完全用 CSS box-shadow / border-radius / linear-gradient 繪製，零圖片依賴：

| 元件 | 實作技術 |
|------|---------|
| 玻璃球頂 `.gacha-dome` | border-radius 半圓 + 多層 inset box-shadow + radial-gradient 高光 |
| 球頂光澤 `.gacha-dome-shine` | 白色橢圓 + blur(4px) |
| 彩色膠囊 `.gacha-capsule` | inline SVG（JS 動態生成）+ `gacha-capsule-float` keyframe 動畫 |
| 機身 `.gacha-machine-body` | linear-gradient 橙紅色 + inset highlight |
| 旋轉把手 `.gacha-handle-arm` | 細長 div + transform-origin + `gacha-handle-turn` keyframe |
| 開封動畫 `.gacha-capsule-anim` | top/bottom 兩半 div，抽取時分離動畫 |
| Confetti | JS 生成 `.gacha-confetti-particle` div，`gacha-confetti-fly` keyframe |

---

## 九、安全性設計

1. **防重扣**：`request_id` (UUID) + Firestore transaction，重複 request_id 回傳先前結果
2. **金幣原子扣除**：Firestore transaction 確保 read-modify-write 不競爭
3. **餘額驗證**：後端再次驗證餘額足夠，前端不信任

---

## 十、截圖

- `01_home.png` — 首頁
- `02_leaderboard.png` — 排行榜（含 gacha banner）
- `03_pet.png` — 寵物養成頁
- `05_gacha_preview.png` — 扭蛋機 Dialog（主畫面）
- `06_gacha_full.png` — 扭蛋機 Dialog（較大視角）
