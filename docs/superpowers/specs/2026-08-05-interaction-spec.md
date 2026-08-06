# 互動細節規格（按鈕／動效／觸覺）

- 建立日期：2026-08-05
- 目的：把「頂尖產品的按鈕手感」變成可實作、可驗收的具體數值，取代憑感覺調參數。
- 適用範圍：全 app 所有可點元素。

---

## 1. 尺寸與命中區

| 項目 | 規格 | 來源 |
|---|---|---|
| 最小可點區域 | **44 × 44 pt** | Apple HIG 硬性要求 |
| 視覺尺寸可以小於命中區 | 用 padding 或偽元素撐開命中區，不要為了命中區把圖示放大 | — |
| 主要按鈕高度 | 52px | 既有 `.btn-primary`，符合 44pt 下限 |
| 次要按鈕高度 | 52px，與主要按鈕**同高** | 不同高度是目前 groups 頁面看起來歪掉的原因 |

**已知違規**：`.btn-back` 是 36 × 36px，**低於 44pt 下限**。返回鈕是高頻操作，必須修。

---

## 2. 動效時間

| 情境 | 時間 | 曲線 |
|---|---|---|
| 按下回饋（press） | **100ms** | ease-out |
| 狀態切換（顯示/隱藏、顏色變化） | **200ms** | ease-out |
| 頁面轉場 | **300ms** | ease-out |
| 慶祝／成功時刻 | 400–500ms | 可用 spring |

**硬性原則**：一般按鈕**不可以用 spring**。

研究結論明確：每個按鈕都彈跳會讓整個介面顯得不穩定，overshoot 變成視覺噪音而不是細節。spring 只保留給慶祝時刻——本產品就是**全員定錨完成**的那一瞬間，其餘一律 ease-out。

---

## 3. 按下的形變

```
transform: scale(0.96) translateY(1px);
transition: transform 100ms ease-out;
```

- **縮到 96%**，不是 98%（太小看不出來）也不是 90%（廉價感）
- 同時下沉 1px，製造「被按進去」的實體感
- 放開立即回彈，不加延遲

---

## 4. 觸覺回饋（iOS 語意，不是毫秒）

iOS 的 Taptic Engine 是**選 pattern**，不是設時長。`navigator.vibrate(ms)` 的思維只適用 Android。

| 情境 | iOS pattern | Android fallback |
|---|---|---|
| 一般按鈕、次要動作 | `impact` **light** | `vibrate(10)` |
| 主要動作（發起聚會、加入、送出） | `impact` **medium** | `vibrate(20)` |
| 選項切換、tab 變更、滑動選擇 | `selection` | `vibrate(5)` |
| 操作成功（定錨完成、聚會建立） | `notification` **success** | `vibrate([30,50,30])` |
| 操作失敗、驗證錯誤 | `notification` **error** | `vibrate([50,80,50])` |
| 定錨長按的里程碑（25/50/75%） | `impact` **light** | `vibrate(10)` |
| 定錨個人完成 | `impact` **heavy** | `vibrate(40)` |
| 右滑返回手勢 commit | `impact` **light** | `vibrate(8)` |

**原則**：
- 觸覺是**確認**，不是裝飾。沒有狀態改變就不要震。
- 同一個動作不要同時給 impact 和 notification，會變成雜訊。
- 一律尊重 `prefers-reduced-motion`，並提供使用者可關閉的設定。

---

## 5. 圓角（四階，不得新增）

| Token | 值 | 用途 |
|---|---|---|
| `--r-sm` | 12px | 小元件、輸入框、標籤 |
| `--r-md` | 18px | 卡片、面板 |
| `--r-lg` | 26px | 大容器、sheet |
| `--r-pill` | 999px | 膠囊按鈕、chip、頭像 |

原本專案有六種以上圓角並存（14/16/18/20/12/10），且 `999px` 與 `99px` 混用，這是視覺上「說不出哪裡怪但就是不對」的主因。

---

## 6. 視覺層級

同一畫面內，**主要動作只能有一個**。

| 層級 | 樣式 |
|---|---|
| Primary | 實心暖橘/棕，有陰影 |
| Secondary | 淺色描邊，無陰影 |
| Tertiary | 純文字連結，無邊框 |

**禁止**：兩個並排的按鈕都用 primary 樣式。這是 groups 頁面「加入群組」與「建立群組」看起來爛的根本原因——兩個等重的色塊上下堆疊，使用者無法判斷該點哪個。

**禁止**：紫色漸層。它是 AI 生成 UI 的頭號指紋，且與本產品的暖棕橘色系衝突。

---

## 7. 底部導覽的手感

參考 Instagram（2026-03 改版後）。研究結論：**觸覺是隱形的主角——每個手勢有各自的觸覺，讓拇指在眼睛確認之前就知道自己觸發了什麼。**

底部導覽是全 app 最高頻的觸點，手感必須是所有元件裡最講究的。

| 行為 | 規格 |
|---|---|
| 按下 | `scale(0.96)` + `translateY(1px)`，100ms ease-out |
| 觸覺 | **`selection`**，不是 `impact` |
| 切換到新分頁 | 圖示與文字顏色 200ms ease-out 過渡 |
| 已在目前分頁時再按 | 不重新導航、不給觸覺（沒有狀態改變就不震） |
| 選中狀態 | 必須有明確視覺差異，不能只靠顏色深淺 |
| 清單捲到底 | 給一次 `impact light`，製造「有實體邊界」的感覺 |

**為什麼用 `selection` 而不是 `impact`**：iOS 的語意分工是 `impact` 表示「物體碰撞」（用於動作按鈕），`selection` 表示「選取項目改變」（用於分頁、選擇器、滑動選單）。底部導覽是切換目的地，語意上屬於後者。混用會讓觸覺失去辨識度——如果每個動作都震一樣，等於沒有觸覺語言。

**已知偏差**：`#view-home .btn-bottom:active` 目前是 `transform: scale(.94)`，比規格的 0.96 重，改為 0.96。

**手勢必須有可見備援**：IG 有滑動切換分頁，但五個分頁按鈕全部保留。同理，本 app 加了邊緣右滑返回之後，**各頁的返回按鈕不可以拿掉**——不是每個使用者都能完成邊緣滑動手勢，這是無障礙要求。

## 8. 驗收方式

- 用 Xcode 的 Accessibility Inspector 或人工量測，確認所有可點元素 ≥ 44 × 44pt
- 實機逐一確認觸覺 pattern 與表格一致
- 開啟系統的「減少動態效果」後，動效與觸覺都要收斂
- 全 CSS grep：不得有裸寫的 ms/px 圓角、不得有 `--grad-purple`

---

## 參考

- [Apple HIG — 44pt 最小可點區域](https://developer.apple.com/design/human-interface-guidelines/)
- [UIImpactFeedbackGenerator](https://developer.apple.com/documentation/uikit/uiimpactfeedbackgenerator)
- [Mobile app animation timing 指南](https://www.appypie.com/blog/mobile-app-animation-guide)
- [UI 動效原則（spring 應節制使用）](https://courseux.com/ui-animations/)
